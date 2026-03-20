'use strict';

const { program } = require('commander');
const { scanForms } = require('./src/core/formScanner');
const { createEngine } = require('./src/core/requestEngine');
const { summarizeIssues } = require('./src/core/responseAnalyzer');
const { runValidationTests, buildValidationTasks } = require('./src/tests/validationTests');
const { runRateLimitTests, DEFAULT_BURST_COUNT } = require('./src/tests/rateLimitTests');
const { buildReport } = require('./src/report/reportBuilder');
const { saveJSON } = require('./src/report/saveJSON');
const { saveTXT } = require('./src/report/saveTXT');
const { saveHTML } = require('./src/report/saveHTML');
const { saveHistory } = require('./src/report/saveHistory');
const { startTUI } = require('./src/ui/tui');
const { createSpinner, createProgressBar } = require('./src/ui/progress');
const logger = require('./src/utils/logger');
const { clamp, formatMs, round } = require('./src/utils/helpers');

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

program
  .name('spam-attacker')
  .description('Spam Attacker — Web Form Security Testing CLI Tool (non-destructive validation & rate-limit analysis)')
  .version('1.2.0')
  .option('--url <url>', 'Target URL to scan (omit for interactive mode)')
  .option('--concurrency <number>', 'Number of concurrent requests', '10')
  .option('--output <prefix>', 'Output filename prefix for reports', 'report')
  .option('--output-dir <path>', 'Directory to save reports in (created if missing)', '.')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--format <formats>', 'Comma-separated report formats to generate: json,txt,html', 'json,txt,html')
  .option('--allow-list <domains>', 'Comma-separated list of allowed domains (e.g. example.com,myapp.io)')
  .option('--rate-limit-test', 'Run rate-limiting detection tests', false)
  .option('--verbose', 'Enable verbose logging', false)
  .addHelpText('after', `
Examples:
  node index.js                                            (interactive mode)
  node index.js --url=https://example.com
  node index.js --url=https://example.com --concurrency=20 --rate-limit-test --verbose
  node index.js --url=https://example.com --format=json,html
  node index.js --url=https://example.com --allow-list=example.com,myapp.io
`);

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

async function main() {
  program.parse(process.argv);
  let opts = program.opts();

  logger.banner();

  // ── Interactive mode — launch full TUI ──────────────────────────────────
  if (!opts.url) {
    startTUI();
    return; // TUI owns the process from here
  }

  logger.setVerbose(opts.verbose);

  // ── Parse options ────────────────────────────────────────────────────────
  const targetUrl     = opts.url;
  const concurrency   = clamp(parseInt(opts.concurrency, 10) || 10, 1, 100);
  const timeout       = clamp(parseInt(opts.timeout, 10) || 10000, 1000, 120000);
  const outputPrefix  = opts.output || 'report';
  const outputDir     = opts.outputDir || '.';
  const runRateLimit  = !!opts.rateLimitTest;
  const maxRps        = 10;

  // Formats
  const validFormats = ['json', 'txt', 'html'];
  const requestedFormats = (opts.format || 'json,txt,html')
    .split(',').map(f => f.trim().toLowerCase()).filter(f => validFormats.includes(f));

  if (requestedFormats.length === 0) {
    logger.error(`No valid formats specified. Choose from: ${validFormats.join(', ')}`);
    process.exit(3);
  }

  // Allow-list
  const allowList = opts.allowList
    ? opts.allowList.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
    : [];

  if (allowList.length > 0) {
    let targetHostname;
    try { targetHostname = new URL(targetUrl).hostname.toLowerCase(); }
    catch { logger.error(`Invalid target URL: ${targetUrl}`); process.exit(3); }

    const allowed = allowList.some(d => targetHostname === d || targetHostname.endsWith(`.${d}`));
    if (!allowed) {
      logger.error(`Target "${targetHostname}" is not in the allow-list: ${allowList.join(', ')}`);
      process.exit(1);
    }
  }

  // ── Config summary ───────────────────────────────────────────────────────
  logger.section('Configuration');
  logger.info(`Target URL    : ${targetUrl}`);
  logger.info(`Concurrency   : ${concurrency}`);
  logger.info(`Timeout       : ${timeout}ms`);
  logger.info(`Output prefix : ${outputPrefix}`);
  logger.info(`Output dir    : ${outputDir}`);
  logger.info(`Formats       : ${requestedFormats.join(', ')}`);
  logger.info(`Allow-list    : ${allowList.length > 0 ? allowList.join(', ') : 'disabled (any URL)'}`);
  logger.info(`Rate-limit    : ${runRateLimit ? 'enabled' : 'disabled'}`);
  logger.info(`Verbose       : ${opts.verbose ? 'yes' : 'no'}`);
  logger.info(`Max RPS       : ${maxRps} (safety cap)`);

  const scanMeta = { startTime: Date.now() };

  // ── Step 1: Form Discovery ───────────────────────────────────────────────
  logger.section('Step 1: Form Discovery');

  const spinner1 = createSpinner(`Fetching ${targetUrl}…`);

  let forms;
  try {
    forms = await scanForms(targetUrl, timeout);
    spinner1.succeed(`Found ${forms.length} form(s) with ${forms.reduce((a, f) => a + f.fieldCount, 0)} field(s).`);
  } catch (err) {
    spinner1.fail(`Form discovery failed: ${err.message}`);
    process.exit(3);
  }

  if (forms.length === 0) {
    logger.warn('No forms found on the target page. Nothing to test.');
    logger.warn('Ensure the URL returns HTML with <form> elements and the server is reachable.');
  } else {
    for (const form of forms) {
      logger.info(`  Form [${form.formId}]: ${form.method} ${form.actionUrl} (${form.fieldCount} fields)`);
    }
  }

  // ── Step 2: Request Engine Setup ─────────────────────────────────────────
  const engine = createEngine({ concurrency, timeout, maxRps });
  const allResults = [];
  const allIssues = [];

  // ── Step 3: Input Validation Tests ───────────────────────────────────────
  logger.section('Step 2: Input Validation Tests');

  if (forms.length === 0) {
    logger.warn('Skipping — no forms found.');
  } else {
    // Count total tasks upfront so the progress bar has a known total
    const totalValidationTasks = forms.reduce((acc, f) => acc + buildValidationTasks(f).length, 0);

    const validationBar = createProgressBar('Validation', totalValidationTasks);

    try {
      const { issues, results, tasksRun } = await runValidationTests(
        forms, engine, () => validationBar.increment()
      );
      validationBar.stop();
      allResults.push(...results);
      allIssues.push(...issues);
      logger.success(`Validation tests complete: ${tasksRun} requests sent, ${issues.length} issue(s) detected.`);
    } catch (err) {
      validationBar.stop();
      logger.error(`Validation tests error: ${err.message}`);
    }
  }

  // ── Step 4: Rate Limiting Tests (optional) ───────────────────────────────
  let rateLimitStats = [];

  if (runRateLimit) {
    logger.section('Step 3: Rate Limiting Detection');

    if (forms.length === 0) {
      logger.warn('Skipping — no forms found.');
    } else {
      const burstCount = Math.min(DEFAULT_BURST_COUNT, 50);
      const totalRateTasks = forms.length * burstCount;
      const rateBar = createProgressBar('Rate-limit', totalRateTasks);

      try {
        const { issues, results, stats } = await runRateLimitTests(
          forms, engine, burstCount, () => rateBar.increment()
        );
        rateBar.stop();
        allResults.push(...results);
        allIssues.push(...issues);
        rateLimitStats = stats;
        logger.success(`Rate-limit tests complete: ${results.length} requests sent, ${issues.length} issue(s) detected.`);
      } catch (err) {
        rateBar.stop();
        logger.error(`Rate-limit tests error: ${err.message}`);
      }
    }
  } else {
    logger.info('Rate-limit testing skipped. Use --rate-limit-test to enable.');
  }

  // ── Step 5: Build Reports ────────────────────────────────────────────────
  logger.section('Step 4: Building Reports');

  const spinner5 = createSpinner('Generating reports…');
  scanMeta.endTime = Date.now();

  const report = buildReport({ targetUrl, forms, issues: allIssues, allResults, rateLimitStats, scanMeta });

  const jsonPath = requestedFormats.includes('json') ? saveJSON(report, outputPrefix, outputDir) : null;
  const txtPath  = requestedFormats.includes('txt')  ? saveTXT(report, outputPrefix, outputDir)  : null;
  const htmlPath = requestedFormats.includes('html') ? saveHTML(report, outputPrefix, outputDir) : null;

  saveHistory(report, outputDir);
  spinner5.succeed('Reports generated.');

  // ── Summary ──────────────────────────────────────────────────────────────
  logger.section('Scan Complete — Summary');

  const perf        = report.performance;
  const summary     = report.summary;
  const issueSummary = summarizeIssues(allIssues);

  const overallRisk = issueSummary.high > 0 ? 'HIGH'
    : issueSummary.medium > 0 ? 'MEDIUM'
    : issueSummary.low > 0 ? 'LOW'
    : 'NONE';

  const riskColor = { HIGH: 'red', MEDIUM: 'yellow', LOW: 'yellow', NONE: 'green' }[overallRisk];

  logger.table([
    { label: 'Target URL',     value: targetUrl },
    { label: 'Scan Duration',  value: `${round((scanMeta.endTime - scanMeta.startTime) / 1000, 1)}s` },
    { label: 'Forms Found',    value: summary.forms_found },
    { label: 'Fields Tested',  value: summary.fields_tested },
    { label: 'Total Requests', value: perf.total_requests },
    { label: 'Success Rate',   value: `${perf.success_rate}%` },
    { label: 'Avg Response',   value: formatMs(perf.average_response_time) },
    { label: 'Max Response',   value: formatMs(perf.max_response_time) },
    { label: 'Issues Found',   value: summary.issues_found,  color: summary.issues_found > 0 ? 'red' : 'green' },
    { label: '  High',         value: issueSummary.high,     color: issueSummary.high > 0 ? 'red' : 'green' },
    { label: '  Medium',       value: issueSummary.medium,   color: issueSummary.medium > 0 ? 'yellow' : 'green' },
    { label: '  Low',          value: issueSummary.low,      color: issueSummary.low > 0 ? 'yellow' : 'green' },
    { label: 'Overall Risk',   value: overallRisk,            color: riskColor },
  ]);

  console.log('');
  logger.info('Reports saved:');
  if (jsonPath) logger.info(`  JSON → ${jsonPath}`);
  if (txtPath)  logger.info(`  TXT  → ${txtPath}`);
  if (htmlPath) logger.info(`  HTML → ${htmlPath}`);

  // Exit codes: 0 = clean, 1 = high severity issues, 2 = issues (medium/low only)
  let exitCode = 0;
  if (issueSummary.high > 0) {
    exitCode = 1;
    console.log('');
    logger.warn('HIGH severity issues detected. Review the report immediately.');
  } else if (allIssues.length > 0) {
    exitCode = 2;
    console.log('');
    logger.warn('Issues detected. Review the report for details and recommendations.');
  } else {
    console.log('');
    logger.success('No issues detected during this scan.');
  }

  console.log('');
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch(err => {
  logger.error(`Unexpected fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(3);
});

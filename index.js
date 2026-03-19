'use strict';

const { program } = require('commander');
const { scanForms } = require('./src/core/formScanner');
const { createEngine } = require('./src/core/requestEngine');
const { computePerformanceMetrics, summarizeIssues } = require('./src/core/responseAnalyzer');
const { runValidationTests } = require('./src/tests/validationTests');
const { runRateLimitTests, DEFAULT_BURST_COUNT } = require('./src/tests/rateLimitTests');
const { buildReport } = require('./src/report/reportBuilder');
const { saveJSON } = require('./src/report/saveJSON');
const { saveTXT } = require('./src/report/saveTXT');
const { saveHTML } = require('./src/report/saveHTML');
const logger = require('./src/utils/logger');
const { clamp, formatMs, round } = require('./src/utils/helpers');

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

program
  .name('spam-attacker')
  .description('Spam Attacker — Web Form Security Testing CLI Tool (non-destructive validation & rate-limit analysis)')
  .version('1.0.0')
  .requiredOption('--url <url>', 'Target URL to scan')
  .option('--concurrency <number>', 'Number of concurrent requests', '10')
  .option('--output <prefix>', 'Output filename prefix for reports', 'report')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--rate-limit-test', 'Run rate-limiting detection tests', false)
  .option('--verbose', 'Enable verbose logging', false)
  .addHelpText('after', `
Examples:
  node index.js --url=https://example.com
  node index.js --url=https://example.com --concurrency=20 --rate-limit-test --verbose
  node index.js --url=https://example.com --output=myreport --timeout=15000
`);

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

async function main() {
  program.parse(process.argv);
  const opts = program.opts();

  // Setup
  logger.setVerbose(opts.verbose);
  logger.banner();

  const targetUrl = opts.url;
  const concurrency = clamp(parseInt(opts.concurrency, 10) || 10, 1, 100);
  const timeout = clamp(parseInt(opts.timeout, 10) || 10000, 1000, 120000);
  const outputPrefix = opts.output || 'report';
  const runRateLimit = !!opts.rateLimitTest;
  const maxRps = 10; // Safety cap — never exceed 10 req/s

  logger.info(`Target URL    : ${targetUrl}`);
  logger.info(`Concurrency   : ${concurrency}`);
  logger.info(`Timeout       : ${timeout}ms`);
  logger.info(`Output prefix : ${outputPrefix}`);
  logger.info(`Rate-limit    : ${runRateLimit ? 'enabled' : 'disabled'}`);
  logger.info(`Verbose       : ${opts.verbose ? 'yes' : 'no'}`);
  logger.info(`Max RPS       : ${maxRps} (safety cap)`);

  const scanMeta = { startTime: Date.now() };

  // -------------------------------------------------------------------------
  // Step 1: Form Discovery
  // -------------------------------------------------------------------------
  logger.section('Step 1: Form Discovery');

  let forms;
  try {
    forms = await scanForms(targetUrl, timeout);
  } catch (err) {
    logger.error(`Form discovery failed: ${err.message}`);
    process.exit(1);
  }

  if (forms.length === 0) {
    logger.warn('No forms found on the target page. Nothing to test.');
    logger.warn('Ensure the URL returns HTML with <form> elements and that the server is reachable.');
  } else {
    logger.success(`Discovered ${forms.length} form(s) with a total of ${forms.reduce((a, f) => a + f.fieldCount, 0)} field(s).`);
    for (const form of forms) {
      logger.info(`  Form [${form.formId}]: ${form.method} ${form.actionUrl} (${form.fieldCount} fields)`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Request Engine Setup
  // -------------------------------------------------------------------------
  const engine = createEngine({ concurrency, timeout, maxRps });

  const allResults = [];
  const allIssues = [];

  // -------------------------------------------------------------------------
  // Step 3: Input Validation Tests
  // -------------------------------------------------------------------------
  logger.section('Step 2: Input Validation Tests');

  if (forms.length === 0) {
    logger.warn('Skipping validation tests — no forms found.');
  } else {
    try {
      const { issues, results, tasksRun } = await runValidationTests(forms, engine);
      allResults.push(...results);
      allIssues.push(...issues);
      logger.success(`Validation tests complete: ${tasksRun} requests sent, ${issues.length} issue(s) detected.`);
    } catch (err) {
      logger.error(`Validation tests encountered an error: ${err.message}`);
      if (opts.verbose) console.error(err);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Rate Limiting Tests (optional)
  // -------------------------------------------------------------------------
  let rateLimitStats = [];

  if (runRateLimit) {
    logger.section('Step 3: Rate Limiting Detection');

    if (forms.length === 0) {
      logger.warn('Skipping rate-limit tests — no forms found.');
    } else {
      try {
        const burstCount = Math.min(DEFAULT_BURST_COUNT, 50);
        const { issues, results, stats } = await runRateLimitTests(forms, engine, burstCount);
        allResults.push(...results);
        allIssues.push(...issues);
        rateLimitStats = stats;
        logger.success(`Rate-limit tests complete: ${results.length} requests sent, ${issues.length} issue(s) detected.`);
      } catch (err) {
        logger.error(`Rate-limit tests encountered an error: ${err.message}`);
        if (opts.verbose) console.error(err);
      }
    }
  } else {
    logger.info('Rate-limit testing skipped. Use --rate-limit-test to enable.');
  }

  // -------------------------------------------------------------------------
  // Step 5: Build Report
  // -------------------------------------------------------------------------
  logger.section('Step 4: Building Reports');

  scanMeta.endTime = Date.now();

  const report = buildReport({
    targetUrl,
    forms,
    issues: allIssues,
    allResults,
    rateLimitStats,
    scanMeta,
  });

  const jsonPath = saveJSON(report, outputPrefix);
  const txtPath  = saveTXT(report, outputPrefix);
  const htmlPath = saveHTML(report, outputPrefix);

  // -------------------------------------------------------------------------
  // Step 6: CLI Summary
  // -------------------------------------------------------------------------
  logger.section('Scan Complete — Summary');

  const perf = report.performance;
  const summary = report.summary;
  const issueSummary = summarizeIssues(allIssues);

  const overallRisk = issueSummary.high > 0 ? 'HIGH'
    : issueSummary.medium > 0 ? 'MEDIUM'
    : issueSummary.low > 0 ? 'LOW'
    : 'NONE';

  const riskColor = { HIGH: 'red', MEDIUM: 'yellow', LOW: 'yellow', NONE: 'green' }[overallRisk];

  logger.table([
    { label: 'Target URL',      value: targetUrl },
    { label: 'Scan Duration',   value: `${round((scanMeta.endTime - scanMeta.startTime) / 1000, 1)}s` },
    { label: 'Forms Found',     value: summary.forms_found },
    { label: 'Fields Tested',   value: summary.fields_tested },
    { label: 'Total Requests',  value: perf.total_requests },
    { label: 'Success Rate',    value: `${perf.success_rate}%` },
    { label: 'Avg Response',    value: formatMs(perf.average_response_time) },
    { label: 'Max Response',    value: formatMs(perf.max_response_time) },
    { label: 'Issues Found',    value: summary.issues_found,   color: summary.issues_found > 0 ? 'red' : 'green' },
    { label: '  High',          value: issueSummary.high,      color: issueSummary.high > 0 ? 'red' : 'green' },
    { label: '  Medium',        value: issueSummary.medium,    color: issueSummary.medium > 0 ? 'yellow' : 'green' },
    { label: '  Low',           value: issueSummary.low,       color: issueSummary.low > 0 ? 'yellow' : 'green' },
    { label: 'Overall Risk',    value: overallRisk,             color: riskColor },
  ]);

  console.log('');
  logger.info(`Reports saved:`);
  logger.info(`  JSON → ${jsonPath}`);
  logger.info(`  TXT  → ${txtPath}`);
  logger.info(`  HTML → ${htmlPath}`);

  if (allIssues.length > 0) {
    console.log('');
    logger.warn('Issues detected. Review the report for details and recommendations.');
  } else {
    console.log('');
    logger.success('No issues detected during this scan.');
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch(err => {
  logger.error(`Unexpected fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});

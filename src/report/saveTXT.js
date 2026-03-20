'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { formatMs } = require('../utils/helpers');

function line(char = '─', len = 72) {
  return char.repeat(len);
}

function section(title) {
  return `\n${line()}\n  ${title}\n${line()}\n`;
}

function severityBadge(severity) {
  const badges = { High: '[HIGH]', Medium: '[MED] ', Low: '[LOW] ' };
  return badges[severity] || '[INFO]';
}

/**
 * Render the report as a human-readable plain-text string.
 */
function renderTXT(report) {
  const lines = [];

  lines.push(line('═'));
  lines.push('  WEB FORM SECURITY TESTING REPORT');
  lines.push(line('═'));
  lines.push('');
  lines.push(`  Target URL  : ${report.target}`);
  lines.push(`  Scan Date   : ${report.scan_date}`);
  if (report.scan_time_seconds !== null) {
    lines.push(`  Scan Duration: ${report.scan_time_seconds}s`);
  }

  // Summary
  lines.push(section('SUMMARY'));
  lines.push(`  Forms Found      : ${report.summary.forms_found}`);
  lines.push(`  Fields Tested    : ${report.summary.fields_tested}`);
  lines.push(`  Issues Found     : ${report.summary.issues_found}`);
  lines.push(`    High Severity  : ${report.summary.issues_high}`);
  lines.push(`    Medium Severity: ${report.summary.issues_medium}`);
  lines.push(`    Low Severity   : ${report.summary.issues_low}`);

  // Performance
  lines.push(section('PERFORMANCE METRICS'));
  lines.push(`  Avg Response Time : ${formatMs(report.performance.average_response_time)}`);
  lines.push(`  Max Response Time : ${formatMs(report.performance.max_response_time)}`);
  lines.push(`  Min Response Time : ${formatMs(report.performance.min_response_time)}`);
  lines.push(`  Total Requests    : ${report.performance.total_requests}`);
  lines.push(`  Successful        : ${report.performance.successful_requests}`);
  lines.push(`  Failed            : ${report.performance.failed_requests}`);
  lines.push(`  Success Rate      : ${report.performance.success_rate}%`);
  lines.push(`  Throughput        : ${report.performance.throughput_rps} req/s`);

  // Forms
  lines.push(section('FORMS DISCOVERED'));
  if (report.forms.length === 0) {
    lines.push('  No forms found.');
  }
  for (const form of report.forms) {
    lines.push(`  Form ID  : ${form.form_id}`);
    lines.push(`  Action   : ${form.action_url}`);
    lines.push(`  Method   : ${form.method}`);
    lines.push(`  Fields   : ${form.field_count}`);
    for (const f of form.fields) {
      const attrs = [
        f.required ? 'required' : '',
        f.minlength != null ? `min=${f.minlength}` : '',
        f.maxlength != null ? `max=${f.maxlength}` : '',
      ].filter(Boolean).join(', ');
      lines.push(`    - ${f.name} (type=${f.type}${attrs ? ', ' + attrs : ''})`);
    }
    lines.push('');
  }

  // Issues
  lines.push(section('DETECTED ISSUES'));
  if (report.issues.length === 0) {
    lines.push('  No issues detected. Great job!\n');
  }
  for (let i = 0; i < report.issues.length; i++) {
    const issue = report.issues[i];
    lines.push(`  ${i + 1}. ${severityBadge(issue.severity)} [${issue.type}]`);
    lines.push(`     Form       : ${issue.form || 'N/A'}`);
    lines.push(`     Field      : ${issue.field || 'N/A'}`);
    lines.push(`     Description: ${issue.description}`);
    if (issue.recommendation) {
      lines.push(`     Fix        : ${issue.recommendation}`);
    }
    lines.push('');
  }

  // Recommendations
  lines.push(section('RECOMMENDATIONS'));
  if (report.recommendations.length === 0) {
    lines.push('  No specific recommendations.\n');
  }
  for (let i = 0; i < report.recommendations.length; i++) {
    const rec = report.recommendations[i];
    lines.push(`  ${i + 1}. [${rec.severity}] ${rec.title}`);
    lines.push(`     ${rec.detail}`);
    lines.push('');
  }

  lines.push(line('═'));
  lines.push('  End of Report');
  lines.push(line('═'));

  return lines.join('\n');
}

/**
 * Save the report as a plain-text (.txt) file.
 *
 * @param {object} report       - Full report object
 * @param {string} outputPrefix - Filename prefix (e.g. "report" → "report.txt")
 * @param {string} outputDir    - Directory to write into (default: cwd)
 * @returns {string}            - Absolute path of the written file
 */
function saveTXT(report, outputPrefix = 'report', outputDir = '.') {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.resolve(outputDir, `${outputPrefix}.txt`);
  const content = renderTXT(report);

  try {
    fs.writeFileSync(filePath, content, 'utf8');
    logger.success(`TXT report saved : ${filePath}`);
    return filePath;
  } catch (err) {
    logger.error(`Failed to write TXT report to ${filePath}: ${err.message}`);
    throw err;
  }
}

module.exports = { saveTXT, renderTXT };

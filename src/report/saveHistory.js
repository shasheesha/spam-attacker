'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Append a summarised entry from the current report to scan-history.json.
 * If the file does not exist it is created automatically.
 *
 * @param {object} report     - Full report object from reportBuilder
 * @param {string} outputDir  - Directory to write into (default: cwd)
 * @returns {string}          - Absolute path of the history file
 */
function saveHistory(report, outputDir = '.') {
  fs.mkdirSync(outputDir, { recursive: true });
  const HISTORY_FILE = path.resolve(outputDir, 'scan-history.json');

  let history = [];

  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      logger.warn('scan-history.json was malformed — starting fresh history.');
    }
  }

  const entry = {
    scan_date: report.scan_date,
    target: report.target,
    scan_time_seconds: report.scan_time_seconds,
    summary: {
      forms_found: report.summary.forms_found,
      fields_tested: report.summary.fields_tested,
      issues_found: report.summary.issues_found,
      issues_high: report.summary.issues_high,
      issues_medium: report.summary.issues_medium,
      issues_low: report.summary.issues_low,
    },
    performance: {
      average_response_time: report.performance.average_response_time,
      success_rate: report.performance.success_rate,
      total_requests: report.performance.total_requests,
    },
    overall_risk:
      report.summary.issues_high > 0 ? 'High'
      : report.summary.issues_medium > 0 ? 'Medium'
      : report.summary.issues_low > 0 ? 'Low'
      : 'None',
  };

  history.push(entry);

  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    logger.success(`Scan history updated: ${HISTORY_FILE} (${history.length} total scan(s))`);
  } catch (err) {
    logger.error(`Failed to write scan history: ${err.message}`);
  }

  return HISTORY_FILE;
}

module.exports = { saveHistory };

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Save the report object as a formatted JSON file.
 *
 * @param {object} report       - The full report object from reportBuilder
 * @param {string} outputPrefix - Filename prefix (e.g. "report" → "report.json")
 * @param {string} outputDir    - Directory to write into (default: cwd)
 * @returns {string}            - Absolute path of the written file
 */
function saveJSON(report, outputPrefix = 'report', outputDir = '.') {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.resolve(outputDir, `${outputPrefix}.json`);
  const json = JSON.stringify(report, null, 2);

  try {
    fs.writeFileSync(filePath, json, 'utf8');
    logger.success(`JSON report saved: ${filePath}`);
    return filePath;
  } catch (err) {
    logger.error(`Failed to write JSON report to ${filePath}: ${err.message}`);
    throw err;
  }
}

module.exports = { saveJSON };

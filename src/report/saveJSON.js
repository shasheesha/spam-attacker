'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Save the report object as a formatted JSON file.
 *
 * @param {object} report       - The full report object from reportBuilder
 * @param {string} outputPrefix - File path prefix (e.g. "report" → "report.json")
 * @returns {string}            - Absolute path of the written file
 */
function saveJSON(report, outputPrefix = 'report') {
  const filePath = path.resolve(`${outputPrefix}.json`);
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

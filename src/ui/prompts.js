'use strict';

const inquirer = require('inquirer');

/**
 * Run the interactive TUI prompt sequence.
 * Returns an options object with the same shape as commander opts.
 */
async function runPrompts() {
  console.log('');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Target URL:',
      validate(val) {
        if (!val) return 'URL is required.';
        try { new URL(val); return true; } catch { return 'Enter a valid URL (e.g. https://example.com)'; }
      },
    },
    {
      type: 'number',
      name: 'concurrency',
      message: 'Concurrent requests:',
      default: 10,
      validate(val) {
        if (val < 1 || val > 100) return 'Must be between 1 and 100.';
        return true;
      },
    },
    {
      type: 'number',
      name: 'timeout',
      message: 'Request timeout (ms):',
      default: 10000,
      validate(val) {
        if (val < 1000 || val > 120000) return 'Must be between 1000 and 120000.';
        return true;
      },
    },
    {
      type: 'input',
      name: 'output',
      message: 'Report filename prefix:',
      default: 'report',
    },
    {
      type: 'input',
      name: 'outputDir',
      message: 'Report output directory (created if missing):',
      default: './reports',
    },
    {
      type: 'checkbox',
      name: 'formats',
      message: 'Report formats to generate:',
      choices: [
        { name: 'JSON', value: 'json', checked: true },
        { name: 'TXT',  value: 'txt',  checked: true },
        { name: 'HTML', value: 'html', checked: true },
      ],
      validate(val) {
        if (val.length === 0) return 'Select at least one format.';
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'rateLimitTest',
      message: 'Run rate-limit detection tests?',
      default: false,
    },
    {
      type: 'input',
      name: 'allowList',
      message: 'Domain allow-list (comma-separated, leave blank to allow any):',
      default: '',
    },
    {
      type: 'confirm',
      name: 'verbose',
      message: 'Enable verbose logging?',
      default: false,
    },
  ]);

  return {
    url: answers.url,
    concurrency: String(answers.concurrency),
    timeout: String(answers.timeout),
    output: answers.output,
    outputDir: answers.outputDir || '.',
    format: answers.formats.join(','),
    rateLimitTest: answers.rateLimitTest,
    allowList: answers.allowList || undefined,
    verbose: answers.verbose,
  };
}

module.exports = { runPrompts };

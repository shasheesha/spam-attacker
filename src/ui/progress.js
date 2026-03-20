'use strict';

const ora = require('ora');
const cliProgress = require('cli-progress');

let chalk;
try { chalk = require('chalk'); } catch { chalk = null; }

function c(text, color) {
  if (!chalk) return text;
  return chalk[color] ? chalk[color](text) : text;
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

/**
 * Create and start an ora spinner.
 * Returns the spinner instance so callers can call .succeed() / .fail() / .warn()
 *
 * @param {string} text
 * @returns {object} ora spinner
 */
function createSpinner(text) {
  const spinner = ora({
    text,
    spinner: 'dots',
    color: 'cyan',
  }).start();
  return spinner;
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

/**
 * Create a cli-progress bar preconfigured for Spam Attacker.
 *
 * @param {string} label  - Label shown at the left of the bar
 * @param {number} total  - Total number of steps
 * @returns {{ bar, increment, stop }}
 */
function createProgressBar(label, total) {
  const bar = new cliProgress.SingleBar(
    {
      format:
        `  ${c('{bar}', 'cyan')} {percentage}%  ` +
        `${c(label, 'white')} {value}/{total}  ` +
        `${c('ETA:', 'gray')} {eta}s`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(total, 0);

  return {
    bar,
    increment(n = 1) { bar.increment(n); },
    stop() { bar.stop(); },
  };
}

module.exports = { createSpinner, createProgressBar };

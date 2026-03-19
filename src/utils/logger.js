'use strict';

let chalk;
try {
  chalk = require('chalk');
} catch {
  // Fallback to ANSI codes if chalk is not yet installed
  chalk = null;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

function colorize(text, color) {
  if (chalk) {
    const fn = chalk[color] || chalk.white;
    return fn(text);
  }
  const code = ANSI[color] || '';
  return `${code}${text}${ANSI.reset}`;
}

function bold(text) {
  if (chalk) return chalk.bold(text);
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

let verboseMode = false;

function setVerbose(flag) {
  verboseMode = !!flag;
}

function timestamp() {
  return colorize(`[${new Date().toISOString()}]`, 'gray');
}

const logger = {
  setVerbose,

  info(msg) {
    console.log(`${timestamp()} ${colorize('INFO', 'cyan')}  ${msg}`);
  },

  success(msg) {
    console.log(`${timestamp()} ${colorize('OK  ', 'green')}  ${msg}`);
  },

  warn(msg) {
    console.warn(`${timestamp()} ${colorize('WARN', 'yellow')}  ${msg}`);
  },

  error(msg) {
    console.error(`${timestamp()} ${colorize('ERR ', 'red')}  ${msg}`);
  },

  verbose(msg) {
    if (verboseMode) {
      console.log(`${timestamp()} ${colorize('VERB', 'gray')}  ${colorize(msg, 'gray')}`);
    }
  },

  section(title) {
    const line = '─'.repeat(60);
    console.log('');
    console.log(colorize(line, 'blue'));
    console.log(bold(colorize(`  ${title}`, 'blue')));
    console.log(colorize(line, 'blue'));
  },

  banner() {
    if (chalk) {
      console.log(chalk.cyan.bold('\n╔══════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan.bold('║             Spam Attacker  v1.0.0                        ║'));
      console.log(chalk.cyan.bold('║        Web Form Security Testing CLI Tool                ║'));
      console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════════╝\n'));
    } else {
      console.log(`\n${ANSI.cyan}${ANSI.bold}╔══════════════════════════════════════════════════════════╗${ANSI.reset}`);
      console.log(`${ANSI.cyan}${ANSI.bold}║             Spam Attacker  v1.0.0                        ║${ANSI.reset}`);
      console.log(`${ANSI.cyan}${ANSI.bold}║        Web Form Security Testing CLI Tool                ║${ANSI.reset}`);
      console.log(`${ANSI.cyan}${ANSI.bold}╚══════════════════════════════════════════════════════════╝\n${ANSI.reset}`);
    }
  },

  table(rows) {
    // rows: array of { label, value, color }
    const maxLabel = Math.max(...rows.map(r => r.label.length));
    for (const row of rows) {
      const pad = ' '.repeat(maxLabel - row.label.length + 2);
      const val = row.color ? colorize(String(row.value), row.color) : String(row.value);
      console.log(`  ${colorize(row.label, 'white')}${pad}${val}`);
    }
  },

  colorize,
  bold,
};

module.exports = logger;

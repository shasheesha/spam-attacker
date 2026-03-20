'use strict';

const blessed = require('blessed');
const figlet  = require('figlet');
const path    = require('path');
const fs      = require('fs');

const { scanForms }                                = require('../core/formScanner');
const { createEngine }                             = require('../core/requestEngine');
const { summarizeIssues }                          = require('../core/responseAnalyzer');
const { runValidationTests, buildValidationTasks } = require('../tests/validationTests');
const { runRateLimitTests, DEFAULT_BURST_COUNT }   = require('../tests/rateLimitTests');
const { buildReport }                              = require('../report/reportBuilder');
const { saveJSON }                                 = require('../report/saveJSON');
const { saveTXT }                                  = require('../report/saveTXT');
const { saveHTML }                                 = require('../report/saveHTML');
const { saveHistory }                              = require('../report/saveHistory');
const logger                                       = require('../utils/logger');
const { clamp, formatMs, round }                   = require('../utils/helpers');

const VERSION    = '1.2.0';
const PKG_PATH   = path.resolve(__dirname, '../../package.json');
const PKG        = fs.existsSync(PKG_PATH) ? JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) : {};

// ── ASCII banner ──────────────────────────────────────────────────────────────
let BANNER_LINES;
try {
  const b = figlet.textSync('SPAM  ATTACKER', { font: 'Small', horizontalLayout: 'fitted' });
  BANNER_LINES = b.split('\n');
} catch {
  BANNER_LINES = [
    '  ____  ____  __   __      __  ____  ____  __    ___  _  _  ____  ____ ',
    ' / ___)(  _ \\/ _\\ (  )    / _\\(_  _)(_  _)/ _\\  / __)( )/ )( ___)(  _ \\',
    ' \\___ \\ )___//    \\ )(__  /    \\ )(   _)(_ /    \\( (__  )  <  )__)  )   /',
    ' (____/(__)  \\_/\\_/(____)  \\_/\\_/(__)  (____)\\_/\\_/ \\___)(__\\_)(____)(__\\_)',
  ];
}

// ── Tag helpers ───────────────────────────────────────────────────────────────
const T = {
  bg      : 'black',
  border  : '#3a3a3a',
  accent  : 'cyan',
  dim     : '#555555',
  success : 'green',
  warn    : 'yellow',
  err     : 'red',
  text    : 'white',
  muted   : '#888888',
};

const c    = (col, txt) => `{${col}-fg}${txt}{/}`;
const bold = txt => `{bold}${txt}{/}`;
const cb   = (col, txt) => c(col, bold(txt));
const riskFg = r => ({ HIGH: 'red', MEDIUM: 'yellow', LOW: 'yellow', NONE: 'green' }[r] || 'white');
const sevFg  = s => ({ High: 'red', Medium: 'yellow', Low: '#888888' }[s] || '#888888');

// ── Field definitions (drives form render + tab order) ────────────────────────
const FIELDS = [
  { key: 'url',          label: 'Target URL',       tip: 'Full URL including protocol — e.g. https://example.com' },
  { key: 'concurrency',  label: 'Concurrency',      tip: 'Simultaneous requests (1–100). Default: 10' },
  { key: 'timeout',      label: 'Timeout (ms)',      tip: 'Per-request timeout in milliseconds (1000–120000). Default: 10000' },
  { key: 'outputDir',    label: 'Output Directory',  tip: 'Folder to save reports in. Created automatically if missing.' },
  { key: 'output',       label: 'File Prefix',       tip: 'Report filename prefix — e.g. "report" → report.json, report.html' },
];

// ── Main TUI class ────────────────────────────────────────────────────────────
class TUI {
  constructor() {
    this.screen      = null;
    this.activeTab   = 0;
    this.tabs        = ['1:Setup', '2:Scan', '3:Results', '4:History', '5:Info'];

    this.config = {
      url          : '',
      concurrency  : '10',
      timeout      : '10000',
      outputDir    : './reports',
      output       : 'report',
      formats      : ['json', 'txt', 'html'],
      rateLimitTest: false,
      verbose      : false,
    };

    this.scanLog     = [];
    this.scanRunning = false;
    this.scanReport  = null;
    this._fields     = [];          // { key, widget, isText } in tab order
    this._scanW      = {};          // scan screen widget refs
    this._focusedIdx = 0;
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  start() {
    logger.setSilent(true);

    this.screen = blessed.screen({
      smartCSR    : false,          // false = avoids some input-duplication quirks
      title       : `Spam Attacker v${VERSION}`,
      fullUnicode : true,
      dockBorders : false,
    });

    this._buildChrome();
    this._bindKeys();
    this.switchTab(0);
    this.screen.render();
  }

  // ── Chrome ────────────────────────────────────────────────────────────────
  _buildChrome() {
    const s = this.screen;

    this._topBar = blessed.box({
      parent: s, top: 0, left: 0,
      width: '100%', height: 3,
      tags: true, style: { bg: T.bg },
    });

    this._content = blessed.box({
      parent: s, top: 3, left: 0,
      width: '100%', height: s.height - 5,
      tags: true, style: { bg: T.bg },
    });

    this._statusBar = blessed.box({
      parent: s, bottom: 0, left: 0,
      width: '100%', height: 2,
      tags: true, style: { bg: T.bg },
    });

    s.on('resize', () => {
      this._content.height = this.screen.height - 5;
      this.switchTab(this.activeTab);
    });
  }

  _renderTopBar() {
    const w = this.screen.width;

    const tabStr = this.tabs.map((t, i) =>
      i === this.activeTab ? ` ${cb(T.text, t)} ` : ` ${c(T.dim, t)} `
    ).join(c(T.dim, '│'));

    const sep = c(T.dim, '─'.repeat(w));
    this._topBar.setContent(`\n ${tabStr}\n${sep}`);

    // Centered title
    if (this._titleEl) this._titleEl.detach();
    const title = `spam-attacker-${VERSION}`;
    const tl    = Math.floor((w - title.length - 2) / 2);
    this._titleEl = blessed.text({
      parent: this._topBar, top: 0, left: tl,
      tags: true, style: { bg: T.bg },
      content: `${c(T.dim, '|')}${bold(title)}${c(T.dim, '|')}`,
    });

    // Right: URL
    if (this._urlEl) this._urlEl.detach();
    const urlRaw = this.config.url || '';
    if (urlRaw) {
      const urlTrim = urlRaw.length > 34 ? '…' + urlRaw.slice(-33) : urlRaw;
      this._urlEl = blessed.text({
        parent: this._topBar, top: 1, right: 2,
        tags: true, style: { bg: T.bg },
        content: c(T.dim, urlTrim),
      });
    }
  }

  _setStatus(hints, tip = '') {
    const hintStr = hints
      .map(h => `${c(T.dim, '[')}${c(T.accent, h)}${c(T.dim, ']')}`)
      .join('  ');
    const tipStr = tip ? `   ${c('#666666', '│')}   ${c('#777777', tip)}` : '';
    this._statusBar.setContent(` ${hintStr}${tipStr}`);
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  _clearContent() {
    for (const child of [...(this._content.children || [])]) child.detach();
    this._fields     = [];
    this._scanW      = {};
    this._focusedIdx = 0;
  }

  switchTab(idx) {
    this.activeTab = idx;
    this._clearContent();
    this._renderTopBar();
    switch (idx) {
      case 0: this._renderSetup();   break;
      case 1: this._renderScan();    break;
      case 2: this._renderResults(); break;
      case 3: this._renderHistory(); break;
      case 4: this._renderInfo();    break;
    }
    this.screen.render();
  }

  // ── SETUP SCREEN ──────────────────────────────────────────────────────────
  _renderSetup() {
    const p = this._content;
    const w = this.screen.width;

    // Banner
    blessed.text({
      parent: p, top: 1, left: 'center',
      width: '100%', align: 'center',
      tags: true, style: { bg: T.bg },
      content: BANNER_LINES.map(l => c(T.accent, l)).join('\n'),
    });

    const bh     = BANNER_LINES.length;
    const formW  = Math.min(66, w - 6);
    const formL  = Math.floor((w - formW) / 2);
    const formTop = bh + 3;

    // Subtitle
    blessed.text({
      parent: p, top: bh + 2, width: '100%', align: 'center',
      tags: true, style: { bg: T.bg },
      content: c(T.dim, `Web Form Security Testing — v${VERSION}   |   Type a value and press Enter or Tab to advance`),
    });

    // ── Form panel ────────────────────────────────────────────────────────
    const formBox = blessed.box({
      parent: p, top: formTop, left: formL,
      width: formW, height: 14,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Configuration')}  `,
      tags: true,
      style: { bg: T.bg, border: { fg: T.border } },
    });

    // Text fields (URL, concurrency, timeout, outputDir, output)
    const LW = 16;
    const IW = formW - LW - 6;

    let row = 1;
    for (const def of FIELDS) {
      this._addTextField(formBox, row, def.key, def.label, LW, IW, def.tip);
      row += 2;
    }

    // ── Checkboxes (Formats + Options) ────────────────────────────────────
    const optBox = blessed.box({
      parent: p, top: formTop + 14 + 1, left: formL,
      width: formW, height: 5,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Options')}  `,
      tags: true,
      style: { bg: T.bg, border: { fg: T.border } },
    });

    blessed.text({
      parent: optBox, top: 1, left: 2,
      tags: true, style: { bg: T.bg },
      content: c(T.muted, 'Report formats:'),
    });

    let cbLeft = 20;
    for (const fmt of ['json', 'txt', 'html']) {
      const cb_ = blessed.checkbox({
        parent: optBox, top: 1, left: cbLeft,
        content: ` ${fmt.toUpperCase()}`,
        checked: this.config.formats.includes(fmt),
        mouse: true,
        style: { fg: T.accent, focus: { fg: 'white', bold: true } },
      });
      cb_.on('check',   () => { if (!this.config.formats.includes(fmt)) this.config.formats.push(fmt); });
      cb_.on('uncheck', () => { this.config.formats = this.config.formats.filter(f => f !== fmt); });
      cb_.key(['tab'],   () => this._focusField(this._focusedIdx + 1));
      cb_.key(['S-tab'], () => this._focusField(this._focusedIdx - 1));
      this._fields.push({ key: `fmt_${fmt}`, widget: cb_, isText: false });
      cbLeft += fmt.length + 7;
    }

    blessed.text({
      parent: optBox, top: 3, left: 2,
      tags: true, style: { bg: T.bg },
      content: c(T.muted, 'Test options:'),
    });

    const rl = blessed.checkbox({
      parent: optBox, top: 3, left: 20,
      content: ' Rate-limit Test',
      checked: this.config.rateLimitTest,
      mouse: true,
      style: { fg: T.accent, focus: { fg: 'white', bold: true } },
    });
    rl.on('check',   () => { this.config.rateLimitTest = true; });
    rl.on('uncheck', () => { this.config.rateLimitTest = false; });
    rl.key(['tab'],   () => this._focusField(this._focusedIdx + 1));
    rl.key(['S-tab'], () => this._focusField(this._focusedIdx - 1));
    this._fields.push({ key: 'rateLimitTest', widget: rl, isText: false });

    const vb = blessed.checkbox({
      parent: optBox, top: 3, left: 42,
      content: ' Verbose Logging',
      checked: this.config.verbose,
      mouse: true,
      style: { fg: T.accent, focus: { fg: 'white', bold: true } },
    });
    vb.on('check',   () => { this.config.verbose = true; });
    vb.on('uncheck', () => { this.config.verbose = false; });
    vb.key(['tab'],   () => this._focusField(this._focusedIdx + 1));
    vb.key(['S-tab'], () => this._focusField(this._focusedIdx - 1));
    this._fields.push({ key: 'verbose', widget: vb, isText: false });

    // ── Start button ──────────────────────────────────────────────────────
    const btnTop = formTop + 14 + 6 + 1;
    const btn    = blessed.button({
      parent: p, top: btnTop, left: 'center',
      width: 28, height: 3,
      content: '{center}{bold}▶   Start Scan{/}{/center}',
      tags: true, mouse: true,
      border: { type: 'line' },
      style: {
        bg: T.bg, fg: T.accent,
        border: { fg: T.accent },
        focus: { bg: T.accent, fg: 'black', border: { fg: T.accent } },
        hover:  { bg: T.accent, fg: 'black' },
      },
    });
    btn.on('press', () => this._startScan());
    btn.key(['enter'], () => this._startScan());
    btn.key(['tab'],   () => this._focusField(0));
    btn.key(['S-tab'], () => this._focusField(this._focusedIdx - 1));
    this._fields.push({ key: '__start__', widget: btn, isText: false });

    // Focus first field
    this._focusField(0);
    this._setStatus(
      ['Tab→Next', 'Shift+Tab→Prev', 'Enter→Confirm', 'Space→Toggle', '1-5→Tabs', '?→Help', 'q→Quit'],
      FIELDS[0].tip
    );
  }

  _addTextField(parent, top, key, label, LW, IW, tip) {
    const idx = this._fields.length;

    const labelEl = blessed.text({
      parent, top, left: 2,
      tags: true, style: { bg: T.bg },
      content: c(T.muted, label + ':'),
    });

    const tb = blessed.textbox({
      parent, top, left: LW + 2,
      width: IW, height: 1,
      value: this.config[key],
      inputOnFocus: true,
      // NOTE: keys/mouse intentionally omitted to prevent key-event duplication
      style: {
        bg: '#0a0a0a', fg: 'white',
        focus: { bg: '#002244', fg: 'cyan' },
      },
    });

    // Save value on Enter / submit
    tb.on('submit', (val) => {
      this.config[key] = val.trim() || this.config[key];
      this._updateLabel(labelEl, label, false);
      this._focusField(idx + 1);
    });

    tb.on('cancel', () => {
      this._focusField(idx + 1);
    });

    // Tab / Shift+Tab — must be registered via widget.key()
    // widget.key() hooks into screen.program and fires when widget is focused,
    // WITHOUT needing keys:true (which would cause bubbling/duplication)
    tb.key(['tab'], () => {
      this.config[key] = tb.getValue().trim() || this.config[key];
      this._updateLabel(labelEl, label, false);
      this._focusField(idx + 1);
    });
    tb.key(['S-tab'], () => {
      this.config[key] = tb.getValue().trim() || this.config[key];
      this._updateLabel(labelEl, label, false);
      this._focusField(idx - 1);
    });

    tb.on('focus', () => {
      this._focusedIdx = idx;
      this._updateLabel(labelEl, label, true);
      this._setStatus(
        ['Tab→Next', 'Shift+Tab→Prev', 'Enter→Confirm', '1-5→Tabs', 'q→Quit'],
        tip
      );
      this.screen.render();
    });

    tb.on('blur', () => {
      this._updateLabel(labelEl, label, false);
      this.screen.render();
    });

    this._fields.push({ key, widget: tb, isText: true, labelEl, label });
    return tb;
  }

  _updateLabel(el, label, focused) {
    if (!el) return;
    el.setContent(focused
      ? `${c(T.accent, '▶')} ${cb(T.accent, label + ':')}`
      : c(T.muted, label + ':')
    );
  }

  _focusField(idx) {
    const total = this._fields.length;
    if (total === 0) return;
    // Wrap around
    const i = ((idx % total) + total) % total;
    this._focusedIdx = i;
    const { widget, isText, labelEl, label } = this._fields[i];

    // Update non-focused labels
    for (const f of this._fields) {
      if (f.labelEl && f !== this._fields[i]) {
        this._updateLabel(f.labelEl, f.label, false);
      }
    }

    widget.focus();

    if (labelEl) this._updateLabel(labelEl, label, true);

    // Update status tip for this field
    const def = FIELDS.find(f => f.key === this._fields[i].key);
    const tip  = def ? def.tip : '';
    this._setStatus(
      ['Tab→Next', 'Shift+Tab→Prev', 'Enter→Confirm', 'Space→Toggle', '1-5→Tabs', '?→Help', 'q→Quit'],
      tip
    );

    this.screen.render();
  }

  // ── SCAN SCREEN ───────────────────────────────────────────────────────────
  _renderScan() {
    const p = this._content;
    const w = this.screen.width;
    const h = this._content.height;

    blessed.text({
      parent: p, top: 0, left: 2, tags: true, style: { bg: T.bg },
      content: `${cb(T.accent, 'Target:')}  ${c(T.text, this.config.url || c(T.dim, '(not set — go to Setup first)'))}`,
    });

    this._scanW.phase = blessed.text({
      parent: p, top: 2, left: 2, width: w - 4,
      tags: true, style: { bg: T.bg },
      content: this.scanRunning
        ? c(T.accent, 'Scanning…')
        : c(T.dim, 'Ready — configure in Setup tab and press ▶ Start Scan.'),
    });

    this._scanW.bar = blessed.progressbar({
      parent: p, top: 4, left: 2,
      width: w - 4, height: 1,
      filled: 0, ch: '█',
      style: { bg: '#1a1a1a', bar: { bg: 'cyan' } },
    });

    this._scanW.barLabel = blessed.text({
      parent: p, top: 5, left: 2,
      tags: true, style: { bg: T.bg }, content: '',
    });

    this._scanW.log = blessed.log({
      parent: p, top: 7, left: 2,
      width: w - 4, height: h - 8,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Scan Log')}  `,
      tags: true, scrollable: true, alwaysScroll: true, mouse: true,
      scrollbar: { ch: ' ', style: { bg: '#2a2a2a' } },
      style: { bg: T.bg, fg: '#cccccc', border: { fg: T.border } },
    });

    for (const line of this.scanLog) this._scanW.log.log(line);

    this._setStatus(['↑↓→Scroll', '1→Setup', '3→Results', '4→History', 'q→Quit']);
  }

  // ── RESULTS SCREEN ────────────────────────────────────────────────────────
  _renderResults() {
    const p = this._content;
    const w = this.screen.width;
    const h = this._content.height;

    if (!this.scanReport) {
      blessed.text({
        parent: p, top: Math.floor(h / 2), width: '100%', align: 'center',
        tags: true, style: { bg: T.bg },
        content: c(T.dim, 'No results yet — run a scan from the Setup tab.'),
      });
      this._setStatus(['1→Setup', '5→Info', 'q→Quit']);
      return;
    }

    const r    = this.scanReport;
    const perf = r.performance || {};
    const summ = r.summary || {};
    const iss  = r.issues || [];
    const is   = summarizeIssues(iss);
    const risk = is.high > 0 ? 'HIGH' : is.medium > 0 ? 'MEDIUM' : is.low > 0 ? 'LOW' : 'NONE';
    const half = Math.floor(w / 2);

    // Summary box
    const summBox = blessed.box({
      parent: p, top: 0, left: 0,
      width: half, height: 14,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Summary')}  `,
      tags: true,
      style: { bg: T.bg, border: { fg: T.border } },
    });

    blessed.text({
      parent: summBox, top: 1, left: 2, tags: true, style: { bg: T.bg },
      content: [
        `${c(T.muted, 'Target:')}         ${c(T.text, r.target)}`,
        `${c(T.muted, 'Date:')}           ${c(T.text, r.scan_date)}`,
        `${c(T.muted, 'Duration:')}       ${c(T.text, r.scan_time_seconds + 's')}`,
        '',
        `${c(T.muted, 'Forms Found:')}    ${c(T.accent, String(summ.forms_found))}`,
        `${c(T.muted, 'Fields Tested:')}  ${c(T.accent, String(summ.fields_tested))}`,
        `${c(T.muted, 'Requests:')}       ${c(T.accent, String(perf.total_requests))}`,
        `${c(T.muted, 'Success Rate:')}   ${c(T.accent, `${perf.success_rate}%`)}`,
        `${c(T.muted, 'Avg Response:')}   ${c(T.accent, formatMs(perf.average_response_time))}`,
        `${c(T.muted, 'Max Response:')}   ${c(T.accent, formatMs(perf.max_response_time))}`,
        '',
        `${c(T.muted, 'Overall Risk:')}   ${cb(riskFg(risk), risk)}`,
      ].join('\n'),
    });

    // Issue breakdown box
    const issBox = blessed.box({
      parent: p, top: 0, left: half,
      width: w - half, height: 14,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Issue Breakdown')}  `,
      tags: true,
      style: { bg: T.bg, border: { fg: T.border } },
    });

    blessed.text({
      parent: issBox, top: 2, left: 4, tags: true, style: { bg: T.bg },
      content: [
        `${c('red',    '●')}  High       ${cb('white', String(is.high))}`,
        '',
        `${c('yellow', '●')}  Medium     ${cb('white', String(is.medium))}`,
        '',
        `${c(T.muted,  '●')}  Low        ${cb('white', String(is.low))}`,
        '',
        c(T.dim, '─────────────────'),
        `   Total      ${cb('white', String(iss.length))}`,
      ].join('\n'),
    });

    // Issue list
    const listBox = blessed.box({
      parent: p, top: 14, left: 0,
      width: '100%', height: h - 14,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Detected Issues')}  `,
      tags: true,
      scrollable: true, alwaysScroll: true, mouse: true, keys: true,
      scrollbar: { ch: ' ', style: { bg: '#2a2a2a' } },
      style: { bg: T.bg, border: { fg: T.border } },
    });
    listBox.focus();

    if (iss.length === 0) {
      blessed.text({
        parent: listBox, top: 2, width: '100%', align: 'center',
        tags: true, style: { bg: T.bg },
        content: c(T.success, '✓  No issues detected — great job!'),
      });
    } else {
      const lines = [];
      for (let i = 0; i < iss.length; i++) {
        const issue = iss[i];
        const sc    = sevFg(issue.severity);
        lines.push(`${cb(sc, `${i + 1}. [${(issue.severity || '?').toUpperCase()}]`)} ${bold(issue.type || '')}`);
        lines.push(`   ${c(T.muted, 'Form:')} ${issue.form || 'N/A'}   ${c(T.muted, 'Field:')} ${issue.field || 'N/A'}`);
        lines.push(`   ${issue.description || ''}`);
        if (issue.recommendation) lines.push(`   ${c(T.dim, 'Fix:')} ${c(T.accent, issue.recommendation)}`);
        lines.push('');
      }
      blessed.text({
        parent: listBox, top: 0, left: 1,
        tags: true, style: { bg: T.bg },
        content: lines.join('\n'),
      });
    }

    this._setStatus(['↑↓→Scroll Issues', '1→Setup', '2→Scan Log', '4→History', '5→Info', 'q→Quit']);
  }

  // ── HISTORY SCREEN ────────────────────────────────────────────────────────
  _renderHistory() {
    const p = this._content;
    const w = this.screen.width;
    const h = this._content.height;

    let history = [];
    const hp = path.resolve(this.config.outputDir || '.', 'scan-history.json');
    if (fs.existsSync(hp)) {
      try { history = JSON.parse(fs.readFileSync(hp, 'utf8')); } catch { /* */ }
    }

    const box = blessed.box({
      parent: p, top: 0, left: 0,
      width: '100%', height: h,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Scan History')}  `,
      tags: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true,
      scrollbar: { ch: ' ', style: { bg: '#2a2a2a' } },
      style: { bg: T.bg, border: { fg: T.border } },
    });
    box.focus();

    if (history.length === 0) {
      blessed.text({
        parent: box, top: 2, width: '100%', align: 'center',
        tags: true, style: { bg: T.bg },
        content: c(T.dim, 'No history yet — complete a scan to see results here.'),
      });
      this._setStatus(['1→Setup', '5→Info', 'q→Quit']);
      return;
    }

    const COL = { DATE: 24, TARGET: 36, RISK: 10, ISSUES: 8 };
    const hdr = [
      cb(T.muted,
        'Date'.padEnd(COL.DATE) + 'Target'.padEnd(COL.TARGET) +
        'Risk'.padEnd(COL.RISK) + 'Issues'.padEnd(COL.ISSUES) + 'Forms'
      ),
      c(T.dim, '─'.repeat(Math.min(w - 6, 96))),
    ];

    const rows = [...history].reverse().map(e => {
      const rf  = riskFg((e.overall_risk || 'NONE').toUpperCase());
      const tgt = (e.target || '').length > COL.TARGET - 2
        ? (e.target || '').slice(0, COL.TARGET - 3) + '…'
        : e.target || '';
      return (
        c(T.text,  (e.scan_date || '').padEnd(COL.DATE)) +
        c(T.muted, tgt.padEnd(COL.TARGET)) +
        cb(rf,     (e.overall_risk || 'N/A').padEnd(COL.RISK)) +
        c(T.text,  String(e.summary?.issues_found ?? 0).padEnd(COL.ISSUES)) +
        c(T.text,  String(e.summary?.forms_found ?? 0))
      );
    });

    blessed.text({
      parent: box, top: 0, left: 1,
      tags: true, style: { bg: T.bg },
      content: [...hdr, ...rows].join('\n'),
    });

    this._setStatus(['↑↓→Scroll', '1→Setup', '3→Results', '5→Info', 'q→Quit']);
  }

  // ── INFO SCREEN ───────────────────────────────────────────────────────────
  _renderInfo() {
    const p = this._content;
    const w = this.screen.width;
    const h = this._content.height;
    const half = Math.floor(w / 2);

    // ── Tool info panel ────────────────────────────────────────────────────
    const infoBox = blessed.box({
      parent: p, top: 0, left: 0,
      width: half, height: Math.floor(h / 2),
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Tool Information')}  `,
      tags: true,
      style: { bg: T.bg, border: { fg: T.border } },
    });

    blessed.text({
      parent: infoBox, top: 1, left: 2, tags: true, style: { bg: T.bg },
      content: [
        `${c(T.muted, 'Name:')}      ${cb(T.accent, PKG.name || 'spam-attacker')}`,
        `${c(T.muted, 'Version:')}   ${cb(T.text, VERSION)}`,
        `${c(T.muted, 'License:')}   ${c(T.text, PKG.license || 'MIT')}`,
        `${c(T.muted, 'Runtime:')}   ${c(T.text, `Node.js ${process.version}`)}`,
        `${c(T.muted, 'Platform:')}  ${c(T.text, process.platform)}`,
        '',
        cb(T.accent, 'Purpose:'),
        `  ${c(T.text, 'Non-destructive web form security testing.')}`,
        `  ${c(T.text, 'Detects missing validation, rate-limit gaps,')}`,
        `  ${c(T.text, 'and performance issues in web forms.')}`,
      ].join('\n'),
    });

    // ── Dependencies panel ─────────────────────────────────────────────────
    const depsBox = blessed.box({
      parent: p, top: 0, left: half,
      width: w - half, height: Math.floor(h / 2),
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Dependencies')}  `,
      tags: true,
      style: { bg: T.bg, border: { fg: T.border } },
    });

    const deps = PKG.dependencies || {};
    const depLines = Object.entries(deps).map(([name, ver]) =>
      `  ${c(T.accent, name.padEnd(16))}  ${c(T.muted, ver)}`
    );

    blessed.text({
      parent: depsBox, top: 1, left: 1, tags: true, style: { bg: T.bg },
      content: depLines.join('\n'),
    });

    // ── CLI Options panel ──────────────────────────────────────────────────
    const cliBox = blessed.box({
      parent: p, top: Math.floor(h / 2), left: 0,
      width: '100%', height: Math.ceil(h / 2),
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'CLI Options')}  `,
      tags: true,
      scrollable: true, alwaysScroll: true, mouse: true, keys: true,
      scrollbar: { ch: ' ', style: { bg: '#2a2a2a' } },
      style: { bg: T.bg, border: { fg: T.border } },
    });
    cliBox.focus();

    const flags = [
      ['--url <url>',             'Target URL to scan (omit to launch this TUI)'],
      ['--concurrency <n>',       'Simultaneous requests (default: 10, max: 100)'],
      ['--timeout <ms>',          'Per-request timeout in ms (default: 10000)'],
      ['--output <prefix>',       'Report filename prefix (default: report)'],
      ['--output-dir <path>',     'Directory to save reports (default: .)'],
      ['--format <formats>',      'Comma-separated: json,txt,html (default: all)'],
      ['--allow-list <domains>',  'Comma-separated domain allow-list'],
      ['--rate-limit-test',       'Enable rate-limiting detection (burst requests)'],
      ['--verbose',               'Enable verbose logging output'],
      ['--version',               'Print version and exit'],
      ['--help',                  'Print help and exit'],
    ];

    const flagW = 28;
    const cliLines = [
      `  ${c(T.muted, 'Usage:')}  ${c(T.text, 'node index.js [options]')}`,
      '',
      ...flags.map(([f, d]) =>
        `  ${c(T.accent, f.padEnd(flagW))}  ${c(T.muted, d)}`
      ),
      '',
      `  ${c(T.muted, 'Examples:')}`,
      `  ${c(T.dim,   'node index.js')}`,
      `  ${c(T.dim,   'node index.js --url=https://example.com')}`,
      `  ${c(T.dim,   'node index.js --url=https://example.com --concurrency=20 --rate-limit-test')}`,
      `  ${c(T.dim,   'node index.js --url=https://example.com --format=json,html --output-dir=./out')}`,
    ];

    blessed.text({
      parent: cliBox, top: 0, left: 1, tags: true, style: { bg: T.bg },
      content: cliLines.join('\n'),
    });

    this._setStatus(['↑↓→Scroll CLI Options', '1→Setup', '3→Results', '4→History', 'q→Quit']);
  }

  // ── Scan orchestration ────────────────────────────────────────────────────
  _log(msg, color = '#cccccc') {
    const line = c(color, msg);
    this.scanLog.push(line);
    if (this._scanW.log) { this._scanW.log.log(line); this.screen.render(); }
  }

  _updateProgress(phase, cur, total) {
    if (this._scanW.phase) this._scanW.phase.setContent(c(T.accent, phase));
    if (this._scanW.bar && total > 0) {
      const pct = Math.round((cur / total) * 100);
      this._scanW.bar.setProgress(pct);
      if (this._scanW.barLabel)
        this._scanW.barLabel.setContent(c(T.dim, `${cur} / ${total}   (${pct}%)`));
    }
    this.screen.render();
  }

  async _startScan() {
    if (this.scanRunning) return;

    // Persist any un-submitted textbox value from the setup form
    for (const { key, widget, isText } of this._fields) {
      if (isText && typeof widget.getValue === 'function') {
        const v = widget.getValue().trim();
        if (v && !key.startsWith('fmt_') && key !== '__start__') this.config[key] = v;
      }
    }

    if (!this.config.url) {
      this._alert('Error', 'Target URL is required.', T.err); return;
    }
    try { new URL(this.config.url); }
    catch { this._alert('Error', 'Invalid URL — must start with http:// or https://', T.err); return; }

    this.scanRunning = true;
    this.scanLog     = [];
    this.scanReport  = null;

    this.switchTab(1);

    const meta        = { startTime: Date.now() };
    const concurrency = clamp(parseInt(this.config.concurrency, 10) || 10, 1, 100);
    const timeout     = clamp(parseInt(this.config.timeout, 10) || 10000, 1000, 120000);
    const prefix      = this.config.output || 'report';
    const outDir      = this.config.outputDir || '.';
    const formats     = this.config.formats.length > 0 ? this.config.formats : ['json', 'txt', 'html'];

    try {
      // 1 — Form discovery
      this._updateProgress('Discovering forms…', 0, 1);
      this._log(`▶  Fetching ${this.config.url}`, T.accent);

      let forms;
      try {
        forms = await scanForms(this.config.url, timeout);
        this._log(`✓  Found ${forms.length} form(s) with ${forms.reduce((a, f) => a + f.fieldCount, 0)} field(s)`, T.success);
        for (const f of forms) this._log(`   [${f.formId}]  ${f.method}  ${f.actionUrl}  — ${f.fieldCount} fields`, T.dim);
      } catch (err) {
        this._log(`✗  Discovery failed: ${err.message}`, T.err);
        this.scanRunning = false;
        return;
      }

      const engine     = createEngine({ concurrency, timeout, maxRps: 10 });
      const allResults = [];
      const allIssues  = [];
      let   rateStats  = [];

      // 2 — Validation tests
      if (forms.length > 0) {
        const total = forms.reduce((a, f) => a + buildValidationTasks(f).length, 0);
        let done = 0;
        this._updateProgress('Input validation tests…', 0, total);
        this._log(`▶  ${total} validation requests  (concurrency: ${concurrency})`, T.accent);

        const { issues, results, tasksRun } = await runValidationTests(
          forms, engine,
          () => { done++; this._updateProgress('Input validation tests…', done, total); }
        );
        allResults.push(...results);
        allIssues.push(...issues);
        this._log(
          `✓  Validation done: ${tasksRun} requests, ${issues.length} issue(s)`,
          issues.length > 0 ? T.warn : T.success
        );
      } else {
        this._log('⚠  No forms found — skipping validation tests', T.warn);
      }

      // 3 — Rate-limit tests
      if (this.config.rateLimitTest && forms.length > 0) {
        const burst = Math.min(DEFAULT_BURST_COUNT, 50);
        const total = forms.length * burst;
        let done = 0;
        this._updateProgress('Rate-limit detection…', 0, total);
        this._log(`▶  ${total} rate-limit requests`, T.accent);

        const { issues, results, stats } = await runRateLimitTests(
          forms, engine, burst,
          () => { done++; this._updateProgress('Rate-limit detection…', done, total); }
        );
        allResults.push(...results);
        allIssues.push(...issues);
        rateStats = stats;
        this._log(
          `✓  Rate-limit done: ${results.length} requests, ${issues.length} issue(s)`,
          issues.length > 0 ? T.warn : T.success
        );
      }

      // 4 — Reports
      this._updateProgress('Generating reports…', 1, 1);
      this._log('▶  Building reports…', T.accent);

      meta.endTime = Date.now();
      const report = buildReport({
        targetUrl: this.config.url, forms,
        issues: allIssues, allResults,
        rateLimitStats: rateStats, scanMeta: meta,
      });

      if (formats.includes('json')) { const fp = saveJSON(report, prefix, outDir); this._log(`✓  JSON → ${fp}`, T.success); }
      if (formats.includes('txt'))  { const fp = saveTXT(report, prefix, outDir);  this._log(`✓  TXT  → ${fp}`, T.success); }
      if (formats.includes('html')) { const fp = saveHTML(report, prefix, outDir); this._log(`✓  HTML → ${fp}`, T.success); }
      saveHistory(report, outDir);

      this.scanReport = report;

      const is  = summarizeIssues(allIssues);
      const dur = round((meta.endTime - meta.startTime) / 1000, 1);

      this._log('', '#cccccc');
      this._log('─── Scan Complete ─────────────────────────────────────', T.accent);
      this._log(`    Issues: ${allIssues.length}   High: ${is.high}   Medium: ${is.medium}   Low: ${is.low}`, 'white');
      this._log(`    Duration: ${dur}s`, T.dim);
      this._log('    Press [3] to view Results   [4] for History', T.dim);
      this._updateProgress('Scan complete ✓', 1, 1);

    } catch (err) {
      this._log(`✗  Fatal: ${err.message}`, T.err);
    } finally {
      this.scanRunning = false;
    }
  }

  // ── Help overlay ──────────────────────────────────────────────────────────
  _showHelp() {
    const ow = Math.min(64, this.screen.width - 4);
    const oh = 26;

    const overlay = blessed.box({
      parent: this.screen,
      top: 'center', left: 'center',
      width: ow, height: oh,
      border: { type: 'line' },
      label: `  ${cb(T.accent, 'Keyboard Shortcuts & Help')}  `,
      tags: true,
      style: { bg: 'black', border: { fg: T.accent } },
    });

    blessed.text({
      parent: overlay, top: 1, left: 2, tags: true, style: { bg: 'black' },
      content: [
        cb(T.accent, 'Navigation'),
        `  ${c(T.accent, '1')} / ${c(T.accent, '2')} / ${c(T.accent, '3')} / ${c(T.accent, '4')} / ${c(T.accent, '5')}    Switch tabs`,
        `  ${c(T.accent, 'Tab')}               Move to next field`,
        `  ${c(T.accent, 'Shift+Tab')}         Move to previous field`,
        `  ${c(T.accent, '↑ ↓')}              Scroll log / results / history`,
        `  ${c(T.accent, 'q')} / ${c(T.accent, 'Ctrl+C')}         Quit (blocked during scan)`,
        '',
        cb(T.accent, 'Setup Form'),
        `  ${c(T.accent, 'Enter')}             Confirm field & advance`,
        `  ${c(T.accent, 'Space')}             Toggle checkbox`,
        `  ${c(T.accent, 'Escape')}            Cancel field edit`,
        '',
        cb(T.accent, 'Scan'),
        `  ${c(T.accent, 'Enter')} on button   Start scan`,
        `  ${c(T.accent, '3')}                 View results after scan`,
        '',
        cb(T.accent, 'Report Formats'),
        `  ${c(T.text, 'JSON')}   Machine-readable structured data`,
        `  ${c(T.text, 'TXT')}    Human-readable plain text`,
        `  ${c(T.text, 'HTML')}   Visual report for browser viewing`,
        '',
        cb(T.accent, 'Exit Codes (CLI mode)'),
        `  ${c(T.success, '0')}   No issues   ${c(T.warn, '1')}   High severity   ${c('red', '2')}   Medium/Low issues`,
        '',
        c(T.dim, 'Press any key or Escape to close this overlay'),
      ].join('\n'),
    });

    const close = () => { overlay.detach(); this.screen.render(); };
    overlay.key(['escape', '?', 'q', 'enter', 'space'], close);
    this.screen.key(['escape'], close);
    overlay.focus();
    this.screen.render();
  }

  // ── Alert box ─────────────────────────────────────────────────────────────
  _alert(title, text, borderColor = T.accent) {
    const box = blessed.message({
      parent: this.screen,
      top: 'center', left: 'center',
      width: Math.min(58, this.screen.width - 8), height: 7,
      border: { type: 'line' },
      label: `  ${cb(borderColor, title)}  `,
      tags: true,
      style: { bg: 'black', fg: 'white', border: { fg: borderColor } },
    });
    box.error(text, 3500, () => { box.detach(); this.screen.render(); });
  }

  // ── Global key bindings ───────────────────────────────────────────────────
  _bindKeys() {
    const s = this.screen;

    s.key(['q', 'C-c'], () => {
      if (!this.scanRunning) { logger.setSilent(false); process.exit(0); }
    });

    // Tab switching — number keys only (no global tab handler to avoid textbox conflicts)
    s.key(['1'], () => this.switchTab(0));
    s.key(['2'], () => { if (!this.scanRunning) this.switchTab(1); });
    s.key(['3'], () => this.switchTab(2));
    s.key(['4'], () => this.switchTab(3));
    s.key(['5'], () => this.switchTab(4));

    // Help overlay
    s.key(['?'], () => this._showHelp());
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
function startTUI() {
  const tui = new TUI();
  tui.start();
}

module.exports = { startTUI };

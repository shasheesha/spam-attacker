'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { escapeHtml, severityColor, formatMs } = require('../utils/helpers');

function severityBadge(severity) {
  const bg = severityColor(severity);
  return `<span style="background:${bg};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(severity || 'Info')}</span>`;
}

function metricCard(label, value, sub = '') {
  return `
    <div style="background:#fff;border-radius:10px;padding:18px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.07);min-width:160px;flex:1;">
      <div style="font-size:13px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:28px;font-weight:700;color:#2c3e50;">${escapeHtml(String(value))}</div>
      ${sub ? `<div style="font-size:12px;color:#95a5a6;margin-top:4px;">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function issueTypeLabel(type) {
  const map = {
    weak_validation: 'Weak Validation',
    no_rate_limiting: 'No Rate Limiting',
    inconsistent_rate_limiting: 'Inconsistent Rate Limiting',
    intermittent_captcha: 'Intermittent CAPTCHA',
    temporary_blocking: 'Temporary Blocking',
  };
  return map[type] || type;
}

/**
 * Render the full HTML report as a string.
 */
function renderHTML(report) {
  const issueRows = report.issues.map(issue => `
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #ecf0f1;">${severityBadge(issue.severity)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #ecf0f1;font-weight:600;color:#2c3e50;">${escapeHtml(issueTypeLabel(issue.type))}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #ecf0f1;color:#7f8c8d;">${escapeHtml(issue.form || '—')}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #ecf0f1;color:#7f8c8d;">${escapeHtml(issue.field || '—')}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #ecf0f1;">${escapeHtml(issue.description)}</td>
    </tr>`).join('');

  const recCards = report.recommendations.map(rec => `
    <div style="background:#fff;border-left:4px solid ${severityColor(rec.severity)};border-radius:6px;padding:16px 20px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        ${severityBadge(rec.severity)}
        <span style="font-weight:700;color:#2c3e50;font-size:15px;">${escapeHtml(rec.title)}</span>
      </div>
      <p style="margin:0;color:#555;line-height:1.6;font-size:14px;">${escapeHtml(rec.detail)}</p>
    </div>`).join('');

  const formRows = report.forms.map(form => {
    const fieldList = form.fields.map(f => {
      const attrs = [
        f.required ? '<span style="color:#e74c3c;font-weight:700;">required</span>' : '',
        f.minlength != null ? `min=${f.minlength}` : '',
        f.maxlength != null ? `max=${f.maxlength}` : '',
      ].filter(Boolean).join(', ');
      return `<li style="margin-bottom:4px;"><code style="background:#eaf0fb;padding:1px 6px;border-radius:4px;">${escapeHtml(f.name)}</code> <span style="color:#7f8c8d;font-size:13px;">(type: ${escapeHtml(f.type)}${attrs ? ' — ' : ''}${attrs})</span></li>`;
    }).join('');

    return `
      <div style="background:#fff;border-radius:8px;padding:18px 22px;margin-bottom:16px;box-shadow:0 1px 5px rgba(0,0,0,0.07);">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="font-weight:700;color:#2c3e50;font-size:15px;">${escapeHtml(form.form_id)}</span>
          <span style="background:#3498db;color:#fff;padding:2px 10px;border-radius:10px;font-size:12px;">${escapeHtml(form.method)}</span>
          <span style="color:#7f8c8d;font-size:13px;word-break:break-all;">${escapeHtml(form.action_url)}</span>
        </div>
        <ul style="margin:0;padding-left:20px;list-style:disc;">${fieldList || '<li style="color:#aaa;">No named fields found</li>'}</ul>
      </div>`;
  }).join('');

  const highCount = report.summary.issues_high;
  const medCount = report.summary.issues_medium;
  const lowCount = report.summary.issues_low;

  const overallColor = highCount > 0 ? '#e74c3c' : medCount > 0 ? '#e67e22' : lowCount > 0 ? '#f1c40f' : '#2ecc71';
  const overallLabel = highCount > 0 ? 'High Risk' : medCount > 0 ? 'Medium Risk' : lowCount > 0 ? 'Low Risk' : 'Looks Good';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Form Security Report — ${escapeHtml(report.target)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f0f2f5;
      color: #333;
      font-size: 15px;
    }
    a { color: #3498db; }
    code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px 60px; }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #fff;
      padding: 40px 32px 32px;
      border-radius: 14px;
      margin-bottom: 30px;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -60px; right: -60px;
      width: 220px; height: 220px;
      border-radius: 50%;
      background: rgba(255,255,255,0.04);
    }
    .header h1 { margin: 0 0 8px; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .header .subtitle { margin: 0; color: #a0b4cc; font-size: 14px; }
    .header .meta { margin-top: 18px; display: flex; gap: 24px; flex-wrap: wrap; }
    .header .meta span { font-size: 13px; color: #8eacc8; }
    .header .meta strong { color: #fff; }
    .overall-badge {
      display: inline-block;
      padding: 6px 18px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 14px;
      color: #fff;
      background: ${overallColor};
      margin-top: 14px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #2c3e50;
      margin: 32px 0 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e8eaed;
    }
    .metrics-grid { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
    .issues-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    .issues-table th {
      background: #2c3e50;
      color: #fff;
      padding: 12px 14px;
      text-align: left;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .issues-table td { vertical-align: top; font-size: 14px; }
    .issues-table tr:last-child td { border-bottom: none; }
    .no-issues {
      background: #eafaf1;
      border: 1px solid #a9dfbf;
      border-radius: 8px;
      padding: 18px 22px;
      color: #1e8449;
      font-weight: 600;
    }
    .footer {
      margin-top: 48px;
      text-align: center;
      color: #aaa;
      font-size: 13px;
    }
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>Web Form Security Testing Report</h1>
    <p class="subtitle">Automated validation, rate-limiting, and performance analysis</p>
    <div class="meta">
      <span><strong>Target:</strong> ${escapeHtml(report.target)}</span>
      <span><strong>Date:</strong> ${escapeHtml(report.scan_date)}</span>
      ${report.scan_time_seconds != null ? `<span><strong>Duration:</strong> ${escapeHtml(String(report.scan_time_seconds))}s</span>` : ''}
    </div>
    <div class="overall-badge">${overallLabel}</div>
  </div>

  <!-- Summary Cards -->
  <div class="section-title">Summary</div>
  <div class="metrics-grid">
    ${metricCard('Forms Found', report.summary.forms_found)}
    ${metricCard('Fields Tested', report.summary.fields_tested)}
    ${metricCard('Issues Found', report.summary.issues_found, `High: ${highCount} / Med: ${medCount} / Low: ${lowCount}`)}
  </div>

  <!-- Performance -->
  <div class="section-title">Performance Metrics</div>
  <div class="metrics-grid">
    ${metricCard('Avg Response', formatMs(report.performance.average_response_time))}
    ${metricCard('Max Response', formatMs(report.performance.max_response_time))}
    ${metricCard('Min Response', formatMs(report.performance.min_response_time))}
    ${metricCard('Total Requests', report.performance.total_requests)}
    ${metricCard('Success Rate', `${report.performance.success_rate}%`)}
    ${metricCard('Throughput', `${report.performance.throughput_rps} rps`)}
  </div>

  <!-- Forms -->
  <div class="section-title">Forms Discovered</div>
  ${report.forms.length === 0 ? '<p style="color:#aaa;">No forms were found on the target page.</p>' : formRows}

  <!-- Issues -->
  <div class="section-title">Detected Issues</div>
  ${report.issues.length === 0
    ? '<div class="no-issues">No security issues were detected during this scan.</div>'
    : `<table class="issues-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Type</th>
            <th>Form</th>
            <th>Field</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>${issueRows}</tbody>
      </table>`
  }

  <!-- Recommendations -->
  <div class="section-title">Recommendations</div>
  ${report.recommendations.length === 0
    ? '<p style="color:#aaa;">No recommendations at this time.</p>'
    : recCards
  }

  <div class="footer">
    Generated by Web Form Security Testing Tool &mdash; ${escapeHtml(report.scan_date)}
  </div>

</div>
</body>
</html>`;
}

/**
 * Save the report as an HTML file.
 *
 * @param {object} report       - Full report object
 * @param {string} outputPrefix - File prefix (e.g. "report" → "report.html")
 * @returns {string}            - Absolute path of the written file
 */
function saveHTML(report, outputPrefix = 'report') {
  const filePath = path.resolve(`${outputPrefix}.html`);
  const content = renderHTML(report);

  try {
    fs.writeFileSync(filePath, content, 'utf8');
    logger.success(`HTML report saved: ${filePath}`);
    return filePath;
  } catch (err) {
    logger.error(`Failed to write HTML report to ${filePath}: ${err.message}`);
    throw err;
  }
}

module.exports = { saveHTML, renderHTML };

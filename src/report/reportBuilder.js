'use strict';

const { summarizeIssues, computePerformanceMetrics } = require('../core/responseAnalyzer');
const { todayDate, round } = require('../utils/helpers');

// ---------------------------------------------------------------------------
// Recommendations engine
// ---------------------------------------------------------------------------

const RECOMMENDATIONS = {
  weak_validation: {
    title: 'Enforce Server-Side Validation',
    detail:
      'Client-side HTML5 constraints (required, pattern, type="email") can be bypassed by any HTTP client. ' +
      'Always validate and sanitise all input on the server before processing or storing it.',
  },
  no_rate_limiting: {
    title: 'Implement Rate Limiting on Form Endpoints',
    detail:
      'Without rate limiting, form endpoints are vulnerable to brute-force, credential stuffing, and spam attacks. ' +
      'Use middleware such as express-rate-limit, nginx limit_req, or a WAF to cap requests per IP/session.',
  },
  inconsistent_rate_limiting: {
    title: 'Harden Rate Limiting Configuration',
    detail:
      'Inconsistent rate limiting means some requests slip through. Audit your rate-limiting rules to ensure ' +
      'they are applied uniformly to all requests reaching the form handler.',
  },
  intermittent_captcha: {
    title: 'Standardise CAPTCHA Enforcement',
    detail:
      'CAPTCHA challenges that only appear sometimes give a false sense of security. ' +
      'Ensure CAPTCHA is triggered consistently when bot-like access patterns are detected.',
  },
  temporary_blocking: {
    title: 'Review Blocking & Recovery Window Configuration',
    detail:
      'Temporary blocking is a good sign, but verify that the block duration is sufficient to deter automated attacks ' +
      'and that recovery windows do not allow attackers to retry in short cycles.',
  },
};

/**
 * Generate recommendations from the set of detected issues.
 *
 * @param {Array<object>} issues
 * @returns {Array<object>}
 */
function buildRecommendations(issues) {
  const seen = new Set();
  const recs = [];

  for (const issue of issues) {
    const key = issue.type;
    if (seen.has(key)) continue;
    seen.add(key);

    const template = RECOMMENDATIONS[key];
    if (template) {
      recs.push({
        issue_type: key,
        severity: issue.severity,
        title: template.title,
        detail: template.detail,
      });
    } else {
      // Fallback for issue types without a template
      recs.push({
        issue_type: key,
        severity: issue.severity,
        title: `Address: ${key.replace(/_/g, ' ')}`,
        detail: issue.recommendation || 'Review the flagged behaviour and apply appropriate server-side controls.',
      });
    }
  }

  // Deduplicate by title
  const unique = [];
  const titles = new Set();
  for (const r of recs) {
    if (!titles.has(r.title)) {
      titles.add(r.title);
      unique.push(r);
    }
  }

  return unique;
}

/**
 * Assemble the complete report object.
 *
 * @param {object} opts
 * @param {string}         opts.targetUrl
 * @param {Array<object>}  opts.forms
 * @param {Array<object>}  opts.issues
 * @param {Array<object>}  opts.allResults        - Raw request results
 * @param {Array<object>}  opts.rateLimitStats     - Stats from rate-limit tests
 * @param {object}         opts.scanMeta           - { startTime, endTime }
 * @returns {object}
 */
function buildReport({ targetUrl, forms, issues, allResults, rateLimitStats = [], scanMeta = {} }) {
  const performance = computePerformanceMetrics(allResults);
  const issueSummary = summarizeIssues(issues);
  const recommendations = buildRecommendations(issues);

  const totalFields = forms.reduce((acc, f) => acc + f.fieldCount, 0);

  const scanDuration =
    scanMeta.startTime && scanMeta.endTime
      ? round((scanMeta.endTime - scanMeta.startTime) / 1000, 1)
      : null;

  return {
    target: targetUrl,
    scan_date: todayDate(),
    scan_time_seconds: scanDuration,
    summary: {
      forms_found: forms.length,
      fields_tested: totalFields,
      issues_found: issueSummary.total,
      issues_high: issueSummary.high,
      issues_medium: issueSummary.medium,
      issues_low: issueSummary.low,
    },
    performance: {
      average_response_time: performance.average_response_time,
      max_response_time: performance.max_response_time,
      min_response_time: performance.min_response_time,
      total_requests: performance.total_requests,
      successful_requests: performance.successful_requests,
      failed_requests: performance.failed_requests,
      success_rate: performance.success_rate,
      throughput_rps: performance.throughput_rps,
    },
    forms: forms.map(f => ({
      form_id: f.formId,
      action_url: f.actionUrl,
      method: f.method,
      field_count: f.fieldCount,
      fields: f.fields.map(field => ({
        name: field.name,
        type: field.type,
        required: field.required,
        minlength: field.minlength,
        maxlength: field.maxlength,
      })),
    })),
    rate_limit_stats: rateLimitStats,
    issues: issues.map(issue => ({
      type: issue.type,
      severity: issue.severity,
      description: issue.description,
      form: issue.form || null,
      field: issue.field || null,
      recommendation: issue.recommendation || null,
    })),
    recommendations,
  };
}

module.exports = { buildReport, buildRecommendations };

'use strict';

const { average, round } = require('../utils/helpers');
const logger = require('../utils/logger');

// Keywords that indicate a successful form submission (server-side acceptance)
const SUCCESS_KEYWORDS = [
  'thank you', 'thanks', 'success', 'submitted', 'received',
  'confirmed', 'welcome', 'registered', 'complete', 'done',
];

// Keywords that indicate a validation error from the server
const VALIDATION_ERROR_KEYWORDS = [
  'invalid', 'error', 'required', 'must be', 'cannot be', 'not valid',
  'please enter', 'please provide', 'field is required', 'validation failed',
  'bad request', 'incorrect', 'wrong format',
];

// Keywords that suggest a captcha is active
const CAPTCHA_KEYWORDS = [
  'captcha', 'recaptcha', 'hcaptcha', 'i am not a robot', 'are you human',
  'verify you are human', 'challenge', 'bot detection',
];

/**
 * Classify a response body's textual content.
 */
function classifyBody(body) {
  if (!body) return { hasSuccess: false, hasValidationError: false, hasCaptcha: false };

  const text = (typeof body === 'string' ? body : JSON.stringify(body)).toLowerCase();

  return {
    hasSuccess: SUCCESS_KEYWORDS.some(k => text.includes(k)),
    hasValidationError: VALIDATION_ERROR_KEYWORDS.some(k => text.includes(k)),
    hasCaptcha: CAPTCHA_KEYWORDS.some(k => text.includes(k)),
    matchedSuccessKeyword: SUCCESS_KEYWORDS.find(k => text.includes(k)) || null,
    matchedValidationKeyword: VALIDATION_ERROR_KEYWORDS.find(k => text.includes(k)) || null,
    matchedCaptchaKeyword: CAPTCHA_KEYWORDS.find(k => text.includes(k)) || null,
  };
}

/**
 * Determine if a response indicates the server accepted potentially bad input.
 */
function isUnexpectedSuccess(result, expectedToFail) {
  if (!result.success || result.status === null) return false;
  if (!expectedToFail) return false;

  const body = classifyBody(result.data);

  // A 2xx with a success keyword when we expected the server to reject = unexpected
  if (result.status >= 200 && result.status < 300 && body.hasSuccess) return true;

  // Server returned 200 but no validation error either — might have silently accepted
  if (result.status === 200 && !body.hasValidationError) return true;

  return false;
}

/**
 * Compute aggregate performance metrics from an array of result objects.
 */
function computePerformanceMetrics(results) {
  const successful = results.filter(r => r.success && r.responseTime != null);
  const times = successful.map(r => r.responseTime);

  if (times.length === 0) {
    return {
      average_response_time: 0,
      max_response_time: 0,
      min_response_time: 0,
      total_requests: results.length,
      successful_requests: 0,
      failed_requests: results.length,
      success_rate: 0,
      throughput_rps: 0,
    };
  }

  const totalTime = times.reduce((a, b) => a + b, 0);
  const elapsed_ms = Math.max(...times) || 1;

  return {
    average_response_time: round(average(times)),
    max_response_time: Math.max(...times),
    min_response_time: Math.min(...times),
    total_requests: results.length,
    successful_requests: successful.length,
    failed_requests: results.length - successful.length,
    success_rate: round((successful.length / results.length) * 100),
    throughput_rps: round((results.length / (totalTime / 1000)) * successful.length / results.length),
  };
}

/**
 * Analyse a batch of results from validation tests and extract issues.
 *
 * @param {Array<object>} results     - Results from the request engine
 * @param {string}        formId      - Identifier of the form being tested
 * @param {string}        fieldName   - Name of the field being tested
 * @param {string}        testType    - Human label for the test type
 * @param {boolean}       expectedToFail - Whether the server should have rejected the input
 * @returns {Array<object>}           - Detected issues
 */
function analyzeValidationResults(results, formId, fieldName, testType, expectedToFail = true) {
  const issues = [];

  const statusCodes = {};
  for (const r of results) {
    const code = r.status != null ? String(r.status) : 'network_error';
    statusCodes[code] = (statusCodes[code] || 0) + 1;
  }

  logger.verbose(`[analyzeValidation] ${testType} | field="${fieldName}" | statuses=${JSON.stringify(statusCodes)}`);

  for (const result of results) {
    if (!result.success) {
      // Network-level failure — not necessarily a security issue
      continue;
    }

    const body = classifyBody(result.data);

    // Case 1: Server accepted obviously invalid input
    if (expectedToFail && isUnexpectedSuccess(result, expectedToFail)) {
      issues.push({
        type: 'weak_validation',
        test: testType,
        description: `Server accepted invalid input for field "${fieldName}" (${testType}). Server responded with HTTP ${result.status} and a success indicator without rejecting the payload.`,
        field: fieldName,
        form: formId,
        severity: 'High',
        status: result.status,
        payload: result.payload,
        matchedKeyword: body.matchedSuccessKeyword,
        recommendation: `Implement server-side validation for field "${fieldName}". Never rely solely on client-side HTML5 constraints.`,
      });
    }

    // Case 2: Captcha detected — note it but don't flag as issue
    if (body.hasCaptcha) {
      logger.verbose(`[analyzeValidation] Captcha detected in response for field "${fieldName}"`);
    }
  }

  return issues;
}

/**
 * Analyse a batch of rate-limit test results.
 */
function analyzeRateLimitResults(results, formId) {
  const issues = [];

  const total = results.length;
  const rateLimited = results.filter(r => r.status === 429).length;
  const blocked = results.filter(r => r.status === 403 || r.status === 503).length;
  const captchaDetected = results.filter(r => classifyBody(r.data).hasCaptcha).length;
  const succeeded = results.filter(r => r.success && r.status >= 200 && r.status < 300).length;

  logger.verbose(
    `[analyzeRateLimit] form="${formId}" total=${total} 429=${rateLimited} blocked=${blocked} captcha=${captchaDetected} 2xx=${succeeded}`
  );

  const rateLimitRatio = rateLimited / total;
  const successRatio = succeeded / total;

  if (rateLimited === 0 && blocked === 0 && captchaDetected === 0) {
    if (successRatio > 0.9) {
      issues.push({
        type: 'no_rate_limiting',
        description: `No rate limiting detected for form "${formId}". All ${total} rapid repeated requests succeeded (HTTP 2xx) without triggering a 429 or blocking response.`,
        field: null,
        form: formId,
        severity: 'High',
        successRatio: round(successRatio * 100),
        recommendation:
          'Implement server-side rate limiting (e.g., express-rate-limit, nginx limit_req) and consider adding CAPTCHA for sensitive forms.',
      });
    }
  } else if (rateLimitRatio > 0 && rateLimitRatio < 0.5) {
    issues.push({
      type: 'inconsistent_rate_limiting',
      description: `Inconsistent rate limiting for form "${formId}". Only ${rateLimited}/${total} requests triggered HTTP 429. A determined attacker may still get through.`,
      field: null,
      form: formId,
      severity: 'Medium',
      rateLimitedCount: rateLimited,
      totalRequests: total,
      recommendation:
        'Review rate limiting configuration. Ensure it applies consistently to all requests from the same origin/IP.',
    });
  }

  if (captchaDetected > 0 && captchaDetected < total) {
    issues.push({
      type: 'intermittent_captcha',
      description: `CAPTCHA appeared in ${captchaDetected}/${total} responses for form "${formId}", suggesting inconsistent bot protection.`,
      field: null,
      form: formId,
      severity: 'Low',
      captchaCount: captchaDetected,
      totalRequests: total,
      recommendation:
        'Ensure CAPTCHA or challenge is shown consistently when automated/rapid access is detected.',
    });
  }

  return {
    issues,
    stats: {
      total,
      rateLimited,
      blocked,
      captchaDetected,
      succeeded,
    },
  };
}

/**
 * Classify all collected issues by severity.
 */
function summarizeIssues(issues) {
  return {
    high: issues.filter(i => i.severity === 'High').length,
    medium: issues.filter(i => i.severity === 'Medium').length,
    low: issues.filter(i => i.severity === 'Low').length,
    total: issues.length,
  };
}

module.exports = {
  classifyBody,
  isUnexpectedSuccess,
  computePerformanceMetrics,
  analyzeValidationResults,
  analyzeRateLimitResults,
  summarizeIssues,
};

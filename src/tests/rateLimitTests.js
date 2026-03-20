'use strict';

const { analyzeRateLimitResults } = require('../core/responseAnalyzer');
const { buildBasePayload } = require('./validationTests');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');

// Default number of repetitions when testing rate limiting
const DEFAULT_BURST_COUNT = 30;

/**
 * Build a set of identical repeated tasks to detect rate limiting.
 *
 * @param {object} form          - Parsed form object
 * @param {number} burstCount    - How many requests to send
 * @returns {Array<object>}      - Array of task objects
 */
function buildRateLimitTasks(form, burstCount = DEFAULT_BURST_COUNT) {
  const basePayload = buildBasePayload(form.fields, '__none__');

  // Fill in any field values so the form is "technically valid" — we want
  // to see if the server rate-limits the endpoint itself, not reject based
  // on payload validity.
  for (const field of form.fields) {
    if (!field.name) continue;
    if (!(field.name in basePayload)) {
      switch (field.type) {
        case 'email':
          basePayload[field.name] = 'ratelimit-test@example.com';
          break;
        case 'number':
          basePayload[field.name] = '1';
          break;
        case 'checkbox':
          basePayload[field.name] = 'on';
          break;
        case 'radio':
          basePayload[field.name] = field.value || 'on';
          break;
        case 'select':
          basePayload[field.name] = field.options?.[0] || '';
          break;
        default:
          basePayload[field.name] = 'ratelimit-test';
      }
    }
  }

  return Array.from({ length: burstCount }, (_, i) => ({
    url: form.actionUrl,
    method: form.method,
    enctype: form.enctype,
    data: { ...basePayload },
    label: `rate-limit:${form.formId}:req-${i + 1}`,
  }));
}

/**
 * Detect temporary blocking by checking if responses transition from 2xx → 4xx/5xx.
 */
function detectTemporaryBlocking(results) {
  let phase = 'open'; // open → blocked
  let blockStart = null;
  let blockEnd = null;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.success) continue;

    const blocked = r.status === 429 || r.status === 403 || r.status === 503;

    if (phase === 'open' && blocked) {
      phase = 'blocked';
      blockStart = i + 1;
    }
    if (phase === 'blocked' && !blocked) {
      blockEnd = i + 1;
      // Reverted to open — transient block
      phase = 'open';
    }
  }

  return {
    temporaryBlockDetected: blockStart !== null,
    blockStartedAtRequest: blockStart,
    blockEndedAtRequest: blockEnd,
  };
}

/**
 * Detect if CAPTCHA keywords appear in any response body.
 */
function detectCaptcha(results) {
  const CAPTCHA_KEYWORDS = [
    'captcha', 'recaptcha', 'hcaptcha', 'i am not a robot',
    'are you human', 'verify you are human', 'challenge',
    'bot detection',
  ];

  const hits = [];
  for (const r of results) {
    if (!r.data) continue;
    const text = (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)).toLowerCase();
    const matched = CAPTCHA_KEYWORDS.filter(k => text.includes(k));
    if (matched.length > 0) {
      hits.push({ label: r.label, keywords: matched, status: r.status });
    }
  }

  return hits;
}

/**
 * Run rate-limit tests against all forms.
 *
 * @param {Array<object>} forms       - Parsed form objects
 * @param {object}        engine      - Request engine
 * @param {number}        burstCount  - Requests to fire per form
 * @param {Function}      [onProgress]- Called after each completed request
 * @returns {object}                  - { issues, results, stats }
 */
async function runRateLimitTests(forms, engine, burstCount = DEFAULT_BURST_COUNT, onProgress) {
  const allIssues = [];
  const allResults = [];
  const allStats = [];

  for (const form of forms) {
    logger.verbose(`Running rate-limit tests on form #${form.formIndex} [${form.formId}]…`);
    logger.verbose(`  Sending ${burstCount} rapid requests to: ${form.actionUrl}`);

    const tasks = buildRateLimitTasks(form, burstCount);

    // Use a higher concurrency for rate-limit tests to actually stress the endpoint
    const results = await engine.run(tasks, onProgress);

    const captchaHits = detectCaptcha(results);
    const blockingInfo = detectTemporaryBlocking(results);

    if (captchaHits.length > 0) {
      logger.info(`  CAPTCHA detected in ${captchaHits.length} response(s) for form [${form.formId}].`);
    }

    if (blockingInfo.temporaryBlockDetected) {
      logger.info(
        `  Temporary blocking detected starting at request #${blockingInfo.blockStartedAtRequest} for form [${form.formId}].`
      );
    }

    const { issues, stats } = analyzeRateLimitResults(results, form.formId);

    // Append extra blocking details to the issues if detected
    if (blockingInfo.temporaryBlockDetected && issues.length === 0) {
      issues.push({
        type: 'temporary_blocking',
        description: `Temporary blocking observed for form "${form.formId}". Requests were blocked starting at request #${blockingInfo.blockStartedAtRequest}${blockingInfo.blockEndedAtRequest ? `, recovering by request #${blockingInfo.blockEndedAtRequest}` : ''}.`,
        field: null,
        form: form.formId,
        severity: 'Low',
        recommendation:
          'Temporary blocking may indicate rate limiting is in place but configured with a recovery window. Verify this is intentional and adequately tuned.',
      });
    }

    allIssues.push(...issues);
    allResults.push(...results);
    allStats.push({ formId: form.formId, ...stats, ...blockingInfo, captchaHits });

    logger.verbose(`  Completed rate-limit tests for form [${form.formId}].`);

    // Brief pause between forms to be respectful to the server
    await sleep(500);
  }

  return { issues: allIssues, results: allResults, stats: allStats };
}

module.exports = {
  runRateLimitTests,
  buildRateLimitTasks,
  detectTemporaryBlocking,
  detectCaptcha,
  DEFAULT_BURST_COUNT,
};

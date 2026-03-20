'use strict';

const axios = require('axios');
const pLimit = require('p-limit');
const { sleep, buildFormData } = require('../utils/helpers');
const logger = require('../utils/logger');

// Default throttle: no more than 10 requests per second
const DEFAULT_MAX_RPS = 10;

/**
 * Create an axios instance pre-configured for form testing.
 */
function createClient(timeout = 10000) {
  return axios.create({
    timeout,
    maxRedirects: 5,
    validateStatus: () => true, // Never throw on HTTP errors — we want to inspect them
    headers: {
      'User-Agent': 'WebFormSecurityTester/1.0 (safety-testing; non-destructive)',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
}

/**
 * Send a single form request and return a result object.
 *
 * @param {object} opts
 * @param {string}  opts.url        - Target URL
 * @param {string}  opts.method     - HTTP method (GET|POST)
 * @param {object}  opts.data       - Key/value payload
 * @param {string}  opts.enctype    - Form encoding type
 * @param {object}  opts.client     - Pre-created axios instance
 * @param {string}  opts.label      - Human-readable label for logging
 * @param {number}  opts.retries    - Number of retry attempts on network error
 */
async function sendRequest({ url, method, data = {}, enctype, client, label = '', retries = 2 }) {
  const startTime = Date.now();

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      let response;

      if (method.toUpperCase() === 'POST') {
        const isMultipart = enctype === 'multipart/form-data';
        const body = isMultipart ? data : buildFormData(data);
        const contentType = isMultipart
          ? 'multipart/form-data'
          : 'application/x-www-form-urlencoded';

        response = await client.post(url, body, {
          headers: { 'Content-Type': contentType },
        });
      } else {
        // GET: append params to URL
        response = await client.get(url, { params: data });
      }

      const elapsed = Date.now() - startTime;

      logger.verbose(`[${label}] ${method} ${url} → HTTP ${response.status} (${elapsed}ms)`);

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        responseTime: elapsed,
        data: response.data,
        headers: response.headers,
        url,
        method,
        payload: data,
        label,
      };
    } catch (err) {
      if (attempt <= retries) {
        const backoff = 300 * attempt;
        logger.verbose(`[${label}] Attempt ${attempt} failed (${err.message}). Retrying in ${backoff}ms…`);
        await sleep(backoff);
      } else {
        const elapsed = Date.now() - startTime;
        logger.verbose(`[${label}] All ${retries + 1} attempts failed: ${err.message}`);

        return {
          success: false,
          status: null,
          statusText: null,
          responseTime: elapsed,
          data: null,
          headers: {},
          url,
          method,
          payload: data,
          label,
          error: err.message,
        };
      }
    }
  }
}

/**
 * Execute many requests in parallel with a concurrency cap and per-second rate limit.
 *
 * @param {Array<object>} tasks        - Array of request-option objects (same shape as sendRequest opts)
 * @param {number}        concurrency  - Max simultaneous in-flight requests
 * @param {number}        maxRps       - Max requests per second (throttle)
 * @param {object}        client       - Shared axios client
 * @param {Function}      [onProgress] - Called after each completed request
 * @returns {Promise<Array<object>>}   - Ordered array of results
 */
async function executeRequests(tasks, concurrency = 10, maxRps = DEFAULT_MAX_RPS, client, onProgress) {
  const limit = pLimit(concurrency);

  // Throttle: minimum gap between request dispatches (ms)
  const minGap = Math.ceil(1000 / Math.min(maxRps, concurrency));

  let lastDispatch = 0;

  const wrappedTasks = tasks.map(task =>
    limit(async () => {
      const now = Date.now();
      const gap = now - lastDispatch;
      if (gap < minGap) {
        await sleep(minGap - gap);
      }
      lastDispatch = Date.now();
      const result = await sendRequest({ ...task, client });
      if (typeof onProgress === 'function') onProgress(1);
      return result;
    })
  );

  const results = await Promise.all(wrappedTasks);
  return results;
}

/**
 * Build a client and expose a simple run interface.
 */
function createEngine({ concurrency = 10, timeout = 10000, maxRps = DEFAULT_MAX_RPS } = {}) {
  const client = createClient(timeout);

  return {
    /**
     * Run a batch of tasks and return results.
     * @param {Array<object>} tasks
     * @param {Function}      [onProgress]
     */
    async run(tasks, onProgress) {
      return executeRequests(tasks, concurrency, maxRps, client, onProgress);
    },

    /**
     * Run a single request.
     */
    async single(opts) {
      return sendRequest({ ...opts, client });
    },

    client,
  };
}

module.exports = { createEngine, sendRequest, executeRequests, createClient };

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { resolveUrl } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Fetch HTML from a URL and return it as a string.
 */
async function fetchPage(targetUrl, timeout = 10000) {
  const response = await axios.get(targetUrl, {
    timeout,
    headers: {
      'User-Agent': 'WebFormSecurityTester/1.0 (safety-testing; non-destructive)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxRedirects: 5,
    validateStatus: status => status < 500,
  });
  return response.data;
}

/**
 * Parse a single <form> element using cheerio and return a structured object.
 */
function parseForm($, formEl, baseUrl, formIndex) {
  const $form = $(formEl);

  const rawAction = $form.attr('action') || '';
  const method = ($form.attr('method') || 'GET').toUpperCase();
  const actionUrl = resolveUrl(baseUrl, rawAction);
  const enctype = $form.attr('enctype') || 'application/x-www-form-urlencoded';
  const formId = $form.attr('id') || $form.attr('name') || `form-${formIndex}`;

  const fields = [];

  // Collect <input> elements
  $form.find('input').each((_, el) => {
    const $el = $(el);
    const type = ($el.attr('type') || 'text').toLowerCase();

    // Skip purely decorative inputs
    if (['submit', 'reset', 'image', 'button'].includes(type)) return;

    fields.push({
      tag: 'input',
      name: $el.attr('name') || '',
      type,
      id: $el.attr('id') || '',
      placeholder: $el.attr('placeholder') || '',
      required: $el.attr('required') !== undefined,
      minlength: $el.attr('minlength') ? parseInt($el.attr('minlength'), 10) : null,
      maxlength: $el.attr('maxlength') ? parseInt($el.attr('maxlength'), 10) : null,
      min: $el.attr('min') || null,
      max: $el.attr('max') || null,
      pattern: $el.attr('pattern') || null,
      autocomplete: $el.attr('autocomplete') || null,
      value: $el.attr('value') || '',
    });
  });

  // Collect <textarea> elements
  $form.find('textarea').each((_, el) => {
    const $el = $(el);
    fields.push({
      tag: 'textarea',
      name: $el.attr('name') || '',
      type: 'textarea',
      id: $el.attr('id') || '',
      placeholder: $el.attr('placeholder') || '',
      required: $el.attr('required') !== undefined,
      minlength: $el.attr('minlength') ? parseInt($el.attr('minlength'), 10) : null,
      maxlength: $el.attr('maxlength') ? parseInt($el.attr('maxlength'), 10) : null,
      min: null,
      max: null,
      pattern: null,
      autocomplete: $el.attr('autocomplete') || null,
      value: '',
    });
  });

  // Collect <select> elements
  $form.find('select').each((_, el) => {
    const $el = $(el);
    const options = [];
    $el.find('option').each((__, optEl) => {
      options.push($(optEl).attr('value') || $(optEl).text().trim());
    });
    fields.push({
      tag: 'select',
      name: $el.attr('name') || '',
      type: 'select',
      id: $el.attr('id') || '',
      placeholder: '',
      required: $el.attr('required') !== undefined,
      minlength: null,
      maxlength: null,
      min: null,
      max: null,
      pattern: null,
      autocomplete: $el.attr('autocomplete') || null,
      options,
      value: options[0] || '',
    });
  });

  return {
    formIndex,
    formId,
    actionUrl,
    method,
    enctype,
    fields,
    fieldCount: fields.length,
  };
}

/**
 * Main entry point: crawl a URL, find all forms, and return structured data.
 */
async function scanForms(targetUrl, timeout = 10000) {
  logger.info(`Fetching page: ${targetUrl}`);

  let html;
  try {
    html = await fetchPage(targetUrl, timeout);
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status} — ${err.response.statusText}`
      : err.message;
    throw new Error(`Failed to fetch ${targetUrl}: ${msg}`);
  }

  const $ = cheerio.load(html);
  const formElements = $('form').toArray();

  logger.info(`Found ${formElements.length} form(s) on the page.`);

  const forms = formElements.map((el, idx) => parseForm($, el, targetUrl, idx + 1));

  // Log a brief summary of each form
  for (const form of forms) {
    logger.verbose(
      `Form #${form.formIndex} [${form.formId}]: ${form.method} → ${form.actionUrl} | ${form.fieldCount} field(s)`
    );
  }

  return forms;
}

module.exports = { scanForms, fetchPage };

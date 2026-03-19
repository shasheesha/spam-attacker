'use strict';

const { analyzeValidationResults } = require('../core/responseAnalyzer');
const logger = require('../utils/logger');
const { repeatStr } = require('../utils/helpers');

// ---------------------------------------------------------------------------
// Test payload generators
// ---------------------------------------------------------------------------

/**
 * Generate invalid email payloads for an email-type field.
 */
function invalidEmailPayloads(fieldName) {
  return [
    { [fieldName]: 'notanemail' },
    { [fieldName]: 'missing@' },
    { [fieldName]: '@nodomain.com' },
    { [fieldName]: 'user@.com' },
    { [fieldName]: 'user@@domain.com' },
    { [fieldName]: 'user@domain' },
    { [fieldName]: '' },
    { [fieldName]: '   ' },
    { [fieldName]: '<script>alert(1)</script>@x.com' },
    { [fieldName]: 'a'.repeat(255) + '@x.com' },
  ];
}

/**
 * Generate empty / whitespace payloads for a required field.
 */
function emptyRequiredPayloads(fieldName) {
  return [
    { [fieldName]: '' },
    { [fieldName]: '   ' },
    { [fieldName]: '\t' },
    { [fieldName]: '\n' },
    { [fieldName]: null },
  ];
}

/**
 * Generate boundary payloads based on minlength/maxlength attributes.
 */
function boundaryPayloads(fieldName, minlength, maxlength) {
  const payloads = [];

  if (minlength !== null && minlength > 0) {
    // One character shorter than minimum → should be rejected
    if (minlength - 1 > 0) {
      payloads.push({ [fieldName]: repeatStr('a', minlength - 1) });
    } else {
      payloads.push({ [fieldName]: '' });
    }
    // Exactly at minimum → should be accepted
    payloads.push({ [fieldName]: repeatStr('a', minlength) });
  }

  if (maxlength !== null && maxlength > 0) {
    // Exactly at maximum → should be accepted
    payloads.push({ [fieldName]: repeatStr('a', maxlength) });
    // One character over maximum → should be rejected
    payloads.push({ [fieldName]: repeatStr('a', maxlength + 1) });
    // Far over maximum → should definitely be rejected
    payloads.push({ [fieldName]: repeatStr('a', maxlength * 2) });
  }

  // If no constraints at all, test very large input
  if (minlength === null && maxlength === null) {
    payloads.push({ [fieldName]: repeatStr('x', 10000) });
  }

  return payloads;
}

/**
 * Generate unexpected type payloads.
 */
function unexpectedTypePayloads(fieldName, fieldType) {
  const base = [
    { [fieldName]: '0' },
    { [fieldName]: '-1' },
    { [fieldName]: '9999999999999' },
    { [fieldName]: '1.234e10' },
    { [fieldName]: 'null' },
    { [fieldName]: 'undefined' },
    { [fieldName]: '{}' },
    { [fieldName]: '[]' },
    { [fieldName]: 'true' },
    { [fieldName]: '\x00\x01\x02' }, // null bytes
  ];

  if (fieldType === 'number') {
    base.push(
      { [fieldName]: 'not-a-number' },
      { [fieldName]: 'NaN' },
      { [fieldName]: 'Infinity' },
      { [fieldName]: '-Infinity' }
    );
  }

  if (fieldType === 'date' || fieldType === 'datetime-local') {
    base.push(
      { [fieldName]: 'not-a-date' },
      { [fieldName]: '99/99/9999' },
      { [fieldName]: '2000-13-45' }
    );
  }

  if (fieldType === 'url') {
    base.push(
      { [fieldName]: 'javascript:alert(1)' },
      { [fieldName]: 'data:text/html,<script>alert(1)</script>' },
      { [fieldName]: 'not-a-url' }
    );
  }

  return base;
}

// ---------------------------------------------------------------------------
// Test orchestration
// ---------------------------------------------------------------------------

/**
 * Build a complete list of tasks for all validation tests on a single form.
 *
 * @param {object} form    - Parsed form object from formScanner
 * @returns {Array<object>} tasks - Array of { url, method, data, enctype, label, testMeta }
 */
function buildValidationTasks(form) {
  const tasks = [];

  for (const field of form.fields) {
    if (!field.name) continue; // Skip unnamed fields

    const basePayload = buildBasePayload(form.fields, field.name);

    // --- Email validation tests ---
    if (field.type === 'email') {
      for (const payload of invalidEmailPayloads(field.name)) {
        tasks.push({
          url: form.actionUrl,
          method: form.method,
          enctype: form.enctype,
          data: { ...basePayload, ...payload },
          label: `email-invalid:${field.name}`,
          testMeta: {
            testType: 'Invalid Email Format',
            fieldName: field.name,
            formId: form.formId,
            expectedToFail: true,
          },
        });
      }
    }

    // --- Required field tests ---
    if (field.required) {
      for (const payload of emptyRequiredPayloads(field.name)) {
        tasks.push({
          url: form.actionUrl,
          method: form.method,
          enctype: form.enctype,
          data: { ...basePayload, ...payload },
          label: `empty-required:${field.name}`,
          testMeta: {
            testType: 'Empty Required Field',
            fieldName: field.name,
            formId: form.formId,
            expectedToFail: true,
          },
        });
      }
    }

    // --- Boundary tests (minlength / maxlength) ---
    if (field.minlength !== null || field.maxlength !== null) {
      for (const payload of boundaryPayloads(field.name, field.minlength, field.maxlength)) {
        tasks.push({
          url: form.actionUrl,
          method: form.method,
          enctype: form.enctype,
          data: { ...basePayload, ...payload },
          label: `boundary:${field.name}`,
          testMeta: {
            testType: 'Boundary Length Testing',
            fieldName: field.name,
            formId: form.formId,
            // Boundary at/below min or above max — only "below min" and "above max" are expected to fail
            expectedToFail: true,
          },
        });
      }
    }

    // --- Unexpected type tests ---
    for (const payload of unexpectedTypePayloads(field.name, field.type)) {
      tasks.push({
        url: form.actionUrl,
        method: form.method,
        enctype: form.enctype,
        data: { ...basePayload, ...payload },
        label: `unexpected-type:${field.name}`,
        testMeta: {
          testType: 'Unexpected Input Type',
          fieldName: field.name,
          formId: form.formId,
          expectedToFail: true,
        },
      });
    }
  }

  return tasks;
}

/**
 * Build a base payload for a form with sensible default values for all fields
 * except the one being targeted.
 */
function buildBasePayload(fields, targetFieldName) {
  const payload = {};
  for (const field of fields) {
    if (!field.name || field.name === targetFieldName) continue;

    switch (field.type) {
      case 'email':
        payload[field.name] = 'test@example.com';
        break;
      case 'number':
        payload[field.name] = '1';
        break;
      case 'checkbox':
        payload[field.name] = 'on';
        break;
      case 'radio':
        payload[field.name] = field.value || 'on';
        break;
      case 'select':
        payload[field.name] = field.options?.[0] || '';
        break;
      case 'url':
        payload[field.name] = 'https://example.com';
        break;
      case 'tel':
        payload[field.name] = '+1234567890';
        break;
      case 'date':
        payload[field.name] = '2000-01-01';
        break;
      default:
        payload[field.name] = field.value || 'test';
    }
  }
  return payload;
}

/**
 * Run all validation tests against a list of forms.
 *
 * @param {Array<object>} forms   - Parsed forms from formScanner
 * @param {object}        engine  - Request engine instance
 * @returns {object}              - { issues, results, tasksRun }
 */
async function runValidationTests(forms, engine) {
  const allIssues = [];
  const allResults = [];
  let totalTasks = 0;

  for (const form of forms) {
    logger.info(`Running validation tests on form #${form.formIndex} [${form.formId}]…`);

    const tasks = buildValidationTasks(form);
    totalTasks += tasks.length;

    logger.verbose(`Built ${tasks.length} validation task(s) for form [${form.formId}]`);

    if (tasks.length === 0) {
      logger.warn(`  No testable fields found in form [${form.formId}].`);
      continue;
    }

    const results = await engine.run(tasks);

    // Group results by testType + fieldName for analysis
    const grouped = {};
    for (let i = 0; i < tasks.length; i++) {
      const meta = tasks[i].testMeta;
      const key = `${meta.testType}::${meta.fieldName}`;
      if (!grouped[key]) {
        grouped[key] = { meta, results: [] };
      }
      grouped[key].results.push(results[i]);
    }

    for (const { meta, results: groupResults } of Object.values(grouped)) {
      const issues = analyzeValidationResults(
        groupResults,
        meta.formId,
        meta.fieldName,
        meta.testType,
        meta.expectedToFail
      );
      allIssues.push(...issues);
    }

    allResults.push(...results);

    logger.success(`  Completed ${tasks.length} validation tests for form [${form.formId}].`);
  }

  return { issues: allIssues, results: allResults, tasksRun: totalTasks };
}

module.exports = {
  runValidationTests,
  buildValidationTasks,
  buildBasePayload,
  invalidEmailPayloads,
  emptyRequiredPayloads,
  boundaryPayloads,
  unexpectedTypePayloads,
};

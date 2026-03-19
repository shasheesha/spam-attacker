'use strict';

const url = require('url');

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(base, target) {
  if (!target || target === '#' || target.startsWith('javascript:')) {
    return base;
  }
  try {
    return new url.URL(target, base).href;
  } catch {
    return base;
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Return current timestamp as ISO string.
 */
function nowISO() {
  return new Date().toISOString();
}

/**
 * Return today's date as YYYY-MM-DD.
 */
function todayDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Clamp a number between min and max.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Round a number to N decimal places.
 */
function round(value, decimals = 2) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Calculate average of an array of numbers.
 */
function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Generate a string of repeated characters to a given length.
 */
function repeatStr(char, length) {
  return char.repeat(Math.max(0, length));
}

/**
 * Truncate a string to maxLen, adding ellipsis if needed.
 */
function truncate(str, maxLen = 80) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Return a severity badge color for HTML reports.
 */
function severityColor(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'high':   return '#e74c3c';
    case 'medium': return '#e67e22';
    case 'low':    return '#f1c40f';
    default:       return '#95a5a6';
  }
}

/**
 * Format milliseconds into human-readable string.
 */
function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Determine HTTP method label (normalised to uppercase).
 */
function normalizeMethod(method) {
  return (method || 'GET').toUpperCase();
}

/**
 * Build a flat key=value query/body string from a plain object.
 */
function buildFormData(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

module.exports = {
  resolveUrl,
  sleep,
  nowISO,
  todayDate,
  clamp,
  round,
  average,
  repeatStr,
  truncate,
  escapeHtml,
  severityColor,
  formatMs,
  normalizeMethod,
  buildFormData,
};

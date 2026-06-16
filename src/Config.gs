/**
 * User properties (per Google account, isolated per user).
 */

var PROP_SCAN_DAYS = 'SCAN_DAYS_AHEAD';
var DEFAULT_SCAN_DAYS = 14;

var PROP_INTERNAL_DOMAIN = 'INTERNAL_DOMAIN';

function setupDefaults() {
  var p = PropertiesService.getUserProperties();
  if (!p.getProperty(PROP_SCAN_DAYS)) {
    p.setProperty(PROP_SCAN_DAYS, String(DEFAULT_SCAN_DAYS));
  }
}

function getScanDays() {
  var v = PropertiesService.getUserProperties().getProperty(PROP_SCAN_DAYS);
  var n = parseInt(v, 10);
  if (n >= 1 && n <= 90) return n;
  return DEFAULT_SCAN_DAYS;
}

/**
 * Returns the configured internal domain, or '' if none is set.
 * When empty, CalendarDebrief falls back to INTERNAL_DOMAIN_FALLBACK.
 * @return {string}
 */
function getInternalDomain() {
  var v = PropertiesService.getUserProperties().getProperty(PROP_INTERNAL_DOMAIN);
  return (v || '').trim().toLowerCase();
}

/**
 * @param {string} domain e.g. "example.com"
 */
function setInternalDomain(domain) {
  var d = (domain || '').trim().toLowerCase();
  if (!isValidDomain_(d)) {
    throw new Error('Internal domain must be a valid domain, e.g. "example.com".');
  }
  PropertiesService.getUserProperties().setProperty(PROP_INTERNAL_DOMAIN, d);
}

/**
 * @param {number} days
 */
function setScanDays(days) {
  var n = parseWholeNumber_(days);
  if (n === null || n < 1 || n > 90) {
    throw new Error('Scan window must be between 1 and 90 days.');
  }
  PropertiesService.getUserProperties().setProperty(PROP_SCAN_DAYS, String(n));
}

// ── Focus Time ────────────────────────────────────────────────────────────────

var PROP_FOCUS_TARGET = 'FOCUS_TARGET_MINUTES';
var PROP_FOCUS_BLOCK  = 'FOCUS_BLOCK_MINUTES';
var PROP_FOCUS_MIN    = 'FOCUS_MIN_BLOCK_MINUTES';
var PROP_WORK_START   = 'WORKING_HOURS_START';
var PROP_WORK_END     = 'WORKING_HOURS_END';
var PROP_FOCUS_TITLE  = 'FOCUS_TIME_TITLE';
var DEFAULT_FOCUS_TITLE = 'Focus time';

/**
 * Accepts only whole finite integers. Rejects "10abc", 1.5, NaN, Infinity.
 * @return {number|null}
 */
function parseWholeNumber_(v) {
  var n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n) return null;
  return n;
}

/**
 * Valid HH:MM with hours 00-23 and minutes 00-59.
 */
function isValidHHMM_(t) {
  if (!t || typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) return false;
  var parts = t.split(':');
  var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Valid domain: at least two labels, each containing only alphanumerics and hyphens.
 */
function isValidDomain_(d) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d);
}

function getFocusTargetMinutes() {
  var v = parseInt(PropertiesService.getUserProperties().getProperty(PROP_FOCUS_TARGET), 10);
  return (v > 0) ? v : 180;
}
function setFocusTargetMinutes(n) {
  var v = parseWholeNumber_(n);
  if (v === null || v <= 0) throw new Error('Focus target must be > 0 minutes.');
  PropertiesService.getUserProperties().setProperty(PROP_FOCUS_TARGET, String(v));
}

function getFocusMinBlockMinutes() {
  var v = parseInt(PropertiesService.getUserProperties().getProperty(PROP_FOCUS_MIN), 10);
  return (v >= 15) ? v : 30;
}
function setFocusMinBlockMinutes(n) {
  var v = parseWholeNumber_(n);
  if (v === null || v < 15) throw new Error('Minimum block size must be ≥ 15 minutes.');
  PropertiesService.getUserProperties().setProperty(PROP_FOCUS_MIN, String(v));
}

function getFocusBlockMinutes() {
  var v = parseInt(PropertiesService.getUserProperties().getProperty(PROP_FOCUS_BLOCK), 10);
  var min = getFocusMinBlockMinutes();
  return (v >= min) ? v : 90;
}
function setFocusBlockMinutes(n) {
  var v = parseWholeNumber_(n);
  var min = getFocusMinBlockMinutes();
  if (v === null || v < min) throw new Error('Focus block must be ≥ ' + min + ' min (minimum block size).');
  PropertiesService.getUserProperties().setProperty(PROP_FOCUS_BLOCK, String(v));
}

function getWorkingHoursStart() {
  var v = PropertiesService.getUserProperties().getProperty(PROP_WORK_START);
  return isValidHHMM_(v) ? v : '09:00';
}
function setWorkingHoursStart(t) {
  if (!isValidHHMM_(t)) throw new Error('Working hours start must be HH:MM with valid hours (00-23) and minutes (00-59).');
  PropertiesService.getUserProperties().setProperty(PROP_WORK_START, t);
}

function getWorkingHoursEnd() {
  var v = PropertiesService.getUserProperties().getProperty(PROP_WORK_END);
  return isValidHHMM_(v) ? v : '18:00';
}
function setWorkingHoursEnd(t) {
  if (!isValidHHMM_(t)) throw new Error('Working hours end must be HH:MM with valid hours (00-23) and minutes (00-59).');
  PropertiesService.getUserProperties().setProperty(PROP_WORK_END, t);
}

function getFocusTimeTitle() {
  var v = PropertiesService.getUserProperties().getProperty(PROP_FOCUS_TITLE);
  return (v && v.trim()) ? v.trim() : DEFAULT_FOCUS_TITLE;
}
function setFocusTimeTitle(t) {
  var s = (t || '').trim();
  if (!s) throw new Error('Focus time title cannot be empty.');
  if (s.length > 100) throw new Error('Focus time title must be 100 characters or fewer.');
  PropertiesService.getUserProperties().setProperty(PROP_FOCUS_TITLE, s);
}

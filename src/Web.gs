/**
 * Web app entry and client-callable APIs.
 */

// Patched by `npm run release` — used to detect dev (HEAD) vs prod deployment.
var PROD_DEPLOYMENT_ID_ = '';

function jsonForScriptTag_(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function doGet() {
  setupDefaults();
  var currentUrl = ScriptApp.getService().getUrl();
  var isDev = !PROD_DEPLOYMENT_ID_ || currentUrl.indexOf(PROD_DEPLOYMENT_ID_) === -1;
  var payload = {
    scanDays: getScanDays(),
    isDev: isDev,
    focusConfig: {
      targetMinutes: getFocusTargetMinutes(),
      blockMinutes:  getFocusBlockMinutes(),
      workStart:     getWorkingHoursStart(),
      workEnd:       getWorkingHoursEnd(),
      focusTitle:    getFocusTimeTitle(),
    },
  };
  var t = HtmlService.createTemplateFromFile('Index');
  t.initialInline = jsonForScriptTag_(payload);
  return t
    .evaluate()
    .setTitle('Calendar Assistant')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function apiPing() {
  return { ok: true, t: new Date().toISOString() };
}

/**
 * @param {number} scanDays Optional 1–90; persists when provided.
 * @return {{ ok: true, events: Array<Object>, timedOut: boolean } | { ok: false, error: string, authUrl?: string, events: Array<Object> }}
 */
function apiScanCalendar(scanDays) {
  setupDefaults();
  if (typeof scanDays !== 'undefined' && scanDays !== null) {
    try {
      setScanDays(scanDays);
    } catch (e) {
      return { ok: false, error: e.message || String(e), events: [] };
    }
  }
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return {
        ok: false,
        error:
          'Authorize Calendar access, then open this page again and tap Scan.',
        authUrl: authInfo.getAuthorizationUrl(),
        events: [],
      };
    }
  } catch (authErr) {}

  try {
    return scanCalendarInviteRows_(getScanDays());
  } catch (err) {
    return { ok: false, error: err.message || String(err), events: [] };
  }
}

/**
 * @param {string} weekStartIso ISO date of Monday, e.g. "2026-06-08"
 * @return {{ ok:boolean, days:Object[], timedOut:boolean } | { ok:false, error:string, authUrl?:string, days:[] }}
 */
function apiFocusScan(weekStartIso) {
  setupDefaults();
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return {
        ok: false,
        error: 'Authorize Calendar access, then try again.',
        authUrl: authInfo.getAuthorizationUrl(),
        days: [],
      };
    }
  } catch (authErr) {}

  try {
    return scanFocusWeek_(weekStartIso);
  } catch (err) {
    return { ok: false, error: err.message || String(err), days: [] };
  }
}

/**
 * @param {string} dateIso e.g. "2026-06-12"
 * @return {{ ok:boolean, day:Object } | { ok:false, error:string, authUrl?:string }}
 */
function apiFocusScanDay(dateIso) {
  setupDefaults();
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return { ok: false, error: 'Authorization required.', authUrl: authInfo.getAuthorizationUrl() };
    }
  } catch (authErr) {}

  try {
    return { ok: true, day: scanFocusDay_(dateIso) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * @param {string} dateIso
 * @param {Object[]} proposals As returned by apiFocusScan DayRow.proposals
 * @return {{ ok:boolean, scheduledMinutes:number, gapRemainingMinutes:number } | { ok:false, error:string, authUrl?:string }}
 */
function apiFocusScheduleDay(dateIso, proposals) {
  setupDefaults();
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return { ok: false, error: 'Authorization required.', authUrl: authInfo.getAuthorizationUrl() };
    }
  } catch (authErr) {}

  return scheduleFocusDay_(dateIso, proposals || []);
}

/**
 * @return {{ ok: true, settings: Object } | { ok: false, error: string }}
 */
function apiGetSettings() {
  setupDefaults();
  try {
    return {
      ok: true,
      settings: {
        scanDays:             getScanDays(),
        internalDomain:       getInternalDomain(),
        focusTargetMinutes:   getFocusTargetMinutes(),
        focusBlockMinutes:    getFocusBlockMinutes(),
        focusMinBlockMinutes: getFocusMinBlockMinutes(),
        workingHoursStart:    getWorkingHoursStart(),
        workingHoursEnd:      getWorkingHoursEnd(),
        focusTimeTitle:       getFocusTimeTitle(),
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Validates all fields first, then writes in one batch (atomic).
 * Returns ok:false without writing anything if any field is invalid.
 * @param {Object} settings
 * @return {{ ok: true } | { ok: false, error: string }}
 */
function apiSaveSettings(settings) {
  setupDefaults();
  try {
    // ── Validate every field before writing anything ──────────────────────────

    var scanDays = parseWholeNumber_(settings.scanDays);
    if (scanDays === null || scanDays < 1 || scanDays > 90) {
      return { ok: false, error: 'Scan window must be between 1 and 90 days.' };
    }

    var domain = (settings.internalDomain || '').trim().toLowerCase();
    if (domain && !isValidDomain_(domain)) {
      return { ok: false, error: 'Internal domain must be a valid domain, e.g. "example.com".' };
    }

    var focusTarget = parseWholeNumber_(settings.focusTargetMinutes);
    if (focusTarget === null || focusTarget <= 0) {
      return { ok: false, error: 'Focus target must be > 0 minutes.' };
    }

    var focusMin = parseWholeNumber_(settings.focusMinBlockMinutes);
    if (focusMin === null || focusMin < 15) {
      return { ok: false, error: 'Minimum block size must be ≥ 15 minutes.' };
    }

    var focusBlock = parseWholeNumber_(settings.focusBlockMinutes);
    if (focusBlock === null || focusBlock < focusMin) {
      return { ok: false, error: 'Focus block must be ≥ ' + focusMin + ' min (minimum block size).' };
    }

    var workStart = (settings.workingHoursStart || '').trim();
    if (!isValidHHMM_(workStart)) {
      return { ok: false, error: 'Working hours start must be HH:MM with valid hours (00-23) and minutes (00-59).' };
    }

    var workEnd = (settings.workingHoursEnd || '').trim();
    if (!isValidHHMM_(workEnd)) {
      return { ok: false, error: 'Working hours end must be HH:MM with valid hours (00-23) and minutes (00-59).' };
    }

    if (workEnd <= workStart) {
      return { ok: false, error: 'Working hours end must be after start.' };
    }

    var focusTitle = (settings.focusTimeTitle || '').trim();
    if (!focusTitle) {
      return { ok: false, error: 'Focus time title cannot be empty.' };
    }
    if (focusTitle.length > 100) {
      return { ok: false, error: 'Focus time title must be 100 characters or fewer.' };
    }

    // ── All valid — write in one batch ────────────────────────────────────────

    var props = {};
    props[PROP_SCAN_DAYS]     = String(scanDays);
    props[PROP_FOCUS_TARGET]  = String(focusTarget);
    props[PROP_FOCUS_MIN]     = String(focusMin);
    props[PROP_FOCUS_BLOCK]   = String(focusBlock);
    props[PROP_WORK_START]    = workStart;
    props[PROP_WORK_END]      = workEnd;
    props[PROP_FOCUS_TITLE]   = focusTitle;

    var p = PropertiesService.getUserProperties();
    p.setProperties(props);

    if (domain) {
      p.setProperty(PROP_INTERNAL_DOMAIN, domain);
    } else {
      p.deleteProperty(PROP_INTERNAL_DOMAIN);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * @param {string} sourceEventId
 * @param {string} meetingEndIso ISO string of the meeting end time
 * @param {boolean=} overrideConflict If true, skip accepted-meeting overlap check (still enforces planned/past/all-day).
 */
function apiScheduleDebrief(sourceEventId, meetingEndIso, overrideConflict) {
  setupDefaults();
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return {
        ok: false,
        error: 'Authorization required.',
        authUrl: authInfo.getAuthorizationUrl(),
      };
    }
  } catch (authErr) {}

  return scheduleDebriefAfterMeeting_(sourceEventId, meetingEndIso, !!overrideConflict);
}

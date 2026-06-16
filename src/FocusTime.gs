/**
 * Focus Time Protector — scan a week, detect conflicts, propose and execute focus blocks.
 */

var FOCUS_PRIVATE_OWNED_KEY = 'focusProtectorOwned';
var FOCUS_TIME_EVENT_TYPE   = 'focusTime';
var OOO_EVENT_TYPE          = 'outOfOffice';

function minsToMs_(m) { return m * 60 * 1000; }

/**
 * Apply "HH:MM" time string to a day's Date, returning the resulting timestamp.
 * @param {Date} dayDate
 * @param {string} timeStr e.g. "09:00"
 * @return {number} ms
 */
function applyTimeToDay_(dayDate, timeStr) {
  var parts = (timeStr || '09:00').split(':');
  var d = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(),
                   parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
  return d.getTime();
}

/**
 * Sort and merge overlapping {s, e} intervals (ms timestamps).
 * @param {{s:number,e:number}[]} intervals
 * @return {{s:number,e:number}[]}
 */
function mergeIntervals_(intervals) {
  if (!intervals.length) return [];
  var sorted = intervals.slice().sort(function (a, b) { return a.s - b.s; });
  var merged = [{ s: sorted[0].s, e: sorted[0].e }];
  for (var i = 1; i < sorted.length; i++) {
    var last = merged[merged.length - 1];
    var cur  = sorted[i];
    if (cur.s < last.e) {
      last.e = Math.max(last.e, cur.e);
    } else {
      merged.push({ s: cur.s, e: cur.e });
    }
  }
  return merged;
}

/**
 * Return free sub-intervals within [rangeStart, rangeEnd] not covered by busyIntervals.
 * busyIntervals must already be merged and sorted.
 * @param {number} rangeStart
 * @param {number} rangeEnd
 * @param {{s:number,e:number}[]} busyIntervals
 * @return {{s:number,e:number}[]}
 */
function getFreeSlots_(rangeStart, rangeEnd, busyIntervals) {
  var free = [];
  var cursor = rangeStart;
  for (var i = 0; i < busyIntervals.length; i++) {
    var b = busyIntervals[i];
    if (b.e <= cursor) continue;
    if (b.s > cursor) free.push({ s: cursor, e: b.s });
    cursor = Math.max(cursor, b.e);
  }
  if (cursor < rangeEnd) free.push({ s: cursor, e: rangeEnd });
  return free.filter(function (f) { return f.e > f.s; });
}

/**
 * Fill gapMs using preferred blockMs chunks (min minMs) from freeSlots.
 * @param {{s:number,e:number}[]} freeSlots
 * @param {number} gapMs
 * @param {number} blockMs
 * @param {number} minMs
 * @return {{startIso:string,endIso:string}[]}
 */
function buildNewBlockProposals_(freeSlots, gapMs, blockMs, minMs) {
  var proposals = [];
  var remaining = gapMs;
  for (var i = 0; i < freeSlots.length && remaining > 0; i++) {
    var slot = freeSlots[i];
    var cursor = slot.s;
    while (cursor < slot.e && remaining > 0) {
      var avail = slot.e - cursor;
      if (avail < minMs) break;
      var dur = Math.min(blockMs, avail, remaining);
      if (dur < minMs) break;
      proposals.push({
        startIso: new Date(cursor).toISOString(),
        endIso:   new Date(cursor + dur).toISOString(),
      });
      remaining -= dur;
      cursor    += dur;
    }
  }
  return proposals;
}

/**
 * Compute sub-intervals of [blockStart, blockEnd] not covered by conflictIntervals, each ≥ minMs.
 * @param {number} blockStart
 * @param {number} blockEnd
 * @param {{s:number,e:number}[]} conflictIntervals
 * @param {number} minMs
 * @return {{startIso:string,endIso:string}[]}
 */
function buildSplitBlocks_(blockStart, blockEnd, conflictIntervals, minMs) {
  var clamped = conflictIntervals.map(function (c) {
    return { s: Math.max(c.s, blockStart), e: Math.min(c.e, blockEnd) };
  }).filter(function (c) { return c.e > c.s; });
  var merged = mergeIntervals_(clamped);
  var subs = getFreeSlots_(blockStart, blockEnd, merged);
  return subs
    .filter(function (s) { return (s.e - s.s) >= minMs; })
    .map(function (s) {
      return { startIso: new Date(s.s).toISOString(), endIso: new Date(s.e).toISOString() };
    });
}

/**
 * Build one DayRow for the given day.
 * @param {string} calendarId
 * @param {Date} dayDate  Local midnight for the day.
 * @param {number} nowMs
 * @param {string} myEmail Lowercase.
 * @param {{targetMs:number,blockMs:number,minMs:number,workStart:string,workEnd:string,focusTitle:string}} cfg
 * @return {Object} DayRow
 */
function buildFocusDayRow_(calendarId, dayDate, nowMs, myEmail, cfg) {
  var workStartMs = applyTimeToDay_(dayDate, cfg.workStart);
  var workEndMs   = applyTimeToDay_(dayDate, cfg.workEnd);

  var y  = dayDate.getFullYear();
  var mo = String(dayDate.getMonth() + 1).padStart(2, '0');
  var d  = String(dayDate.getDate()).padStart(2, '0');
  var dateIso = y + '-' + mo + '-' + d;

  var todayDate    = new Date(nowMs);
  var todayMidnight = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate()).getTime();
  var past = dayDate.getTime() < todayMidnight;

  var pad = 2 * 60 * 1000;
  var items = [];
  try {
    var resp = Calendar.Events.list(calendarId, {
      timeMin:      new Date(workStartMs - pad).toISOString(),
      timeMax:      new Date(workEndMs + pad).toISOString(),
      singleEvents: true,
      maxResults:   100,
    });
    items = resp.items || [];
  } catch (e) {
    return {
      date: dateIso, past: past, skipped: false,
      error: e.message || String(e),
      effectiveFocusMinutes: 0,
      targetMinutes: Math.round(cfg.targetMs / 60000),
      gapMinutes: Math.round(cfg.targetMs / 60000),
      conflicts: [], proposals: [],
    };
  }

  // Check OoO
  for (var oi = 0; oi < items.length; oi++) {
    if (items[oi].eventType === OOO_EVENT_TYPE) {
      return {
        date: dateIso, past: past, skipped: true,
        effectiveFocusMinutes: 0,
        targetMinutes: Math.round(cfg.targetMs / 60000),
        gapMinutes: 0, conflicts: [], proposals: [],
      };
    }
  }

  // Separate focusTime from other events.
  // focusBlocks: "Focus time"-titled blocks only — counted toward target + conflict-checked.
  // focusBusyBlocks: ALL focusTime events — used as busy intervals so we never double-book focus slots.
  var focusBlocks     = [];
  var focusBusyBlocks = [];
  var otherItems      = [];
  for (var fi = 0; fi < items.length; fi++) {
    var it = items[fi];
    if (it.eventType === FOCUS_TIME_EVENT_TYPE) {
      var tb = parseApiEventTimes_(it);
      if (!tb.allDay) {
        var cs = Math.max(tb.start.getTime(), workStartMs);
        var ce = Math.min(tb.end.getTime(), workEndMs);
        if (ce > cs) {
          focusBusyBlocks.push({ s: cs, e: ce });
          if ((it.summary || '').trim().toLowerCase() === cfg.focusTitle.toLowerCase()) {
            focusBlocks.push({ id: it.id, s: cs, e: ce, title: it.summary || cfg.focusTitle });
          }
        }
      }
    } else {
      otherItems.push(it);
    }
  }

  // Accepted timed meetings (for conflict + busy interval calculations)
  var acceptedMeetings = [];
  for (var ai = 0; ai < otherItems.length; ai++) {
    var it2 = otherItems[ai];
    var tb2 = parseApiEventTimes_(it2);
    if (tb2.allDay) continue;
    if (it2.transparency === 'transparent') continue;
    if (!calendarEventIsAcceptedCommitmentForUser_(it2, myEmail)) continue;
    acceptedMeetings.push({
      id: it2.id,
      s: tb2.start.getTime(),
      e: tb2.end.getTime(),
      title: it2.summary || '(no title)',
    });
  }

  // For each focus block: detect conflicts, build split proposals
  var splitProposals  = [];
  var conflictDetails = [];
  var effectiveFocusMs = 0;

  for (var bi = 0; bi < focusBlocks.length; bi++) {
    var block = focusBlocks[bi];
    var blockConflicts = [];

    for (var mi = 0; mi < acceptedMeetings.length; mi++) {
      var mtg = acceptedMeetings[mi];
      if (mtg.s < block.e && mtg.e > block.s) {
        var oStart   = Math.max(mtg.s, block.s);
        var oEnd     = Math.min(mtg.e, block.e);
        var oMins    = Math.round((oEnd - oStart) / 60000);
        blockConflicts.push({ s: mtg.s, e: mtg.e, title: mtg.title, overlapMinutes: oMins });
        conflictDetails.push({
          blockTitle:     block.title,
          meetingTitle:   mtg.title,
          overlapMinutes: oMins,
        });
      }
    }

    if (blockConflicts.length === 0) {
      effectiveFocusMs += (block.e - block.s);
    } else {
      var conflictIntervals = blockConflicts.map(function (c) { return { s: c.s, e: c.e }; });
      var splitBlocks = buildSplitBlocks_(block.s, block.e, conflictIntervals, cfg.minMs);
      splitProposals.push({
        type:          'split',
        deleteEventId: block.id,
        originalBlock: { startIso: new Date(block.s).toISOString(), endIso: new Date(block.e).toISOString() },
        blocks:        splitBlocks,
      });
      for (var si = 0; si < splitBlocks.length; si++) {
        effectiveFocusMs += (new Date(splitBlocks[si].endIso).getTime() - new Date(splitBlocks[si].startIso).getTime());
      }
    }
  }

  var gapMs = Math.max(0, cfg.targetMs - effectiveFocusMs);

  // Find free slots for new blocks (only for non-past days with remaining gap)
  var newBlockProposals = [];
  if (gapMs > 0 && !past) {
    var busyIntervals = [];
    for (var mi2 = 0; mi2 < acceptedMeetings.length; mi2++) {
      busyIntervals.push({ s: acceptedMeetings[mi2].s, e: acceptedMeetings[mi2].e });
    }
    for (var bi2 = 0; bi2 < focusBusyBlocks.length; bi2++) {
      busyIntervals.push({ s: focusBusyBlocks[bi2].s, e: focusBusyBlocks[bi2].e });
    }

    // On today, don't propose slots in the past
    var searchStart = (dayDate.getTime() === todayMidnight) ? Math.max(workStartMs, nowMs) : workStartMs;
    var merged      = mergeIntervals_(busyIntervals);
    var freeSlots   = getFreeSlots_(searchStart, workEndMs, merged);
    var newBlocks   = buildNewBlockProposals_(freeSlots, gapMs, cfg.blockMs, cfg.minMs);
    for (var ni = 0; ni < newBlocks.length; ni++) {
      newBlockProposals.push({ type: 'new', blocks: [newBlocks[ni]] });
    }
  }

  var allProposals = past ? [] : splitProposals.concat(newBlockProposals);

  return {
    date:                 dateIso,
    past:                 past,
    skipped:              false,
    effectiveFocusMinutes: Math.round(effectiveFocusMs / 60000),
    targetMinutes:        Math.round(cfg.targetMs / 60000),
    gapMinutes:           Math.round(gapMs / 60000),
    conflicts:            conflictDetails,
    proposals:            allProposals,
  };
}

/**
 * Scan a single day and return one DayRow.
 * @param {string} dateIso e.g. "2026-06-12"
 * @return {Object} DayRow
 */
function scanFocusDay_(dateIso) {
  setupDefaults();
  var cal        = CalendarApp.getDefaultCalendar();
  var calendarId = cal.getId();
  var myEmail    = getPrimaryUserEmail_();
  var cfg = {
    targetMs:   minsToMs_(getFocusTargetMinutes()),
    blockMs:    minsToMs_(getFocusBlockMinutes()),
    minMs:      minsToMs_(getFocusMinBlockMinutes()),
    workStart:  getWorkingHoursStart(),
    workEnd:    getWorkingHoursEnd(),
    focusTitle: getFocusTimeTitle(),
  };
  var parts   = dateIso.split('-');
  var dayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return buildFocusDayRow_(calendarId, dayDate, Date.now(), myEmail, cfg);
}

/**
 * Scan Mon–Fri of the given week.
 * @param {string} weekStartIso ISO date of the Monday, e.g. "2026-06-08"
 * @return {{ ok:boolean, days:Object[], timedOut:boolean }}
 */
function scanFocusWeek_(weekStartIso) {
  setupDefaults();
  var cal        = CalendarApp.getDefaultCalendar();
  var calendarId = cal.getId();
  var myEmail    = getPrimaryUserEmail_();
  var cfg = {
    targetMs:   minsToMs_(getFocusTargetMinutes()),
    blockMs:    minsToMs_(getFocusBlockMinutes()),
    minMs:      minsToMs_(getFocusMinBlockMinutes()),
    workStart:  getWorkingHoursStart(),
    workEnd:    getWorkingHoursEnd(),
    focusTitle: getFocusTimeTitle(),
  };

  // Parse Monday in local (script) time
  var parts   = weekStartIso.split('-');
  var monday  = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var nowMs   = Date.now();
  var days    = [];

  for (var d = 0; d < 5; d++) {
    var dayDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d);
    try {
      days.push(buildFocusDayRow_(calendarId, dayDate, nowMs, myEmail, cfg));
    } catch (e) {
      var y  = dayDate.getFullYear();
      var mo = String(dayDate.getMonth() + 1).padStart(2, '0');
      var dd = String(dayDate.getDate()).padStart(2, '0');
      days.push({
        date: y + '-' + mo + '-' + dd,
        past: false, skipped: false,
        error: e.message || String(e),
        effectiveFocusMinutes: 0,
        targetMinutes: Math.round(cfg.targetMs / 60000),
        gapMinutes:    Math.round(cfg.targetMs / 60000),
        conflicts: [], proposals: [],
      });
    }
  }

  return { ok: true, days: days, timedOut: false };
}

/**
 * Execute all proposals for a day (called from apiFocusScheduleDay).
 * @param {string} dateIso
 * @param {Object[]} proposals
 * @return {{ ok:boolean, scheduledMinutes:number, gapRemainingMinutes:number }}
 */
function scheduleFocusDay_(dateIso, proposals) {
  setupDefaults();
  var cal        = CalendarApp.getDefaultCalendar();
  var calendarId = cal.getId();
  var scheduledMs = 0;
  var errors      = [];

  for (var i = 0; i < proposals.length; i++) {
    var p = proposals[i];
    try {
      var blocks = p.blocks || [];
      var createdMs = 0;
      for (var bi = 0; bi < blocks.length; bi++) {
        createdMs += createFocusBlock_(calendarId, blocks[bi].startIso, blocks[bi].endIso);
      }
      scheduledMs += createdMs;
      if (p.type === 'split' && p.deleteEventId) {
        try {
          Calendar.Events.remove(calendarId, p.deleteEventId);
        } catch (delErr) {
          // Already gone — replacements were created, continue
        }
      }
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  if (errors.length && scheduledMs === 0) {
    return { ok: false, error: errors[0] };
  }

  return { ok: true, scheduledMinutes: Math.round(scheduledMs / 60000), gapRemainingMinutes: 0 };
}

/**
 * Create one focus time block; falls back to plain event if focusTime is unsupported.
 * @param {string} calendarId
 * @param {string} startIso
 * @param {string} endIso
 * @return {number} Duration in ms
 */
function createFocusBlock_(calendarId, startIso, endIso) {
  var privExt = {};
  privExt[FOCUS_PRIVATE_OWNED_KEY] = 'true';
  var body = {
    summary: getFocusTimeTitle(),
    start:   { dateTime: startIso },
    end:     { dateTime: endIso },
    eventType: FOCUS_TIME_EVENT_TYPE,
    focusTimeProperties: {
      autoDeclineMode: 'declineOnlyNewConflictingInvitations',
      declineMessage:  'This time is reserved for focused work.',
      chatStatus:      'available',
    },
    extendedProperties: { private: privExt },
  };

  try {
    Calendar.Events.insert(body, calendarId);
  } catch (e) {
    delete body.eventType;
    delete body.focusTimeProperties;
    Calendar.Events.insert(body, calendarId);
  }

  return new Date(endIso).getTime() - new Date(startIso).getTime();
}

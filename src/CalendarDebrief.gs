/**
 * Scan default calendar and manage 15-minute debriefs immediately after each meeting ends.
 * v1: lists meetings that have at least one guest with an email (same as UI invitee list — no “none listed”).
 */

var DEBRIEF_TITLE_PREFIX = 'Debrief — ';
/** Calendar API v3 `extendedProperties.private` key — links debrief event to source meeting id. */
var DEBRIEF_PRIVATE_SOURCE_KEY = 'debriefForEventId';
var DEBRIEF_DURATION_MINUTES = 15;
var SCAN_CHUNK_MS = 24 * 60 * 60 * 1000;
var SCAN_MAX_RUNTIME_MS = 5 * 60 * 1000;
/** If Session has no email, use this domain as “internal” for External vs not. Override via INTERNAL_DOMAIN setting. */
var INTERNAL_DOMAIN_FALLBACK = 'example.com';

/**
 * @param {Object} item Calendar API Event resource
 * @return {{ allDay: boolean, start: Date, end: Date }}
 */
function parseApiEventTimes_(item) {
  var s = item.start;
  var e_ = item.end;
  if (s && s.date) {
    return {
      allDay: true,
      start: new Date(s.date),
      end: new Date((e_ && e_.date) || s.date),
    };
  }
  return {
    allDay: false,
    start: new Date((s && s.dateTime) || 0),
    end: new Date((e_ && e_.dateTime) || 0),
  };
}

/**
 * @param {Object} item Calendar API Event resource
 * @param {string} sourceEventId
 * @return {boolean}
 */
function eventResourceLinksToSource_(item, sourceEventId) {
  var priv = item.extendedProperties && item.extendedProperties.private;
  return !!(priv && priv[DEBRIEF_PRIVATE_SOURCE_KEY] === sourceEventId);
}

/**
 * Events overlapping [fromMs, toMs] via Calendar API (includes extendedProperties for debrief links).
 * @param {string} calendarId
 * @param {number} fromMs
 * @param {number} toMs
 * @return {Object[]}
 */
function listEventsInRangeViaApi_(calendarId, fromMs, toMs) {
  var response = Calendar.Events.list(calendarId, {
    timeMin: new Date(fromMs).toISOString(),
    timeMax: new Date(toMs).toISOString(),
    singleEvents: true,
    maxResults: 100,
  });
  return response.items || [];
}

/**
 * Debrief must start at meeting end and last exactly 15 minutes (fits in the “next 15 minutes” window).
 * @param {Date} meetingEnd
 * @return {{start: Date, end: Date}}
 */
function getDebriefSlot_(meetingEnd) {
  var start = meetingEnd;
  var end = new Date(meetingEnd.getTime() + DEBRIEF_DURATION_MINUTES * 60 * 1000);
  return { start: start, end: end };
}

/**
 * One Calendar API list for the debrief window: linked debrief (if any) and blocking events.
 * @param {GoogleAppsScript.Calendar.Calendar} cal
 * @param {string} sourceEventId
 * @param {Date} meetingEnd
 * @return {{ debrief: Object, blockingReason: string }}
 */
function analyzeDebriefSlotViaApi_(cal, sourceEventId, meetingEnd) {
  var slot = getDebriefSlot_(meetingEnd);
  var pad = 2 * 60 * 1000;
  var calendarId = cal.getId();
  var myEmail = getPrimaryUserEmail_();
  var items = listEventsInRangeViaApi_(
    calendarId,
    slot.start.getTime() - pad,
    slot.end.getTime() + pad,
  );

  var debrief = { planned: false };
  var titles = [];
  var seenId = {};

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || it.id === sourceEventId) continue;

    if (eventResourceLinksToSource_(it, sourceEventId)) {
      if (!debrief.planned) {
        var lb = parseApiEventTimes_(it);
        debrief = {
          planned: true,
          title: it.summary || 'Debrief',
          startIso: lb.start.toISOString(),
          endIso: lb.end.toISOString(),
        };
      }
      continue;
    }

    var bounds = parseApiEventTimes_(it);
    if (bounds.allDay) continue;
    if (it.transparency === 'transparent') continue;
    if (!calendarEventIsAcceptedCommitmentForUser_(it, myEmail)) continue;
    if (bounds.start.getTime() < slot.end.getTime() && bounds.end.getTime() > slot.start.getTime()) {
      var bid = it.id;
      if (seenId[bid]) continue;
      seenId[bid] = true;
      titles.push(it.summary || '(no title)');
    }
  }

  var blockingReason = '';
  if (titles.length) {
    var maxShow = 5;
    var shown = titles.slice(0, maxShow);
    blockingReason =
      'That 15-minute slot after your meeting ends is blocked by accepted meetings: ' + shown.join('; ');
    if (titles.length > maxShow) {
      blockingReason += ' (and ' + (titles.length - maxShow) + ' more)';
    }
    blockingReason += '.';
  }

  return { debrief: debrief, blockingReason: blockingReason };
}

/**
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event
 * @return {Array<{email: string, label: string}>}
 */
function listInviteesForDisplay_(event) {
  var out = [];
  try {
    var guests = event.getGuestList();
    if (!guests || !guests.length) return out;
    for (var i = 0; i < guests.length; i++) {
      try {
        var g = guests[i];
        var email = ((g.getEmail && g.getEmail()) || '').toLowerCase();
        if (!email) continue;
        var name = '';
        try {
          name = (g.getName && g.getName()) || '';
        } catch (n0) {}
        out.push({
          email: email,
          label: name ? name + ' <' + email + '>' : email,
        });
      } catch (ig) {}
    }
  } catch (eg) {}
  return out;
}

function getPrimaryUserEmail_() {
  var a = Session.getActiveUser().getEmail();
  if (a) return a.toLowerCase();
  var e = Session.getEffectiveUser().getEmail();
  return e ? e.toLowerCase() : '';
}

/**
 * True if this event is committed time for the user (organizer, self-created, or attendee with accepted).
 * Tentative / needsAction / declined do not count toward debrief slot conflicts.
 * @param {Object} item Calendar API Event resource
 * @param {string} myEmail Lowercase email or ''
 * @return {boolean}
 */
function calendarEventIsAcceptedCommitmentForUser_(item, myEmail) {
  if (!myEmail) return true;

  if (item.organizer && item.organizer.self) return true;
  var orgEmail = item.organizer && item.organizer.email;
  if (orgEmail && String(orgEmail).toLowerCase() === myEmail) return true;

  var attendees = item.attendees || [];
  for (var a = 0; a < attendees.length; a++) {
    var att = attendees[a];
    if (!att || !att.email) continue;
    if (String(att.email).toLowerCase() !== myEmail) continue;
    return att.responseStatus === 'accepted';
  }

  if (item.creator && item.creator.self) return true;

  return false;
}

function extractDomain_(email) {
  var at = email.indexOf('@');
  if (at < 0) return '';
  return email.substring(at + 1).toLowerCase();
}

function isResourceOrServiceEmail_(email) {
  var e = email.toLowerCase();
  return (
    e.indexOf('@resource.calendar.google.com') !== -1 ||
    e.indexOf('@group.calendar.google.com') !== -1
  );
}

/**
 * True when at least one human invitee email uses a domain other than `internalDomain`.
 * @param {Array<{email: string}>} invitees
 * @param {string} internalDomain Lowercase host, e.g. example.com
 * @return {boolean}
 */
function meetingHasExternalInvitee_(invitees, internalDomain) {
  var dom = internalDomain || INTERNAL_DOMAIN_FALLBACK;
  for (var i = 0; i < invitees.length; i++) {
    var em = (invitees[i].email || '').toLowerCase();
    if (!em || isResourceOrServiceEmail_(em)) continue;
    var d = extractDomain_(em);
    if (d && d !== dom) return true;
  }
  return false;
}

/**
 * Your RSVP on this event. `getMyStatus()` returns `CalendarApp.GuestStatus` (not MyStatus).
 * @param {GoogleAppsScript.Calendar.CalendarEvent} ev
 * @return {{ key: string, label: string }}
 */
function getMyResponseToEvent_(ev) {
  try {
    var s = ev.getMyStatus();
    if (s === CalendarApp.GuestStatus.YES) return { key: 'accepted', label: 'Accepted' };
    if (s === CalendarApp.GuestStatus.NO) return { key: 'declined', label: 'Declined' };
    if (s === CalendarApp.GuestStatus.MAYBE) return { key: 'maybe', label: 'Maybe' };
    if (s === CalendarApp.GuestStatus.INVITED) return { key: 'invited', label: 'Awaiting response' };
    if (s === CalendarApp.GuestStatus.OWNER) return { key: 'owner', label: 'Organizer' };
  } catch (err) {
    /* fall through */
  }

  var myEmail = getPrimaryUserEmail_();
  if (!myEmail) return { key: 'unknown', label: 'Unknown' };
  try {
    var guests = ev.getGuestList(true);
    for (var i = 0; i < guests.length; i++) {
      var g = guests[i];
      var email = '';
      try {
        email = ((g.getEmail && g.getEmail()) || '').toLowerCase();
      } catch (e0) {}
      if (email !== myEmail) continue;
      var gs;
      try {
        gs = g.getGuestStatus();
      } catch (e1) {
        break;
      }
      if (gs === CalendarApp.GuestStatus.YES) return { key: 'accepted', label: 'Accepted' };
      if (gs === CalendarApp.GuestStatus.NO) return { key: 'declined', label: 'Declined' };
      if (gs === CalendarApp.GuestStatus.MAYBE) return { key: 'maybe', label: 'Maybe' };
      if (gs === CalendarApp.GuestStatus.INVITED) return { key: 'invited', label: 'Awaiting response' };
      if (gs === CalendarApp.GuestStatus.OWNER) return { key: 'owner', label: 'Organizer' };
      return { key: 'unknown', label: 'Unknown' };
    }
  } catch (e2) {}

  return { key: 'unknown', label: 'Unknown' };
}

/**
 * @param {GoogleAppsScript.Calendar.Calendar} cal
 * @param {GoogleAppsScript.Calendar.CalendarEvent} ev
 * @param {Date} now
 * @return {Object} One row for the web UI.
 */
function buildInviteRow_(cal, ev, now) {
  var id = ev.getId();
  var title = (ev.getTitle && ev.getTitle()) || '(no title)';
  var start = ev.getStartTime();
  var end = ev.getEndTime();
  var allDay = false;
  try {
    allDay = ev.isAllDayEvent();
  } catch (a0) {
    allDay = false;
  }
  var invitees = listInviteesForDisplay_(ev);
  var internalDomain = getInternalDomain() || extractDomain_(getPrimaryUserEmail_()) || INTERNAL_DOMAIN_FALLBACK;
  var external = meetingHasExternalInvitee_(invitees, internalDomain);
  var myResponse = getMyResponseToEvent_(ev);

  var debrief = { planned: false };
  var schedule = { canSchedule: false, reason: '', detail: '', canOverride: false };

  if (allDay) {
    schedule.reason = 'all-day';
    schedule.detail = 'Debrief slot is only defined after timed meetings.';
    return {
      id: id,
      title: title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      allDay: true,
      invitees: invitees,
      external: external,
      myResponse: myResponse,
      debrief: debrief,
      schedule: schedule,
    };
  }

  var slotSnap = analyzeDebriefSlotViaApi_(cal, id, end);
  debrief = slotSnap.debrief;
  if (debrief.planned) {
    schedule.reason = 'planned';
    schedule.detail = 'A debrief is already on the calendar for this slot.';
    return {
      id: id,
      title: title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      allDay: false,
      invitees: invitees,
      external: external,
      myResponse: myResponse,
      debrief: debrief,
      schedule: schedule,
    };
  }

  var slot = getDebriefSlot_(end);
  if (slot.end.getTime() <= now.getTime()) {
    schedule.reason = 'past';
    schedule.detail = 'That 15-minute window is already over.';
    return {
      id: id,
      title: title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      allDay: false,
      invitees: invitees,
      external: external,
      myResponse: myResponse,
      debrief: debrief,
      schedule: schedule,
    };
  }

  var block = slotSnap.blockingReason;
  if (block) {
    schedule.reason = 'busy';
    schedule.detail = block;
    schedule.canOverride = true;
  } else {
    schedule.canSchedule = true;
    schedule.reason = '';
    schedule.canOverride = false;
  }

  return {
    id: id,
    title: title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    allDay: false,
    invitees: invitees,
    external: external,
    myResponse: myResponse,
    debrief: debrief,
    schedule: schedule,
  };
}

/**
 * @param {number} scanDays
 * @return {{ ok: boolean, events?: Array<Object>, timedOut?: boolean, error?: string }}
 */
function scanCalendarInviteRows_(scanDays) {
  setupDefaults();
  var cal = CalendarApp.getDefaultCalendar();
  var now = new Date();
  var horizon = new Date(now.getTime() + scanDays * 24 * 60 * 60 * 1000);

  var rows = [];
  var timedOut = false;
  var t0 = Date.now();
  var seen = {};
  var rangeStart = now.getTime();
  var rangeEnd = horizon.getTime();

  while (rangeStart < rangeEnd) {
    if (Date.now() - t0 > SCAN_MAX_RUNTIME_MS) {
      timedOut = true;
      break;
    }
    var chunkStart = new Date(rangeStart);
    var chunkEnd = new Date(Math.min(rangeStart + SCAN_CHUNK_MS, rangeEnd));
    var chunkEvents;
    try {
      chunkEvents = cal.getEvents(chunkStart, chunkEnd);
    } catch (chunkErr) {
      rangeStart += SCAN_CHUNK_MS;
      continue;
    }

    for (var xi = 0; xi < chunkEvents.length; xi++) {
      if (Date.now() - t0 > SCAN_MAX_RUNTIME_MS) {
        timedOut = true;
        break;
      }
      var ev = chunkEvents[xi];
      var eid = ev.getId();
      if (!eid || seen[eid]) continue;
      seen[eid] = true;
      if (listInviteesForDisplay_(ev).length === 0) continue;
      try {
        rows.push(buildInviteRow_(cal, ev, now));
      } catch (rowErr) {
        rows.push({
          id: String(eid).slice(0, 80),
          title: '(error reading event)',
          startIso: '',
          endIso: '',
          allDay: false,
          invitees: [],
          external: false,
          myResponse: { key: 'unknown', label: 'Unknown' },
          debrief: { planned: false },
          schedule: { canSchedule: false, reason: 'error', detail: rowErr.message || String(rowErr), canOverride: false },
        });
      }
    }

    if (timedOut) break;
    rangeStart += SCAN_CHUNK_MS;
  }

  rows.sort(function (a, b) {
    var sa = a.startIso || '';
    var sb = b.startIso || '';
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });

  return { ok: true, events: rows, timedOut: timedOut };
}

/**
 * @param {GoogleAppsScript.Calendar.Calendar} cal
 * @param {string} sourceEventId
 * @param {Date} meetingEnd
 * @return {GoogleAppsScript.Calendar.CalendarEvent|null}
 */
function findEventByIdNearEnd_(cal, sourceEventId, meetingEnd) {
  var pad = 3 * 24 * 60 * 60 * 1000;
  var from = new Date(meetingEnd.getTime() - pad);
  var to = new Date(meetingEnd.getTime() + pad);
  var evs = cal.getEvents(from, to);
  for (var i = 0; i < evs.length; i++) {
    if (evs[i].getId() === sourceEventId) return evs[i];
  }
  return null;
}

/**
 * @param {string} sourceEventId
 * @param {string} meetingEndIso
 * @param {boolean=} overrideConflict When true, skip overlap check for accepted meetings.
 * @return {{ok: true, debrief: Object} | {ok: false, error?: string, authUrl?: string}}
 */
function scheduleDebriefAfterMeeting_(sourceEventId, meetingEndIso, overrideConflict) {
  setupDefaults();
  overrideConflict = !!overrideConflict;
  var cal = CalendarApp.getDefaultCalendar();
  var meetingEnd = new Date(meetingEndIso);
  if (isNaN(meetingEnd.getTime())) {
    return { ok: false, error: 'Invalid meeting end time.' };
  }

  var source = findEventByIdNearEnd_(cal, sourceEventId, meetingEnd);
  if (!source) {
    return { ok: false, error: 'Could not find that meeting. Run Scan again.' };
  }

  var end = source.getEndTime();
  var now = new Date();
  var slot = getDebriefSlot_(end);

  try {
    if (source.isAllDayEvent()) {
      return { ok: false, error: 'All-day events cannot get an automatic debrief slot.' };
    }
  } catch (ad) {}

  var preSlot = analyzeDebriefSlotViaApi_(cal, sourceEventId, end);
  if (preSlot.debrief.planned) {
    return { ok: false, error: 'A debrief is already scheduled for this meeting.' };
  }

  if (slot.end.getTime() <= now.getTime()) {
    return { ok: false, error: 'That debrief window is in the past.' };
  }

  if (!overrideConflict && preSlot.blockingReason) {
    return { ok: false, error: preSlot.blockingReason };
  }

  var mt = (source.getTitle && source.getTitle()) || 'Meeting';
  var title = DEBRIEF_TITLE_PREFIX + mt;
  var description = '15-minute debrief immediately after:\n' + mt;

  var calendarId = cal.getId();
  var privExt = {};
  privExt[DEBRIEF_PRIVATE_SOURCE_KEY] = sourceEventId;
  var eventBody = {
    summary: title,
    description: description,
    start: { dateTime: slot.start.toISOString() },
    end: { dateTime: slot.end.toISOString() },
    extendedProperties: {
      private: privExt,
    },
    /** Focus Time enables auto-decline for overlapping invites (Workspace / supported accounts). */
    eventType: 'focusTime',
    focusTimeProperties: {
      autoDeclineMode: 'declineOnlyNewConflictingInvitations',
      declineMessage: 'This time is reserved for a post-meeting debrief.',
      chatStatus: 'available',
    },
  };

  try {
    Calendar.Events.insert(eventBody, calendarId);
  } catch (focusErr) {
    try {
      delete eventBody.eventType;
      delete eventBody.focusTimeProperties;
      Calendar.Events.insert(eventBody, calendarId);
    } catch (plainErr) {
      return { ok: false, error: plainErr.message || String(plainErr) };
    }
  }

  return {
    ok: true,
    debrief: {
      planned: true,
      title: title,
      startIso: slot.start.toISOString(),
      endIso: slot.end.toISOString(),
    },
  };
}

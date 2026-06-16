# PRD: Calendar debrief (Google Apps Script web app)

**Version:** as implemented in this repository (v1).  
**Audience:** implementers (human or LLM). Only requirements that **exist in code today** are listed.

---

## 1. Product summary

A **single-user Google Apps Script web app** attached to a Google Calendar account. The user scans their **default** calendar for upcoming **meetings with guests** (see filter), sees each meeting’s **time**, **title**, **invitees**, **your RSVP**, **external vs internal** hint, **debrief status**, and **actions** to **schedule** a fixed **15-minute debrief** that starts **exactly when the meeting ends**.

The app creates debrief events on the **same default calendar**, links them to the source meeting via **private Calendar API metadata** (not visible in the normal description), and uses **Focus time** when the account supports it so **new overlapping invitations** can be auto-declined.

---

## 2. Platform & deployment

| Item | Requirement |
|------|-------------|
| Runtime | Google Apps Script, **V8** |
| Project layout | `src/` is the Apps Script root (e.g. clasp) |
| UI | `HtmlService` HTML file evaluated by `doGet` |
| Auth | OAuth scopes include Calendar + `userinfo.email`; web app executes **as user accessing** |
| Calendar APIs | **CalendarApp** for listing meetings and guest list; **Advanced Calendar service** `Calendar` v3 for `Events.list` / `Events.insert` |
| Deploy | Node + clasp; `npm run setup` (or equivalent) pushes and deploys web app |

---

## 3. User-facing features

### 3.1 Scan

- User sets **days ahead** (integer **1–90**); value is **persisted** in Script Properties.
- **Scan calendar** runs a server-side scan from **now** through **now + N days**.
- First interaction uses **`apiPing`** then **`apiScanCalendar`** (warm-up / auth pattern).
- Full scan clears the table, disables the scan button during work, shows progress in a summary line, and has a **client-side timeout** (120s) with user-facing message if exceeded.
- Scan may return **`timedOut: true`** if server-side max runtime (~5 min) is hit while chunking; UI should surface that list may be incomplete.

### 3.2 Which meetings appear (row filter)

- Only events on the **default** calendar (via `CalendarApp.getDefaultCalendar()`).
- **Exclude** any event where **`getGuestList()` yields no attendee with an email** (same rule as “no invitees to show” — solo / empty / non-exposed guest lists are out).
- De-duplicate by event id while scanning.
- Sort rows by **start** ascending, then title.

### 3.3 Table columns

1. **Time** — For timed events: **three lines** (weekday + date, start time, end time). For all-day: stacked day / “All day” / range line as implemented.
2. **Meeting** — Title (escaped), **External** badge when applicable, **RSVP** badge for the signed-in user’s response on **this** event, then bullet list of invitee labels/emails.
3. **Debrief** — For all-day: N/A. Else: **Planned** (with debrief start datetime) or **Not planned** based on linked debrief detection.
4. **Action** — Per rules in §4.

### 3.4 Badges and labels

**RSVP (on the meeting row, not the debrief):** Map `CalendarEvent.getMyStatus()` (returns **`CalendarApp.GuestStatus`**, not `MyStatus`) to labels: Accepted, Declined, Maybe, Awaiting response, Organizer; if that fails, match the signed-in user in `getGuestList(true)` and use each guest’s `getGuestStatus()`.

**External:** If **any** invitee email (excluding resource `@resource.calendar.google.com` and `@group.calendar.google.com`) has a domain **≠** the signed-in user’s email domain (from `Session`), show **External**. If Session provides **no** email, internal domain defaults to **`example.com`** for this comparison only.

### 3.5 Debrief definition

- **Slot:** exactly **15 minutes**, `[meetingEnd, meetingEnd + 15min)`.
- **Planned:** An event in the debrief window (with small time padding around the window for API list) whose **`extendedProperties.private.debriefForEventId`** equals the **source meeting’s event id** (literal string match).
- **Not planned:** No such linked event.

### 3.6 Conflict detection (before allowing “Schedule debrief”)

When deciding if the slot is free for a **new** debrief:

- Consider only **timed** (non–all-day) events that **overlap** the 15-minute slot (same overlap semantics as implemented).
- **Ignore all-day** overlaps entirely.
- **Ignore** events with **`transparency: transparent`** (“Show as free”).
- **Ignore** events unless the user’s calendar commitment is **accepted** in the Calendar API sense:
  - `organizer.self`, or organizer email equals user email, or user’s attendee row has `responseStatus === 'accepted'`, or `creator.self`.
  - Otherwise (tentative, needsAction, declined, or user not identified as committed): **do not** count as blocking.
- If **Session email is missing**, implementation treats overlap filtering conservatively (cannot classify RSVP → all overlapping timed events may still block — match code).

Blocking copy should list titles of blocking events (cap count + “and N more” as implemented).

### 3.7 Actions

| State | UI |
|-------|-----|
| All-day meeting | Action column shows em dash; no schedule |
| Debrief already planned | em dash |
| Past debrief window | **Past** + detail |
| Error building row | **Error** + detail |
| Slot free (per §3.6) | Primary button **Schedule debrief** |
| Slot blocked (per §3.6) | **Conflict** + detail + secondary **Schedule anyway** |

**Schedule debrief**

- On click: button shows **Scheduling…**, disabled, visual “busy” state.
- Calls server with **source event id**, **meeting end ISO**, and **`overrideConflict: false`** unless the control is **Schedule anyway** (`true`).
- On success: success toast; **optimistically** set row to Planned using returned **`debrief`** payload; then **quiet refresh** (re-scan without wiping scan UX: do not empty table at start of quiet scan, do not disable main scan button for quiet path; update summary appropriately).
- On failure: restore button label; show error toast; optional **Authorize** link when server returns `authUrl`.

**Schedule anyway**

- Same as schedule but **`overrideConflict: true`**: server **skips** §3.6 overlap check only; still enforces **already planned debrief**, **past window**, **all-day**, **invalid id**, etc.

### 3.8 Creating the debrief event

- Title: **`Debrief — `** + source meeting title (fallback string if empty).
- Description: short human text only — **no** ISO “meeting ends at …” line in description.
- **Link** source meeting id via **`extendedProperties.private.debriefForEventId`** (key name fixed in code).
- Insert via **`Calendar.Events.insert`**.
- Prefer **`eventType: focusTime`** with **`focusTimeProperties`**: `autoDeclineMode: declineOnlyNewConflictingInvitations`, a fixed **decline message** string, **`chatStatus: available`**. If insert fails (e.g. account cannot create focus time), **retry once** without focus time fields (plain timed event).

### 3.9 Layout & responsiveness

- Page content max width **1280px**, centered, padded.
- Table is horizontally scrollable in narrow view; stacked layout under ~720px as implemented.

---

## 4. Server API (client-callable)

Implementations must expose these **global** functions for `google.script.run`:

| Function | Args | Returns |
|----------|------|---------|
| `apiPing` | none | `{ ok: true, t: ISO string }` |
| `apiScanCalendar` | `scanDays` (optional number) | Success: `{ ok: true, events: Row[], timedOut: boolean }`. Failure: `{ ok: false, error, authUrl?, events: [] }` |
| `apiScheduleDebrief` | `sourceEventId`, `meetingEndIso`, `overrideConflict` (optional boolean) | Success: `{ ok: true, debrief: { planned, title, startIso, endIso } }`. Failure: `{ ok: false, error, authUrl? }` |

**Row object (`Row`)** — each element of `events`:

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Calendar event id |
| `title` | string | |
| `startIso`, `endIso` | string | ISO datetimes |
| `allDay` | boolean | |
| `invitees` | `{ email, label }[]` | Only guests with email |
| `external` | boolean | Per §3.4 |
| `myResponse` | `{ key, label }` | Per §3.4 |
| `debrief` | `{ planned: boolean, title?, startIso?, endIso? }` | |
| `schedule` | `{ canSchedule, reason, detail, canOverride }` | `canOverride` true only for busy/conflict path |

---

## 5. Non-functional

- **Scan chunking:** calendar range processed in **24h** chunks with a **~5 minute** max wall clock per full scan (constants in code).
- **Debrief window API list:** `Events.list` with `singleEvents: true`, bounded `maxResults` (100).
- **Secrets:** no API keys in repo; OAuth via Apps Script.

---

## 6. Explicit non-requirements (not implemented)

Do **not** assume the following exist unless added later:

- Multi-user / shared deployment beyond webapp config
- Calendars other than **default**
- Editing or deleting debriefs from the UI
- Recurrence-specific UI beyond what Calendar returns as single instances
- Email notifications, mobile apps, or non–HtmlService clients
- Legacy description-based debrief linking (`DEBRIEF_FOR_EVENT_ID` in description) — **removed**

---

## 7. Acceptance checklist (implementer self-test)

- [ ] Scan lists only default calendar events with ≥1 guest email.
- [ ] External + RSVP badges match rules in §3.4.
- [ ] Planned debrief detected only via private extended property key used in code.
- [ ] Conflict ignores all-day, transparent, and non-accepted commitments per §3.6.
- [ ] Schedule creates debrief at meeting end, 15 minutes, with link in private extended props.
- [ ] Focus time insert attempted; plain event fallback works if focus time rejected.
- [ ] Schedule anyway bypasses conflict only, not “already planned” / past / all-day.
- [ ] UI: scheduling state, optimistic Planned update, quiet refresh after success.
- [ ] `scanDays` persists and validates 1–90.

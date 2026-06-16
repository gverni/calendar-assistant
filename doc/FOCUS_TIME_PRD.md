# PRD: Focus Time Protector

**Version:** v1 (planned)
**Audience:** implementers (human or LLM). Defines all requirements for the focus time protection feature.

---

## 1. Product summary

An extension to the Calendar Debrief web app. A **Focus Time** tab lets the user browse their default calendar week by week, assess how much focus time each working day has, detect conflicts where accepted meetings eat into focus blocks, and schedule new focus blocks to hit a configurable daily target.

The core value: **actively defend a daily focus time target**, not just report on it — by splitting conflicted blocks and finding replacement slots.

---

## 2. Configuration (`Config.gs`)

All new properties live in `Config.gs` alongside existing ones, ready for a future settings UI.

| Property | Script Property key | Default | Validation |
|----------|-------------------|---------|------------|
| Daily focus target | `FOCUS_TARGET_MINUTES` | 180 min (3 h) | > 0 |
| Focus block duration | `FOCUS_BLOCK_MINUTES` | 90 min | ≥ `FOCUS_MIN_BLOCK_MINUTES` |
| Minimum block size | `FOCUS_MIN_BLOCK_MINUTES` | 30 min | ≥ 15 |
| Working hours start | `WORKING_HOURS_START` | `09:00` | HH:MM, < end |
| Working hours end | `WORKING_HOURS_END` | `18:00` | HH:MM, > start |

All times are in the script's configured time zone (`appsscript.json`).

Note: `SCAN_DAYS_AHEAD` is **not** used by the focus time feature. Week navigation is client-driven (see §5.1).

---

## 3. UI — tab structure

The existing single-page app gains a **tab bar** at the top:

- **Debriefs** — existing behaviour, unchanged
- **Focus Time** — new tab described in this document

Tab switching is **client-side** (no page reload). Both tabs share the same header and styles.

---

## 4. Focus Time tab — scan

### 4.1 Trigger and week navigation

The Focus Time tab opens on the **current week** and scans it automatically on load (after `apiPing`). The user can navigate between weeks using **left (◀) and right (▶) buttons**:

- **Right (▶):** always available — navigates to the next week.
- **Left (◀):** disabled when already on the current week; never navigates to a past week.
- Navigating to a new week triggers a fresh scan for that week (`apiFocusScan(weekStartIso)`).
- The current week label is shown between the two buttons, e.g. "16–20 Jun 2026".

### 4.2 Which days are scanned

- The week runs **Monday to Friday** of the selected week, hardcoded.
- **Skip** any day that contains an event with `eventType: outOfOffice`. The entire day is considered unavailable; no focus blocks are proposed or created.
- Days outside working hours are ignored (no blocks placed before `WORKING_HOURS_START` or after `WORKING_HOURS_END`).

### 4.3 Past days (current week only)

On the current week, days whose date is **before today** are shown but **greyed out**:
- Their data (existing focus, conflicts) is still displayed for information.
- No action button is shown — scheduling is disabled for past days.
- Today and future days within the week behave normally.

### 4.4 Existing focus time detection

An event counts as existing focus time for the day if:
- Its `eventType` is `focusTime`, **regardless** of who created it.
- It overlaps the working hours window (clamp to working hours for duration counting).

### 4.5 Conflict detection on existing focus blocks

For each existing focus block, find all **accepted timed meetings** that overlap it, using the same logic as `calendarEventIsAcceptedCommitmentForUser_` in `CalendarDebrief.gs` (organizer, `organizer.self`, `creator.self`, or attendee with `responseStatus: accepted`; ignore all-day, transparent, tentative, declined, needsAction).

A focus block with one or more such conflicts is **conflicted**.

### 4.6 Splitting conflicted blocks

When a focus block is conflicted, the script **proposes** to:

1. **Delete** the original focus block.
2. **Create** replacement blocks for each free sub-interval within the original block that is ≥ `FOCUS_MIN_BLOCK_MINUTES`.

Example: focus 10:00–11:30, meeting 10:30–11:00 → propose delete original, create 10:00–10:30 and 11:00–11:30.

Sub-intervals shorter than `FOCUS_MIN_BLOCK_MINUTES` are discarded (not created).

### 4.7 Daily focus total and gap calculation

After resolving conflicts:

- **Effective focus minutes** = sum of durations of all non-conflicted focus blocks + sum of durations of the proposed replacement sub-intervals (i.e. the time that will remain after splits).
- **Gap** = `FOCUS_TARGET_MINUTES` − effective focus minutes. If ≤ 0, day is already met.

### 4.8 Filling the gap — new block proposals

If a gap remains, the script finds free slots within working hours (earliest first) to fill it:

- A slot is free if no accepted timed event overlaps it (same rules as §4.5).
- Existing focus blocks (including proposed split replacements) also occupy slots and are not double-booked.
- Try to fill with blocks of `FOCUS_BLOCK_MINUTES` first; if the remaining gap or remaining free slot is smaller but ≥ `FOCUS_MIN_BLOCK_MINUTES`, use that shorter duration.
- Stop when gap is filled or no more free slots exist.
- If the day cannot be fully filled, record the shortfall (phase 2: weekly recovery).

---

## 5. UI — week layout

### 5.1 Week navigation bar

```
  ◀   |   16–20 Jun 2026   |   ▶
```

- Displayed above the day columns.
- ◀ is **disabled** (greyed out) when the displayed week is the current week.
- ▶ is always enabled.
- Navigating replaces the day columns with a loading state, then renders the new week's data.

### 5.2 Day columns layout

Days are displayed **horizontally** as columns (week-style, like Google Calendar). Each column represents one working day (Mon–Fri) of the selected week.

Past days on the current week are **greyed out** (muted text, no action button).

### 5.3 Day column contents

Each column shows:

| Element | Detail |
|---------|--------|
| **Date** | Weekday + date (e.g. "Mon 16 Jun") |
| **OoO indicator** | If day is skipped due to OoO, show "Out of office" and grey out the column |
| **Existing focus** | Total effective focus minutes (post-split), e.g. "2h 00min" |
| **Conflicts** | For each conflicted block: conflicting meeting title + overlap duration, e.g. "'Product sync' eats 30min" |
| **Gap** | How far from target, e.g. "−1h 00min" or "Target met ✓" |
| **Proposed actions** | List of: splits to perform (delete + create) and new blocks to create (time + duration) |
| **Action button** | See §5.4 |

### 5.4 Action button states

| State | Button |
|-------|--------|
| Past day (current week) | No button |
| OoO day | No button |
| Target already met, no conflicts | "Nothing to do" (disabled) |
| Has proposals (splits and/or new blocks) | Primary **"Schedule"** button |
| Scheduling in progress | "Scheduling…" (disabled, busy state) |
| Done | "Done" (disabled) + success toast |
| Partial (could not fill full gap) | "Done — Xh short" (disabled) + warning toast |
| Error | "Error" + detail |

---

## 6. Server API

### `apiFocusScan(weekStartIso)`

Scans the Mon–Fri of the given week and returns a day-by-day assessment.

- `weekStartIso`: ISO date string of the Monday of the week to scan, e.g. `"2026-06-16"`.

**Returns:**

```
{
  ok: true,
  days: DayRow[],
  timedOut: boolean
} | {
  ok: false,
  error: string,
  authUrl?: string,
  days: []
}
```

**`DayRow` object:**

| Field | Type | Notes |
|-------|------|-------|
| `date` | string | ISO date, e.g. `2026-06-16` |
| `past` | boolean | True if date is before today (current week only) |
| `skipped` | boolean | True if OoO day |
| `effectiveFocusMinutes` | number | Post-split total |
| `targetMinutes` | number | From config |
| `gapMinutes` | number | 0 if target met |
| `conflicts` | `{ blockTitle, meetingTitle, overlapMinutes }[]` | One per conflict |
| `proposals` | `Proposal[]` | Empty if past or skipped |

**`Proposal` object:**

| Field | Type | Notes |
|-------|------|-------|
| `type` | `'split'` \| `'new'` | |
| `deleteEventId` | string? | Set for `split` — the original block to delete |
| `blocks` | `{ startIso, endIso }[]` | Blocks to create (1 for `new`, 1–2 for `split`) |

### `apiFocusScheduleDay(date, proposals)`

Executes all proposals for a single day:

1. For each `split` proposal: delete original event, then create replacement blocks.
2. For each `new` proposal: create the block.

All created blocks use:
- `eventType: focusTime`
- `focusTimeProperties`: `autoDeclineMode: declineOnlyNewConflictingInvitations`, fixed decline message, `chatStatus: available`
- Fallback to plain timed event if focus time insert fails (same pattern as debrief)
- `extendedProperties.private.focusProtectorOwned: 'true'` on all created events

**Returns:**

```
{
  ok: true,
  scheduledMinutes: number,
  gapRemainingMinutes: number
} | {
  ok: false,
  error: string,
  authUrl?: string
}
```

---

## 7. Constants (in a new `FocusTime.gs`)

| Constant | Value | Notes |
|----------|-------|-------|
| `FOCUS_PRIVATE_OWNED_KEY` | `'focusProtectorOwned'` | Private extended property key; do not rename |
| `FOCUS_TIME_EVENT_TYPE` | `'focusTime'` | Calendar API event type string |

---

## 8. Non-functional

- Scan covers exactly Mon–Fri of the requested week; no chunking needed (fixed 5-day window).
- All times clamped to working hours before duration calculations.
- `singleEvents: true` on all `Calendar.Events.list` calls.
- `maxResults: 100` per `Events.list` call.

---

## 9. Explicit non-requirements (phase 2)

- Keyword-based OoO/bank holiday detection
- Weekly recovery (scheduling extra focus time on other days to compensate for a short day)
- "Schedule all days" button
- Editing or deleting focus blocks from the UI
- Multi-calendar support
- Navigating to weeks before the current week

---

## 10. Acceptance checklist

- [ ] Tab opens on current week and scans automatically.
- [ ] ◀ button disabled on current week; ▶ always enabled.
- [ ] Past days on current week are greyed out with no action button.
- [ ] OoO days (eventType: outOfOffice) are skipped entirely.
- [ ] Any focusTime event counts toward the daily total, regardless of creator.
- [ ] Conflicts detected using same accepted-commitment logic as debrief feature.
- [ ] Conflicted block → delete original, create sub-intervals ≥ min block size.
- [ ] Gap filled earliest-first, preferred block size, falling back to min block size.
- [ ] All created blocks tagged with `focusProtectorOwned: 'true'` private property.
- [ ] Focus time insert attempted; plain event fallback if rejected.
- [ ] Day column shows conflicts with meeting title and overlap duration.
- [ ] "Schedule" button handles splits + new blocks in one click.
- [ ] Partial days report shortfall clearly.
- [ ] Config properties readable/writable via `Config.gs` getters/setters.


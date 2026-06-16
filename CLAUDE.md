# Calendar Debrief - Claude Code guide

## What this project is

A Google Apps Script web app that scans the user's default Google Calendar for upcoming meetings with guests and lets them schedule a 15-minute debrief block immediately after each meeting ends.

See `doc/DEBRIEFS_PRD.md` for the Debriefs requirements spec and `doc/FOCUS_TIME_PRD.md` for the Focus Time requirements.

## Deploy

```bash
npm install
npm run login    # once
npm run release  # first run creates prod deployment; subsequent runs update it
```

After any source change: `npm run push` (dev, test via HEAD URL), then `npm run release` to ship to prod. Run `npm run urls` to print both URLs at any time.

## Key rules

- Server entry points must stay as **global functions**: `apiPing`, `apiScanCalendar`, `apiScheduleDebrief`, `apiGetSettings`, `apiSaveSettings`.
- Do not rename `DEBRIEF_PRIVATE_SOURCE_KEY` (`debriefForEventId`) — it links existing debrief events to source meetings; renaming breaks detection of already-planned debriefs.
- The Advanced Calendar service (`Calendar` v3) must stay enabled in `appsscript.json`.
- Do not break the `Row` JSON shape without updating the renderers in `Index.html` (`buildCard`, `renderCards`).

## Settings storage

All user-configurable settings are stored in **`UserProperties`** (per Google account, isolated per user). Do not use `ScriptProperties` for any user-facing setting — it is a shared store and would affect all users of the deployment.

## Configurable User Properties

| Property | Setter | Default | Notes |
|----------|--------|---------|-------|
| `SCAN_DAYS_AHEAD` | `setScanDays(n)` | 14 | 1–90 days |
| `INTERNAL_DOMAIN` | `setInternalDomain(d)` | _(empty)_ | Domain used for External badge; falls back to Session email domain, then `INTERNAL_DOMAIN_FALLBACK` (`example.com`) |
| `FOCUS_TARGET_MINUTES` | `setFocusTargetMinutes(n)` | 180 | Daily focus target |
| `FOCUS_BLOCK_MINUTES` | `setFocusBlockMinutes(n)` | 90 | Preferred block size (≥ min block) |
| `FOCUS_MIN_BLOCK_MINUTES` | `setFocusMinBlockMinutes(n)` | 30 | Minimum schedulable block (≥ 15) |
| `WORKING_HOURS_START` | `setWorkingHoursStart(t)` | `09:00` | HH:MM |
| `WORKING_HOURS_END` | `setWorkingHoursEnd(t)` | `18:00` | HH:MM |

## Common change recipes

| Goal | Where to change |
|------|-----------------|
| Change debrief length | `DEBRIEF_DURATION_MINUTES` in `CalendarDebrief.gs` |
| Change default internal domain fallback | `INTERNAL_DOMAIN_FALLBACK` in `CalendarDebrief.gs` |
| Change focus-time / auto-decline settings | `scheduleDebriefAfterMeeting_` in `CalendarDebrief.gs` |
| Change "accepted" conflict logic | `calendarEventIsAcceptedCommitmentForUser_` |
| Add a table column | `buildInviteRow_` + `Index.html` table header + `renderTable` row template |

# Calendar Assistant (Google Apps Script)

A self-hosted Google Apps Script web app for people with **busy calendars** who want to protect their focus time without constantly rearranging it by hand.

If your calendar is frequently interrupted by meetings you can't move — customer calls, team syncs, escalations — you probably spend a lot of time manually splitting and rescheduling your focus blocks. This app automates that.

---

## Features

### Focus Time

Scans the week and keeps each working day on track toward a configurable daily focus-time target (default 3h).

The key idea: when an accepted meeting overlaps one of your focus blocks, the app detects the conflict and proposes to split the block into two smaller pieces around the meeting — so you reclaim as much focus time as possible without manual work.

> **Prerequisite:** Focus Time works by detecting events with Google Calendar's native `focusTime` event type and the exact title **`Focus time`**. You need to have these blocks on your calendar before the app can find and protect them. If you don't have them yet, create a few via Google Calendar (New event → More options → set type to Focus time, title to "Focus time") before running your first scan. If you use a different title, you can update it in the **⚙ Settings** tab.

#### Behaviour

- **Scope:** Mon–Fri only. Out-of-office days are skipped automatically. Opens on the current week; past days are shown greyed out. On weekends, jumps straight to next week.
- **Focus blocks counted:** only `focusTime` events matching the configured title count toward the daily target. Other focus-type events (e.g. a lunch block) occupy the slot but are not counted.
- **Conflict detection:** when an accepted meeting overlaps a focus block, the block is split into two smaller pieces around the conflict. The reclaimed time is fed back into the gap calculation.
- **Proposals:** new blocks are sized at the preferred block size (default 90 min), subject to a minimum (default 30 min). Gaps smaller than the minimum are skipped.
- **Week navigation:** ◀ / ▶ buttons to browse weeks. ↻ refreshes the current week. After scheduling a day, that column auto-refreshes.
- **Scheduling:** proposed changes (splits + new blocks) are previewed per day before any calendar writes. Click **Schedule** on a day column to apply.

---

### Debriefs

Scans upcoming meetings and lets you schedule a 15-minute debrief block immediately after each one.

#### Behaviour

- **Debrief slot:** exactly **15 minutes**, starting **when the meeting ends**.
- **Planned:** an event in that window linked to the source meeting via Calendar **private extended properties** (`debriefForEventId`).
- **Schedule:** creates a **Focus time**-style block titled `Debrief — <meeting title>` with auto-decline for new overlapping invites. Falls back to a normal event if Focus time is not supported.
- **Conflict detection:** checks **timed** events where you are **accepted** (organiser, or attendee with `responseStatus: accepted`). Tentative, declined, and **Show as free** events are ignored. All-day events are ignored.
- **Schedule anyway:** skips the conflict check (planned debrief / past / all-day rules still apply).
- **All-day events** and **past** windows: shown as N/A / Past — no scheduling.

**Guest filter:** only meetings with at least one guest email are shown.

**RSVP badge:** shows your response — Accepted, Declined, Maybe, Awaiting response, Organiser, or Unknown.

**External badge:** shown when any non-resource invitee has a domain other than your sign-in account domain.

---

### Settings

All settings are per-user and can be changed from the **⚙ Settings** tab inside the app. Each user of the same deployment gets their own independent configuration — changing your settings does not affect anyone else.

| Setting | Default | Notes |
|---------|---------|-------|
| Focus time block title | `Focus time` | The exact event title the app looks for. Must match your existing focus blocks. |
| Daily focus target | 180 min | Focus Time target per working day. |
| Preferred block size | 90 min | Target size for new focus blocks. |
| Minimum block size | 30 min | Gaps smaller than this are skipped. |
| Working hours start | 09:00 | No focus blocks scheduled before this. |
| Working hours end | 18:00 | No focus blocks scheduled after this. |
| Scan window | 14 days | How many days ahead the Debriefs tab scans. |
| Internal domain | _(empty)_ | Used for the External badge. Defaults to your sign-in account domain. |

---

## For admins — deploying your own instance

### Prerequisites

- Node.js 18+
- A Google account with Google Calendar
- [clasp](https://github.com/google/clasp) (installed automatically via `npm install`)

### Initial setup

```bash
# 1. Clone the repo
git clone <this-repo>
cd calendar-assistant

# 2. Install dependencies
npm install

# 3. Authenticate clasp with your Google account
npm run login

# 4. Create a new Apps Script project linked to this repo
npx clasp create --type standalone \
  --title "Calendar Assistant" \
  --rootDir src

# 5. Deploy — first run creates the prod deployment and prints your URL
npm run release
```

Open the printed URL in your browser. Google will ask you to authorise Calendar access — click **Authorise**, complete the sign-in flow, then open the URL again.

Share the URL with your team. Each person will be asked to authorise on their first visit.

### Day-to-day workflow

| Command | What it does |
|---------|-------------|
| `npm run push` | Push code to HEAD (dev). Test via the dev URL. |
| `npm run release` | Push + update prod deployment to a new version. |
| `npm run urls` | Print both dev and prod URLs without making changes. |
| `npm run login` | Re-authenticate clasp (run once, or when credentials expire). |
| `npm run open` | Open the Apps Script editor in the browser. |

### Source files

| File | Role |
|------|------|
| `src/appsscript.json` | Timezone, OAuth scopes, `webapp`, Advanced Calendar service (`Calendar` v3) |
| `src/Config.gs` | All user settings via UserProperties |
| `src/CalendarDebrief.gs` | Scan meetings, invitee list, debrief detection and creation |
| `src/FocusTime.gs` | Focus time scan, conflict/split logic, block scheduling |
| `src/Web.gs` | `doGet`, API entry points (`apiScanCalendar`, `apiScheduleDebrief`, `apiFocusScan`, `apiFocusScheduleDay`, `apiGetSettings`, `apiSaveSettings`, `apiPing`) |
| `src/Index.html` | Full web UI (both tabs + settings) |

### Contributing

Contributions are welcome. To run the project locally you need a `.clasp.json` file pointing at your own Apps Script project — follow the setup steps above to create one.

### Documentation

- **[doc/FOCUS_TIME_PRD.md](doc/FOCUS_TIME_PRD.md)** — Focus Time product requirements.
- **[doc/DEBRIEFS_PRD.md](doc/DEBRIEFS_PRD.md)** — Debriefs product requirements.
- **[doc/SETTINGS_PRD.md](doc/SETTINGS_PRD.md)** — Settings product requirements.

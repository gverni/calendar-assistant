# PRD: Settings tab

## Goal

Let each user of the shared deployment configure their own preferences without affecting other users. Settings are stored in Apps Script **UserProperties** (per Google account, server-side, syncs across devices).

---

## Background

All settings are currently stored in `ScriptProperties`, which is a single shared store for the entire deployment. Any change made by one user overwrites the value for everyone. Migrating to `UserProperties` gives each user a fully isolated configuration.

---

## Settings exposed in the UI

### General

| Label | Property key | Type | Default | Validation |
|-------|-------------|------|---------|------------|
| Internal domain | `INTERNAL_DOMAIN` | text | _(empty — falls back to session email domain)_ | Valid `x.y` domain or empty |

### Debriefs

| Label | Property key | Type | Default | Validation |
|-------|-------------|------|---------|------------|
| Scan window (days) | `SCAN_DAYS_AHEAD` | integer | 14 | 1–90 |

The scan days input in the Debriefs tab remains. On tab load it is seeded from the user's saved setting (via `apiGetSettings`). The user can adjust it inline for the current session without it persisting. To permanently change the default, they update it in Settings and save.

### Focus Time

| Label | Property key | Type | Default | Validation |
|-------|-------------|------|---------|------------|
| Daily target | `FOCUS_TARGET_MINUTES` | integer (minutes) | 180 | > 0 |
| Preferred block size | `FOCUS_BLOCK_MINUTES` | integer (minutes) | 90 | ≥ min block size |
| Minimum block size | `FOCUS_MIN_BLOCK_MINUTES` | integer (minutes) | 30 | ≥ 15 |
| Working hours start | `WORKING_HOURS_START` | text HH:MM | `09:00` | valid HH:MM, before end |
| Working hours end | `WORKING_HOURS_END` | text HH:MM | `18:00` | valid HH:MM, after start |

Minutes fields are displayed and edited in minutes (not hours) to keep it simple.

---

## UI

### Tab bar

The tab bar becomes:

```
[ Focus Time ]  [ Debriefs ]                    [ ⚙ Settings ]
```

Settings tab is right-aligned using `margin-left: auto` on its tab item. The gear icon (`⚙` or an SVG) is part of the tab label. Clicking anywhere on the tab switches to the Settings view, identical to how Focus Time and Debriefs tabs work.

### Settings tab content

- Three labelled sections: **General**, **Debriefs**, **Focus Time**.
- Each setting is a labelled row: label on the left, input on the right.
- Minutes fields: `<input type="number" min="…">` with a `min` suffix label.
- HH:MM fields: `<input type="text" pattern="\d{2}:\d{2}" placeholder="HH:MM">`.
- Internal domain: `<input type="text" placeholder="e.g. example.com">` — can be left blank.
- A single **Save settings** button at the bottom of the form.
- Settings are loaded from the server when the tab is first opened (one `apiGetSettings` call). Subsequent opens within the same page session reuse the cached values.

### Save flow

1. User edits fields.
2. Client validates:
   - Scan days: integer, 1–90.
   - Focus min block: integer ≥ 15.
   - Focus block: integer ≥ min block.
   - Working hours: valid HH:MM, start < end.
   - Internal domain: empty OR matches `/^[a-z0-9-]+\.[a-z]{2,}$/i`.
3. Invalid fields are highlighted in red with an inline message. Save is blocked.
4. On valid form: call `apiSaveSettings(settingsObject)`.
5. On success: show a green toast ("Settings saved").
6. On error: show a red inline error below the Save button. Edits are preserved.

### Post-save behaviour

When the user navigates from Settings to Focus Time or Debriefs after a successful save, the tab auto-triggers a re-scan (same as clicking Scan / the refresh button). This ensures the data reflects the new settings without requiring manual action.

---

## Server-side changes

### `Config.gs`

- Replace every `PropertiesService.getScriptProperties()` call with `PropertiesService.getUserProperties()`.
- `setupDefaults()` writes defaults into `UserProperties` instead of `ScriptProperties`.
- No changes to function signatures or property key strings.

### `Web.gs`

Add two new global functions:

```javascript
// Returns all current settings for the calling user.
function apiGetSettings() → { ok: true, settings: SettingsObject }

// Validates and saves all settings atomically.
function apiSaveSettings(settings) → { ok: true } | { ok: false, error: string }
```

`SettingsObject` shape:
```json
{
  "scanDays": 14,
  "internalDomain": "",
  "focusTargetMinutes": 180,
  "focusBlockMinutes": 90,
  "focusMinBlockMinutes": 30,
  "workingHoursStart": "09:00",
  "workingHoursEnd": "18:00"
}
```

`apiSaveSettings` validates all fields server-side (same rules as client) and writes them in one batch. If any field is invalid, nothing is written and an error is returned.

---

## Migration

Existing `ScriptProperties` values are **not** migrated. On first open after the change, each user's `UserProperties` will be empty and `setupDefaults()` will write the defaults. Users with non-default values previously set via the script editor will need to re-enter them through the Settings tab. This is acceptable given the small user base.

---

## Out of scope

- `DEBRIEF_DURATION_MINUTES` — hard-coded constant, not a user-configurable property.
- Admin-only settings visible only to the script owner.
- Settings export / import.

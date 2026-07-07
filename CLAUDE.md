# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Automates submitting Strava activities into a Google Form ("Rekordowe kilometry",
a summer km-collecting challenge). Flow: parse a Strava CSV export → local JSON DB →
drive a real Chrome browser to fill and submit the form, one activity at a time,
flagging each as `submitted` so re-runs skip it.

User-facing docs (`README.md`, `gui/README.md`) and all form labels are in Polish.

## Two implementations (and branch layout)

- **`src/` — CLI** (original). ESM (`"type": "module"`), uses `playwright` + `lowdb`.
- **`gui/` — Electron GUI**. CommonJS, uses `playwright-core` + plain `fs` (no lowdb).
  Ports the same domain logic from `src/` so it can package cleanly into a binary.

Branch split: **`main`** has only the CLI (`src/`). **`gui-electron`** adds `gui/`.
The two share no code — `gui/lib/*` is a deliberate port, so a change to form
mapping or import logic must be made in **both** `src/formMapping.js`/`src/import.js`
and `gui/lib/mapping.js`/`gui/lib/importCsv.js`.

## Commands

CLI (repo root):
```bash
npm install
npx playwright install chromium   # once
node src/login.js                 # opens real Chrome, log in to Google manually
node src/inspectForm.js           # dump form structure -> form-raw.json / form-fields.json
npm run import                    # activities.csv -> db.json (idempotent)
npm run submit -- --limit 1       # DRY-RUN by default (fills, does not submit)
npm run submit -- --submit        # LIVE: actually clicks "Prześlij"
npm run list                      # show in-range submitted/pending
```
`submit.js` flags: `--submit` (live), `--limit N`, `--headed`, `--screenshot`.

GUI (`gui/`):
```bash
cd gui && npm install && npm start   # dev
npm run dist:mac | dist:win | dist:linux   # electron-builder -> gui/dist/ (.dmg / .zip / AppImage)
```

No test framework. Logic changes have been verified with throwaway scripts that mock
the `electron` module (so `gui/lib/paths.js` resolves) and point the "app directory"
at a temp dir — see prior scratchpad tests for the pattern.

## Critical constraints (non-obvious, load-bearing)

- **Must use the system-installed Google Chrome**, via Playwright's `channel: 'chrome'`.
  Google blocks login from a bundled/automation Chromium with "This browser or app may
  not be secure". This was confirmed empirically (an Electron-native login PoC was
  blocked). Consequences:
  - The GUI does **not** use Electron's own Chromium for the form work; it spawns
    `playwright-core` against system Chrome. Chrome must be installed on the machine —
    the packaged binary is therefore *not* fully self-contained, by necessity.
  - Do not "simplify" by embedding the browser or submitting via a headless/bundled one.
- **The form requires Google login** because it contains a `FILE_UPLOAD` question
  ("Zdjęcie", optional). File-upload forms force sign-in, so a plain HTTP POST to
  `formResponse` (or a prefilled-link approach) will not work — a logged-in browser
  session is mandatory. The session lives in the persistent profile `.chrome-profile/`.
- **`FB_PUBLIC_LOAD_DATA_`** (a global Google Forms injects) is the "form is really
  loaded / session valid" signal used everywhere to wait on. `inspectForm.js` parses it
  to derive `entry.*` field IDs into `form-fields.json`.
- **Windows target is `zip`, not `portable`.** electron-builder's NSIS `portable` target
  self-extracts to a new (or same, if `unpackDirName` were set) folder under
  `%LOCALAPPDATA%\Temp` on every launch. Since `gui/lib/paths.js` resolves the "app
  directory" as *next to the running executable*, a portable build would silently lose
  `config.json`/`db.json`/`.chrome-profile/` (or put user data at risk of Temp cleanup)
  between runs. `zip` requires the user to extract once to a permanent folder — the
  `.exe` there is stable, matching how `.dmg`/AppImage already behave.

## Data flow & form mapping

`activities.csv` (Strava bulk export) → **import** parses fixed column indices (`COL` in
`import.js`, using the CSV's *detailed* duplicate columns), writes `db.json`. Import is
idempotent and **preserves `submitted`/`submittedAt`/`submitError`** across re-imports.

**Strava localizes the CSV export per account language** — confirmed on a real Polish
export: headers, the date string format (day-before-month, 24h clock, localized month
abbreviation — not just the month name), and activity-type *values* (e.g. `"Jazda"` not
`"Ride"`) all change. Column *order* stays the same, so positional `COL` parsing is
unaffected, and numeric columns in the detailed block stay period-decimal regardless of
language (only the separate, unused "summary" block uses locale-formatted commas). GUI
(`gui/lib/importCsv.js`) handles PL/EN/DE: header validation accepts known variants per
language, `parseDate` tries a list of `{format, locale}` candidates via dayjs
`customParseFormat`. The DE variant is an unverified best-effort guess (no real German
sample obtained) — fix header/date strings there if a real DE export contradicts them.
Translated activity-type values are handled by `typeMapping` in `config.json`, which is
now editable from the GUI itself ("Mapowanie typów aktywności" panel — add/remove
entries; `gui/lib/config.js`'s `addTypeMapping`/`removeTypeMapping`). The right-hand
side (form option) is constrained to `FORM_OPTIONS`, a hardcoded list of the 3 real
radio options for "Rodzaj aktywności" (confirmed via `form-fields.json`, generated by
`inspectForm.js`) — the form's own fields are fixed, so this isn't user-editable, only
selectable. On the very first import ever (empty `db.json`), `importCsv.js` detects the
CSV's header language and merges a per-language default mapping
(`DEFAULT_TYPE_MAPPING_BY_LANG`) into `config.json`, additively (never overwrites
existing keys); later imports don't touch it again. The `en` entries mirror the
long-standing `DEFAULT_CONFIG`; `pl`'s `Jazda`/`Spacer` are confirmed from a real
export, everything else (`pl`'s `Bieganie`, all of `de`) is an unverified best-effort
guess — deliberately missing `Hike`/`TrailRun` equivalents for PL/DE rather than risk
silently mis-mapping them; those show up in the GUI's "niezmapowane typy" (unmapped
types) warning instead, which the user resolves by adding the mapping themselves. This
is GUI-only — `src/import.js` (CLI) was not updated to match.

**submit** filters `db.json` for eligible activities (`isEligible`: in date range, has a
`typeMapping`, not a `skipType`, not already submitted), then for each: `buildPayload` →
`fillForm`. Form fields have no real `<label>`s, so `fillForm` locates each question by
`div[role="listitem"]` filtered by a short heading prefix (`LABELS`), then reaches into
the input/textbox. Distance is formatted `"km,mmm"` (e.g. `28,581`) from raw meters.

## Config & generated files (gitignored — personal data)

`config.json` (real config; `config.example.json` is the template), `activities.csv`,
`db.json`, `.chrome-profile/`, `screenshots/`, `form-*.json` are all gitignored.
`config.json` drives everything: `formUrl`, `displayName`, `dateFrom`/`dateTo`,
`timeSource` (`moving`|`elapsed`), `skipTypes`, `typeMapping` (Strava type → form option).

CLI (`src/`) requires the user to manually copy `config.example.json` → `config.json`.
GUI (`gui/`) does not: `gui/lib/config.js` has a built-in `DEFAULT_CONFIG`
(`timeSource`/`skipTypes`/`typeMapping`, same values as `config.example.json`) and
auto-creates `config.json` on first `loadConfig()` call if missing, and merges
`DEFAULT_CONFIG` into whatever is on disk on every load (so a hand-edited file
missing those keys still works). Only `formUrl`/`displayName`/`dateFrom`/`dateTo`
are user-editable, via the "Ustawienia" panel in the GUI (`updateSettings()` in
`gui/lib/config.js`). `loadConfig()` never throws for missing/empty fields;
`requireReady(config)` is the explicit check used by `login.js`/`submit.js` where a
complete config is actually required.

## GUI-specific architecture

- **"App directory" convention** (`gui/lib/paths.js`): all working files (config, db,
  csv, `screenshots/`, `.chrome-profile/`) live next to the executable when packaged, or
  in the project root in dev (`app.isPackaged`). New file access must go through `paths`.
- **CommonJS + no lowdb** on purpose: lowdb v7 is ESM-only and complicates packaging;
  `gui/lib/db.js` is plain `fs` JSON read/write.
- Screenshots are split by mode: `screenshots/dry-run/` and `screenshots/live/`
  (`{id}-filled.png`, plus `{id}-confirm.png` for live). Same filename per activity, so
  re-runs overwrite rather than accumulate.
- Main process (`gui/main.js`) runs all Node/Playwright work and streams a live log to the
  renderer over IPC (via `gui/preload.js`); long tasks (`import`/`login`/`submit`) are
  fire-and-forget with `busy`/`done`/`error` events, plus a cooperative cancel flag.
- `electron-builder` config lives in `gui/package.json`; `playwright-core` is `asarUnpack`ed
  so it runs from the packaged app.

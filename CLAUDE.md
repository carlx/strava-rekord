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
npm run dist:mac | dist:win | dist:linux   # electron-builder -> gui/dist/ (.dmg / portable .exe / AppImage)
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

## Data flow & form mapping

`activities.csv` (Strava bulk export) → **import** parses fixed column indices (`COL` in
`import.js`, using the CSV's *detailed* duplicate columns), writes `db.json`. Import is
idempotent and **preserves `submitted`/`submittedAt`/`submitError`** across re-imports.

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

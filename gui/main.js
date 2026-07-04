const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let mainWin = null;
let busy = false;
let cancelFlag = false;

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}
const log = (line) => send('log', String(line));

const iconPath = path.join(__dirname, 'build', 'icon.png');

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: 'Strava Rekord',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('closed', () => { mainWin = null; });
}

// --- status (lekki, bez Playwrighta) ---
ipcMain.handle('status', async () => {
  const { paths } = require('./lib/paths');
  const { readDb } = require('./lib/db');

  const out = {
    base: paths.base(),
    hasConfig: fs.existsSync(paths.config()),
    hasCsv: fs.existsSync(paths.csv()),
    hasDb: fs.existsSync(paths.db()),
    hasProfile: fs.existsSync(paths.profile()),
  };

  let config = null;
  try {
    config = require('./lib/config').loadConfig();
    out.range = { from: config.dateFrom, to: config.dateTo };
    out.displayName = config.displayName;
    out.formUrl = config.formUrl;
    out.needsSetup = !config.formUrl || !config.displayName;
  } catch (e) {
    // loadConfig() nie rzuca dla brakującego pliku/pól — tylko dla
    // realnie uszkodzonego JSON-a (błąd parsowania).
    out.configError = e.message;
  }

  try {
    const { isEligible } = require('./lib/mapping');
    const db = readDb();
    const all = db.activities;
    out.counts = {
      total: all.length,
      submitted: all.filter((a) => a.submitted).length,
      eligible: config ? all.filter((a) => isEligible(a, config)).length : null,
    };
  } catch {
    /* baza nieczytelna — pomijamy liczniki */
  }

  return out;
});

// --- zapis ustawień (formUrl/displayName/zakres dat) do config.json ---
ipcMain.handle('save-settings', async (_e, settings) => {
  const { updateSettings } = require('./lib/config');
  const r = updateSettings(settings);
  log(`⚙️ Ustawienia zapisane: ${r.formUrl} / ${r.displayName} / ${r.from} → ${r.to}`);
  return r;
});

// --- lista (lekka) ---
ipcMain.handle('list', async () => {
  const { listActivities } = require('./lib/listActivities');
  return listActivities();
});

// --- zadania długie (strumieniują log) ---
function startTask(name) {
  if (busy) throw new Error('Inne zadanie już trwa.');
  busy = true;
  cancelFlag = false;
  send('busy', { active: true, label: name });
  log(`\n▶ ${name}`);
}
function endTask(result) {
  busy = false;
  send('busy', { active: false });
  send('done', result ?? null);
}
function failTask(err) {
  busy = false;
  send('busy', { active: false });
  log(`❌ ${err.message}`);
  send('error', err.message);
}

ipcMain.on('import', async () => {
  try {
    startTask('Import activities.csv');
    const { importCsv } = require('./lib/importCsv');
    const r = await importCsv(log);
    endTask(r);
  } catch (e) { failTask(e); }
});

ipcMain.on('login', async () => {
  try {
    startTask('Logowanie do Google');
    const { login } = require('./lib/login');
    await login(log);
    endTask();
  } catch (e) { failTask(e); }
});

ipcMain.on('submit', async (_e, opts) => {
  try {
    startTask(opts.live ? 'Wysyłka (LIVE)' : 'Dry-run');
    const { submit } = require('./lib/submit');
    const r = await submit(opts, log, () => cancelFlag, (p) => send('progress', p));
    endTask(r);
  } catch (e) { failTask(e); }
});

ipcMain.on('cancel', () => {
  if (busy) {
    cancelFlag = true;
    log('⏹ Zatrzymuję po bieżącej aktywności…');
  }
});

ipcMain.on('open-dir', () => {
  const { paths } = require('./lib/paths');
  shell.openPath(paths.base());
});

// Wybór pliku CSV przez natywny dialog — kopiuje go do katalogu aplikacji
// (paths.csv()), tak by dalszy import działał jak dziś.
ipcMain.handle('choose-csv', async () => {
  const { paths } = require('./lib/paths');
  const { assertValidActivitiesCsv } = require('./lib/importCsv');
  const result = await dialog.showOpenDialog(mainWin, {
    title: 'Wybierz eksport CSV ze Stravy',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const src = result.filePaths[0];
  if (!src.toLowerCase().endsWith('.csv')) {
    throw new Error('Wybierz plik z rozszerzeniem .csv.');
  }
  assertValidActivitiesCsv(src);
  fs.copyFileSync(src, paths.csv());
  log(`📄 Skopiowano plik CSV: ${src}`);
  return { path: paths.csv() };
});

// --- podgląd screenshotów (dry-run / live) ---
function shotsDir(mode) {
  const { paths } = require('./lib/paths');
  return path.join(paths.screenshots(), mode === 'live' ? 'live' : 'dry-run');
}
// Ścieżka musi leżeć wewnątrz katalogu screenshots (ochrona przed path traversal).
function assertInsideShots(filePath) {
  const { paths } = require('./lib/paths');
  const root = path.resolve(paths.screenshots());
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Niedozwolona ścieżka.');
  }
  return resolved;
}

// Zwraca wiersze per aktywność (pogrupowane zrzuty + dane z bazy i payload).
ipcMain.handle('list-shots', async (_e, mode) => {
  const dir = shotsDir(mode);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png'));
  } catch { names = []; }

  const byId = new Map();
  for (const name of names) {
    const m = name.match(/^(.*)-(filled|confirm)\.png$/i);
    const id = m ? m[1] : name.replace(/\.png$/i, '');
    const kind = m ? m[2].toLowerCase() : 'inny';
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ kind, name, path: path.join(dir, name) });
  }

  const { readDb } = require('./lib/db');
  const dbById = new Map(readDb().activities.map((a) => [String(a.id), a]));

  let config = null, configError = null;
  try { config = require('./lib/config').loadConfig(); }
  catch (e) { configError = e.message; }
  const { buildPayload } = require('./lib/mapping');

  const kindRank = { filled: 0, confirm: 1 };
  const rows = [];
  for (const [id, shots] of byId) {
    shots.sort((a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9));
    const a = dbById.get(String(id));
    let payload = null;
    if (a && config) { try { payload = buildPayload(a, config); } catch { /* pomiń */ } }
    rows.push({
      id,
      inDb: !!a,
      date: a?.date ? a.date.slice(0, 10) : null,
      type: a?.type ?? null,
      name: a?.name ?? null,
      submitted: !!a?.submitted,
      submittedAt: a?.submittedAt ?? null,
      submitError: a?.submitError ?? null,
      payload,
      configError: payload ? null : configError,
      shots,
    });
  }
  rows.sort((x, y) =>
    (x.date || '').localeCompare(y.date || '') || String(x.id).localeCompare(String(y.id))
  );
  return rows;
});

ipcMain.handle('read-shot', async (_e, filePath) => {
  const resolved = assertInsideShots(filePath);
  const buf = fs.readFileSync(resolved);
  return 'data:image/png;base64,' + buf.toString('base64');
});

ipcMain.on('open-shot', (_e, filePath) => {
  try { shell.openPath(assertInsideShots(filePath)); } catch { /* ignore */ }
});

// Usunięcie zapisanej sesji Chrome (profil trwały) — wymusza ponowne logowanie.
ipcMain.handle('logout', async () => {
  if (busy) throw new Error('Inne zadanie trwa — poczekaj na zakończenie.');
  const { paths } = require('./lib/paths');
  fs.rmSync(paths.profile(), { recursive: true, force: true });
  log('🗑 Usunięto zapisaną sesję Chrome. Kliknij „Zaloguj do Google”, aby zalogować się ponownie.');
  return true;
});

app.whenReady().then(() => {
  // W trybie dev macOS pokazuje domyślną ikonę Electrona w docku — spakowana
  // wersja ma własną (build/icon.icns) przez Info.plist, więc nadpisujemy
  // tylko poza paczką.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    app.dock.setIcon(iconPath);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Jednookienkowe narzędzie — zamknięcie okna ma kończyć całą appkę (także na
// macOS, gdzie domyślnie Electron zostawia proces w tle/docku).
app.on('window-all-closed', () => {
  app.quit();
});

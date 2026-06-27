const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let mainWin = null;
let busy = false;
let cancelFlag = false;

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}
const log = (line) => send('log', String(line));

function createWindow() {
  mainWin = new BrowserWindow({
    width: 940,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: 'Strava Rekord',
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
  } catch (e) {
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
  send('busy', true);
  log(`\n▶ ${name}`);
}
function endTask(result) {
  busy = false;
  send('busy', false);
  send('done', result ?? null);
}
function failTask(err) {
  busy = false;
  send('busy', false);
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
    const r = await submit(opts, log, () => cancelFlag);
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

// Usunięcie zapisanej sesji Chrome (profil trwały) — wymusza ponowne logowanie.
ipcMain.handle('logout', async () => {
  if (busy) throw new Error('Inne zadanie trwa — poczekaj na zakończenie.');
  const { paths } = require('./lib/paths');
  fs.rmSync(paths.profile(), { recursive: true, force: true });
  log('🗑 Usunięto zapisaną sesję Chrome. Kliknij „Zaloguj do Google”, aby zalogować się ponownie.');
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

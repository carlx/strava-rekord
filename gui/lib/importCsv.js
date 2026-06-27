// Port src/import.js jako funkcja zwracająca podsumowanie i logująca przez callback.
const fs = require('node:fs');
const { parse } = require('csv-parse/sync');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { paths } = require('./paths');
const { readDb, writeDb } = require('./db');

dayjs.extend(customParseFormat);

const DATE_FORMAT = 'MMM D, YYYY, h:mm:ss A';

// Indeksy kolumn w activities.csv (blok szczegółowy — Moving Time + metry + m/s).
const COL = {
  id: 0, date: 1, name: 2, type: 3, description: 4,
  gear: 11, filename: 12, elapsedTimeSec: 15, movingTimeSec: 16,
  distanceM: 17, maxSpeedMs: 18, avgSpeedMs: 19, elevationGainM: 20,
  elevationLossM: 21, avgCadence: 29, maxHr: 30, avgHr: 31,
  maxWatts: 32, avgWatts: 33, calories: 34, commute: 9,
};

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toBool = (v) => v === 'true' ? true : v === 'false' ? false : null;
const toStr = (v) => (v === undefined || v === null || v === '') ? null : v;
const msToKmh = (ms) => ms == null ? null : Math.round(ms * 3.6 * 100) / 100;
const mToKm = (m) => m == null ? null : Math.round(m / 10) / 100;

function parseDate(raw) {
  if (!raw) return null;
  const d = dayjs(raw, DATE_FORMAT, true);
  return d.isValid() ? d.format('YYYY-MM-DDTHH:mm:ss') : null;
}

function rowToActivity(row) {
  const distanceM = toNum(row[COL.distanceM]);
  const avgSpeedMs = toNum(row[COL.avgSpeedMs]);
  const maxSpeedMs = toNum(row[COL.maxSpeedMs]);
  return {
    id: toStr(row[COL.id]),
    date: parseDate(row[COL.date]),
    name: toStr(row[COL.name]),
    type: toStr(row[COL.type]),
    description: toStr(row[COL.description]),
    elapsedTimeSec: toNum(row[COL.elapsedTimeSec]),
    movingTimeSec: toNum(row[COL.movingTimeSec]),
    distanceKm: mToKm(distanceM),
    avgSpeedKmh: msToKmh(avgSpeedMs),
    maxSpeedKmh: msToKmh(maxSpeedMs),
    elevationGainM: toNum(row[COL.elevationGainM]),
    elevationLossM: toNum(row[COL.elevationLossM]),
    avgHr: toNum(row[COL.avgHr]),
    maxHr: toNum(row[COL.maxHr]),
    avgCadence: toNum(row[COL.avgCadence]),
    avgWatts: toNum(row[COL.avgWatts]),
    maxWatts: toNum(row[COL.maxWatts]),
    calories: toNum(row[COL.calories]),
    commute: toBool(row[COL.commute]),
    gear: toStr(row[COL.gear]),
    filename: toStr(row[COL.filename]),
    raw: row,
    submitted: false,
    submittedAt: null,
    submitError: null,
  };
}

async function importCsv(log = () => {}) {
  const csvPath = paths.csv();
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Brak activities.csv w ${paths.base()}. Wgraj tam eksport ze Stravy.`);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(content, { skip_empty_lines: true, relax_quotes: true });
  const [, ...dataRows] = rows;

  const db = readDb();
  const existing = new Map(db.activities.map((a) => [a.id, a]));

  let added = 0, updated = 0, skipped = 0;

  for (const row of dataRows) {
    const activity = rowToActivity(row);
    if (!activity.id) { skipped++; continue; }
    const prev = existing.get(activity.id);
    if (!prev) {
      existing.set(activity.id, activity);
      added++;
    } else {
      // Zachowaj stan wysyłki; resztę odśwież z CSV.
      existing.set(activity.id, {
        ...activity,
        submitted: prev.submitted,
        submittedAt: prev.submittedAt,
        submitError: prev.submitError,
      });
      updated++;
    }
  }

  db.activities = [...existing.values()].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
  db.importedAt = new Date().toISOString();
  writeDb(db);

  const submitted = db.activities.filter((a) => a.submitted).length;
  const pending = db.activities.length - submitted;
  const types = [...new Set(db.activities.map((a) => a.type))].sort();

  log(`Zaimportowano ${dataRows.length} wierszy z CSV`);
  log(`  nowe:        ${added}`);
  log(`  odświeżone:  ${updated}`);
  log(`  pominięte:   ${skipped}`);
  log(`Baza: ${db.activities.length} aktywności (${submitted} wysłanych, ${pending} oczekujących)`);
  log(`Typy: ${types.join(', ')}`);

  return { rows: dataRows.length, added, updated, skipped, total: db.activities.length, submitted, pending };
}

module.exports = { importCsv };

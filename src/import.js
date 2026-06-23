import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { JSONFilePreset } from 'lowdb/node';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

const CSV_PATH = new URL('../activities.csv', import.meta.url);
const DB_PATH = new URL('../db.json', import.meta.url).pathname;
const DATE_FORMAT = 'MMM D, YYYY, h:mm:ss A';

// Column indices in activities.csv. The header has several duplicate names
// (Elapsed Time, Distance, Max Heart Rate, Commute) — Strava puts a short
// summary block first and a detailed block second. We pick the most useful one
// from each pair (detailed block, since it has Moving Time + meters + m/s).
const COL = {
  id: 0,
  date: 1,
  name: 2,
  type: 3,
  description: 4,
  gear: 11,
  filename: 12,
  elapsedTimeSec: 15,
  movingTimeSec: 16,
  distanceM: 17,
  maxSpeedMs: 18,
  avgSpeedMs: 19,
  elevationGainM: 20,
  elevationLossM: 21,
  avgCadence: 29,
  maxHr: 30,
  avgHr: 31,
  maxWatts: 32,
  avgWatts: 33,
  calories: 34,
  commute: 9,
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

async function main() {
  const content = readFileSync(CSV_PATH, 'utf8');
  const rows = parse(content, {
    skip_empty_lines: true,
    relax_quotes: true,
  });
  const [, ...dataRows] = rows;

  const db = await JSONFilePreset(DB_PATH, { activities: [], importedAt: null });
  const existing = new Map(db.data.activities.map((a) => [a.id, a]));

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const seen = new Set();

  for (const row of dataRows) {
    const activity = rowToActivity(row);
    if (!activity.id) {
      skipped++;
      continue;
    }
    seen.add(activity.id);
    const prev = existing.get(activity.id);
    if (!prev) {
      existing.set(activity.id, activity);
      added++;
    } else {
      // Preserve submission state; refresh everything else from CSV.
      existing.set(activity.id, {
        ...activity,
        submitted: prev.submitted,
        submittedAt: prev.submittedAt,
        submitError: prev.submitError,
      });
      updated++;
    }
  }

  db.data.activities = [...existing.values()].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
  db.data.importedAt = new Date().toISOString();
  await db.write();

  const submittedCount = db.data.activities.filter((a) => a.submitted).length;
  const pending = db.data.activities.length - submittedCount;
  const types = [...new Set(db.data.activities.map((a) => a.type))].sort();

  console.log(`Imported ${dataRows.length} rows from CSV`);
  console.log(`  added:   ${added}`);
  console.log(`  updated: ${updated}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`DB now has ${db.data.activities.length} activities (${submittedCount} submitted, ${pending} pending)`);
  console.log(`Activity types: ${types.join(', ')}`);
  console.log(`DB written to: ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

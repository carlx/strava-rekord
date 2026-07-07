// Port src/import.js jako funkcja zwracająca podsumowanie i logująca przez callback.
const fs = require('node:fs');
const { parse } = require('csv-parse/sync');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
require('dayjs/locale/pl');
require('dayjs/locale/de');
const { paths } = require('./paths');
const { readDb, writeDb } = require('./db');
const { mergeTypeMappingDefaults } = require('./config');

dayjs.extend(customParseFormat);

// Strava formatuje datę inaczej w zależności od języka konta — nie tylko
// nazwę miesiąca, ale też kolejność dzień/miesiąc i zegar 12h/24h. Próbujemy
// po kolei, pierwszy dopasowany wygrywa.
// EN i PL zweryfikowane na prawdziwych eksportach; DE to best-effort zgadywanka
// (brak próbki niemieckiego eksportu) — do poprawienia, gdyby się nie zgadzało.
const DATE_FORMATS = [
  { format: 'MMM D, YYYY, h:mm:ss A', locale: 'en' }, // "Jun 22, 2026, 3:04:12 PM"
  { format: 'D MMM YYYY, HH:mm:ss', locale: 'pl' },   // "2 lip 2026, 16:00:47"
  { format: 'D. MMM YYYY, HH:mm:ss', locale: 'de' },  // "2. Jul 2026, 16:00:47" (niezweryfikowane)
];

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
  for (const { format, locale } of DATE_FORMATS) {
    const d = dayjs(raw, format, locale, true);
    if (d.isValid()) return d.format('YYYY-MM-DDTHH:mm:ss');
  }
  return null;
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

// Pierwsze 4 kolumny eksportu ze Stravy w obsługiwanych językach — wystarczają,
// żeby odróżnić właściwy plik od przypadkowego innego CSV (reszta nagłówka ma
// duplikaty nazw kolumn, patrz COL powyżej, więc nie da się prosto zweryfikować
// całości po nazwach). PL zweryfikowane na prawdziwym eksporcie; DE to
// best-effort zgadywanka (brak próbki) — do poprawienia, gdyby się nie zgadzało.
const HEADER_VARIANTS = [
  { lang: 'en', header: ['Activity ID', 'Activity Date', 'Activity Name', 'Activity Type'] },
  { lang: 'pl', header: ['Identyfikator aktywności', 'Data aktywności', 'Nazwa aktywności', 'Rodzaj aktywności'] },
  { lang: 'de', header: ['Aktivitäts-ID', 'Datum der Aktivität', 'Name der Aktivität', 'Aktivitätstyp'] },
];

function detectHeaderLanguage(header) {
  const match = HEADER_VARIANTS.find(
    (v) => header && v.header.every((name, i) => header[i] === name)
  );
  return match ? match.lang : null;
}

// Domyślne mapowanie Strava-typ -> opcja formularza per wykryty język
// nagłówka, dopisywane do config.json tylko przy zupełnie pierwszym imporcie
// (patrz importCsv niżej). "en" potwierdzone od lat (= DEFAULT_CONFIG w
// config.js); "pl" Jazda/Spacer potwierdzone na realnym eksporcie, Bieganie
// to rozsądne ale niezweryfikowane domniemanie; "de" to best-effort
// zgadywanka (brak próbki) — celowo bez Hike/TrailRun dla PL/DE, żeby
// błędny domysł nie podstawił cicho złej kategorii (lepiej żeby taki typ
// trafił do sygnału "niezmapowane" w GUI).
const DEFAULT_TYPE_MAPPING_BY_LANG = {
  en: { Ride: 'Jazda na rowerze', Walk: 'Spacery/wędrówki górskie', Hike: 'Spacery/wędrówki górskie', Run: 'Bieganie', TrailRun: 'Bieganie' },
  pl: { Jazda: 'Jazda na rowerze', Spacer: 'Spacery/wędrówki górskie', Bieganie: 'Bieganie' },
  de: { Radfahren: 'Jazda na rowerze', Wandern: 'Spacery/wędrówki górskie', Laufen: 'Bieganie' },
};

function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, bytes).split(/\r?\n/, 1)[0] ?? '';
  } finally {
    fs.closeSync(fd);
  }
}

// Rzuca, jeśli plik nie wygląda na eksport activities.csv ze Stravy —
// wołane przed skopiowaniem wybranego pliku do katalogu aplikacji.
function assertValidActivitiesCsv(filePath) {
  const firstLine = readFirstLine(filePath);
  let header;
  try {
    [header] = parse(firstLine, { relax_quotes: true });
  } catch (e) {
    throw new Error(`To nie jest poprawny plik CSV: ${e.message}`);
  }
  const ok = detectHeaderLanguage(header) !== null;
  if (!ok) {
    throw new Error(
      'To nie wygląda na eksport CSV ze Stravy (obsługiwane języki: PL, EN, DE; ' +
      'brak oczekiwanych kolumn na początku pliku).'
    );
  }
}

async function importCsv(log = () => {}) {
  const csvPath = paths.csv();
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Brak activities.csv w ${paths.base()}. Wgraj tam eksport ze Stravy.`);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(content, { skip_empty_lines: true, relax_quotes: true });
  const [header, ...dataRows] = rows;

  const db = readDb();

  // Zupełnie pierwszy import (pusta baza) — dopełnij domyślne mapowanie dla
  // wykrytego języka pliku, nie nadpisując niczego (mergeTypeMappingDefaults
  // jest addytywne). Kolejne importy, nawet w innym języku, tego nie ruszają.
  if (db.activities.length === 0) {
    const lang = detectHeaderLanguage(header);
    if (lang && lang !== 'en' && DEFAULT_TYPE_MAPPING_BY_LANG[lang]) {
      mergeTypeMappingDefaults(DEFAULT_TYPE_MAPPING_BY_LANG[lang]);
    }
  }

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

module.exports = { importCsv, assertValidActivitiesCsv };

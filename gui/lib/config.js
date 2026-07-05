const fs = require('node:fs');
const { paths } = require('./paths');

// Domyślne wartości, z których korzysta config.json tworzony automatycznie
// przy pierwszym uruchomieniu — i którymi domergowujemy braki w ręcznie
// edytowanym pliku. Wartości identyczne jak w (CLI-owym) config.example.json.
const DEFAULT_CONFIG = {
  timeSource: 'moving',
  skipTypes: ['Swim'],
  typeMapping: {
    Ride: 'Jazda na rowerze',
    Walk: 'Spacery/wędrówki górskie',
    Hike: 'Spacery/wędrówki górskie',
    Run: 'Bieganie',
    TrailRun: 'Bieganie',
  },
};

function createDefaultConfig() {
  const cfg = {
    ...DEFAULT_CONFIG,
    formUrl: '',
    displayName: '',
    dateFrom: '2026-06-22',
    dateTo: '2026-09-21',
  };
  fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

// Wczytuje config.json, tworząc go automatycznie z defaultami przy braku
// pliku. Nie rzuca dla brakującego/pustego formUrl/displayName — to, czy
// config jest "kompletny" do importu/wysyłki, sprawdza requireReady().
function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(paths.config(), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return createDefaultConfig();
    throw e;
  }
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

function requireReady(cfg) {
  if (!cfg.formUrl) throw new Error('Uzupełnij link do formularza w panelu Ustawienia.');
  if (!cfg.displayName) throw new Error('Uzupełnij imię i nazwisko w panelu Ustawienia.');
  return cfg;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nadpisuje tylko formUrl/displayName/dateFrom/dateTo w config.json, resztę
// (timeSource/skipTypes/typeMapping) zostawia nietkniętą.
function updateSettings({ formUrl, displayName, dateFrom, dateTo }) {
  if (!formUrl || !formUrl.startsWith('https://')) {
    throw new Error('Link do formularza musi zaczynać się od "https://".');
  }
  if (!displayName) {
    throw new Error('Podaj imię i nazwisko.');
  }
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    throw new Error('Daty muszą być w formacie YYYY-MM-DD.');
  }
  if (dateFrom > dateTo) {
    throw new Error('Data "od" jest późniejsza niż "do".');
  }
  const cfg = loadConfig();
  cfg.formUrl = formUrl;
  cfg.displayName = displayName;
  cfg.dateFrom = dateFrom;
  cfg.dateTo = dateTo;
  fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2) + '\n');
  return { formUrl: cfg.formUrl, displayName: cfg.displayName, from: cfg.dateFrom, to: cfg.dateTo };
}

module.exports = { loadConfig, updateSettings, requireReady };

const fs = require('node:fs');
const { paths } = require('./paths');

function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(paths.config(), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(
        `Brak config.json w ${paths.base()}. Skopiuj config.example.json → config.json i uzupełnij.`
      );
    }
    throw e;
  }
  const cfg = JSON.parse(raw);
  if (!cfg.formUrl) throw new Error('config.json: brak pola "formUrl".');
  if (!cfg.displayName) throw new Error('config.json: brak pola "displayName".');
  if (!cfg.typeMapping) throw new Error('config.json: brak pola "typeMapping".');
  return cfg;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nadpisuje tylko dateFrom/dateTo w config.json, resztę pól zostawia.
function updateDateRange({ dateFrom, dateTo }) {
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    throw new Error('Daty muszą być w formacie YYYY-MM-DD.');
  }
  if (dateFrom > dateTo) {
    throw new Error('Data "od" jest późniejsza niż "do".');
  }
  const cfg = loadConfig();
  cfg.dateFrom = dateFrom;
  cfg.dateTo = dateTo;
  fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2) + '\n');
  return { from: cfg.dateFrom, to: cfg.dateTo };
}

module.exports = { loadConfig, updateDateRange };

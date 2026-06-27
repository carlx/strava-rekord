// Prosty odczyt/zapis db.json przez fs (bez lowdb — lowdb v7 jest ESM-only,
// a tu trzymamy proces główny w CommonJS dla gładkiego pakowania).
const fs = require('node:fs');
const { paths } = require('./paths');

function readDb() {
  try {
    const data = JSON.parse(fs.readFileSync(paths.db(), 'utf8'));
    if (!Array.isArray(data.activities)) data.activities = [];
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return { activities: [], importedAt: null };
    throw e;
  }
}

function writeDb(data) {
  fs.writeFileSync(paths.db(), JSON.stringify(data, null, 2));
}

module.exports = { readDb, writeDb };

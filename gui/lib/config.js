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

module.exports = { loadConfig };

// Wszystkie pliki robocze (config, baza, CSV, screenshoty, profil Chrome)
// żyją w "katalogu aplikacji":
//   - wersja spakowana: katalog, w którym leży plik wykonywalny (obok .exe)
//   - tryb deweloperski: katalog główny projektu (gdzie już są te pliki)
const path = require('node:path');
const { app } = require('electron');

function appDir() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  // gui/lib -> gui -> katalog główny projektu
  return path.resolve(__dirname, '..', '..');
}

const paths = {
  base: appDir,
  config: () => path.join(appDir(), 'config.json'),
  configExample: () => path.join(appDir(), 'config.example.json'),
  db: () => path.join(appDir(), 'db.json'),
  csv: () => path.join(appDir(), 'activities.csv'),
  screenshots: () => path.join(appDir(), 'screenshots'),
  profile: () => path.join(appDir(), '.chrome-profile'),
};

module.exports = { paths, appDir };

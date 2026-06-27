// Port src/login.js — otwiera widoczne okno systemowego Chrome, user loguje się
// ręcznie do Google, sesja zapisuje się w trwałym profilu (katalog aplikacji).
const { launchChrome } = require('./chrome');
const { loadConfig } = require('./config');
const { paths } = require('./paths');

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

async function login(log = () => {}) {
  const config = loadConfig();
  log('Otwieram Twój systemowy Chrome (profil trwały)…');

  const ctx = await launchChrome({ headless: false });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    log('Zaloguj się do Google w otwartym oknie. 2FA działa normalnie.');
    log('Okno zamknie się samo, gdy formularz będzie widoczny.');

    await page.goto(config.formUrl, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(
        () => location.href.includes('/viewform') && typeof FB_PUBLIC_LOAD_DATA_ !== 'undefined',
        null,
        { timeout: LOGIN_TIMEOUT_MS, polling: 1000 }
      );
    } catch (e) {
      throw new Error(`Przekroczono czas logowania. Bieżący URL: ${page.url()}`);
    }

    log(`Logowanie OK. Profil zapisany w ${paths.profile()}`);
  } finally {
    await ctx.close();
  }
}

module.exports = { login };

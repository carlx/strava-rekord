// Uruchomienie SYSTEMOWEGO Google Chrome przez playwright-core (channel: 'chrome').
// To jedyny wariant przechodzący blokadę logowania Google — dlatego program
// wymaga zainstalowanego Chrome (nie pakujemy przeglądarki do binarki).
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const { paths } = require('./paths');

async function launchChrome({ headless }) {
  fs.mkdirSync(paths.profile(), { recursive: true });
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(paths.profile(), {
      headless,
      channel: 'chrome',
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (e) {
    if (/executable doesn't exist|chrome|Chromium distribution|channel/i.test(e.message)) {
      throw new Error(
        'Nie znaleziono Google Chrome na tym komputerze. Zainstaluj Chrome — program używa Twojego systemowego Chrome.'
      );
    }
    throw e;
  }
  // Usuń najbardziej oczywisty znacznik automatyzacji, zanim ruszą skrypty strony.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return ctx;
}

module.exports = { launchChrome };

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdTv9Lc7Xu2z6qgXWzztietxEDpVdXBhivj0tWHL3ff6jvlCg/viewform';
const PROFILE_DIR = new URL('../.chrome-profile', import.meta.url).pathname;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

async function main() {
  mkdirSync(PROFILE_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // Strip the most obvious automation tells before any page script runs.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());

  console.log('\n>>> Opening the form in a real Chrome window (persistent profile).');
  console.log('>>> Sign in with your Google account. 2FA works normally.');
  console.log('>>> The script will close automatically once the form is visible.\n');

  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForFunction(
      () =>
        location.href.includes('/viewform') &&
        typeof FB_PUBLIC_LOAD_DATA_ !== 'undefined',
      null,
      { timeout: LOGIN_TIMEOUT_MS, polling: 1000 }
    );
  } catch (err) {
    console.error('\nTimed out waiting for the form to load.');
    console.error('Current URL:', page.url());
    await ctx.close();
    process.exit(1);
  }

  console.log(`\nLogin OK. Profile saved at ${PROFILE_DIR}`);
  console.log('Next: node src/inspectForm.js');
  await ctx.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

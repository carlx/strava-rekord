import { chromium } from 'playwright';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdTv9Lc7Xu2z6qgXWzztietxEDpVdXBhivj0tWHL3ff6jvlCg/viewform';
const PROFILE_DIR = new URL('../.chrome-profile', import.meta.url).pathname;

const TYPE_NAMES = {
  0: 'SHORT_ANSWER',
  1: 'PARAGRAPH',
  2: 'MULTIPLE_CHOICE',
  3: 'DROPDOWN',
  4: 'CHECKBOXES',
  5: 'LINEAR_SCALE',
  6: 'TITLE',
  7: 'GRID',
  8: 'SECTION',
  9: 'DATE',
  10: 'TIME',
  13: 'FILE_UPLOAD',
};

async function main() {
  if (!existsSync(PROFILE_DIR)) {
    console.error('No .chrome-profile/ found — run `node src/login.js` first.');
    process.exit(1);
  }
  mkdirSync(PROFILE_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const resp = await page.goto(FORM_URL, { waitUntil: 'networkidle' });

  console.log('HTTP status:    ', resp?.status());
  console.log('Final URL:      ', page.url());
  console.log('Title:          ', await page.title());

  const probe = await page.evaluate(() => ({
    hasFB: typeof FB_PUBLIC_LOAD_DATA_ !== 'undefined',
    bodyTextSnippet: document.body.innerText.slice(0, 400),
  }));
  console.log('Has FB data:    ', probe.hasFB);
  console.log('Body snippet:   ', probe.bodyTextSnippet.replace(/\n/g, ' | '));

  if (!probe.hasFB) {
    writeFileSync(new URL('../form-page.html', import.meta.url).pathname, await page.content());
    console.log('\nSaved HTML to form-page.html. Likely the session expired — rerun login.js.');
    await ctx.close();
    process.exit(1);
  }

  const data = await page.evaluate(() => FB_PUBLIC_LOAD_DATA_);
  writeFileSync(new URL('../form-raw.json', import.meta.url).pathname, JSON.stringify(data, null, 2));

  const formMeta = data[1] ?? [];
  const description = formMeta[0] ?? null;
  const fields = formMeta[1] ?? [];
  const title = data[3] ?? null;

  console.log('\n=== FORM ===');
  console.log('Title:      ', title);
  console.log('Description:', description);
  console.log('Field count:', fields.length);
  console.log();

  const summary = [];
  for (const f of fields) {
    const label = f[1];
    const helpText = f[2];
    const typeId = f[3];
    const typeName = TYPE_NAMES[typeId] ?? `UNKNOWN(${typeId})`;
    const specs = f[4] ?? [];
    const spec0 = specs[0] ?? [];
    const entryId = spec0[0] ?? null;
    const rawOptions = spec0[1] ?? null;
    const requiredFlag = spec0[2];
    const required = requiredFlag === 1 || requiredFlag === true;
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((o) => (Array.isArray(o) ? o[0] : o))
      : null;

    summary.push({
      label,
      typeId,
      typeName,
      required,
      entryId: entryId ? `entry.${entryId}` : null,
      helpText: helpText || null,
      options,
    });
  }

  for (let i = 0; i < summary.length; i++) {
    const s = summary[i];
    console.log(`${i + 1}. [${s.typeName}${s.required ? ' *required' : ''}] ${s.label || '(no label)'}`);
    if (s.entryId) console.log(`   field name: ${s.entryId}`);
    if (s.helpText) console.log(`   help: ${s.helpText}`);
    if (s.options?.length) console.log(`   options: ${s.options.join(' | ')}`);
  }

  writeFileSync(
    new URL('../form-fields.json', import.meta.url).pathname,
    JSON.stringify({ title, description, fields: summary }, null, 2)
  );

  console.log('\nRaw payload saved to form-raw.json');
  console.log('Summary saved to form-fields.json');

  await ctx.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

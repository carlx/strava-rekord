import { chromium } from 'playwright';
import { JSONFilePreset } from 'lowdb/node';
import { existsSync, mkdirSync } from 'node:fs';
import {
  FORM_URL,
  buildPayload,
  fillForm,
  isEligible,
  ineligibleReason,
} from './formMapping.js';

const PROFILE_DIR = new URL('../.chrome-profile', import.meta.url).pathname;
const DB_PATH = new URL('../db.json', import.meta.url).pathname;
const SHOTS_DIR = new URL('../screenshots', import.meta.url).pathname;

function parseArgs(argv) {
  const args = { submit: false, headed: false, limit: Infinity, screenshot: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--submit') args.submit = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--screenshot') args.screenshot = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node src/submit.js [flags]
  --submit       Actually click "Prześlij" (default: dry-run, fills only).
                 In submit mode, {id}-filled.png and {id}-confirm.png are
                 always saved to ./screenshots/ as an audit trail.
  --headed       Run with a visible browser window.
  --screenshot   In dry-run, save {id}-filled.png to ./screenshots/.
                 (Ignored in submit mode — shots are always saved there.)
  --limit N      Process at most N activities.`);
      process.exit(0);
    }
  }
  return args;
}

async function processOne(ctx, activity, args) {
  const page = await ctx.newPage();
  try {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof FB_PUBLIC_LOAD_DATA_ !== 'undefined',
      null,
      { timeout: 30000 }
    );

    const payload = buildPayload(activity);
    await fillForm(page, payload);

    // In live submit mode we always save both shots as an audit trail.
    // In dry-run we honour --screenshot.
    const shouldShoot = args.submit || args.screenshot;
    if (shouldShoot) {
      mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({
        path: `${SHOTS_DIR}/${activity.id}-filled.png`,
        fullPage: true,
      });
    }

    if (!args.submit) {
      if (args.headed) await page.waitForTimeout(2500);
      return { ok: true, dryRun: true };
    }

    await page.getByRole('button', { name: 'Prześlij' }).click();
    await page.waitForURL(/\/formResponse/, { timeout: 30000 });
    // Let the confirmation page settle before snapping it.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${SHOTS_DIR}/${activity.id}-confirm.png`,
      fullPage: true,
    });
    return { ok: true, dryRun: false };
  } finally {
    await page.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(PROFILE_DIR)) {
    console.error('No .chrome-profile/ — run `node src/login.js` first.');
    process.exit(1);
  }

  const db = await JSONFilePreset(DB_PATH, { activities: [] });
  const all = db.data.activities;
  const eligible = all.filter(isEligible);
  const todo = eligible.slice(0, args.limit);

  const skipped = all
    .filter((a) => !a.submitted)
    .map((a) => ineligibleReason(a))
    .filter(Boolean);
  // Bucket the per-row reasons into categories so the summary is one line each.
  const buckets = new Map();
  for (const r of skipped) {
    const key = r.startsWith('out of date range') ? 'out of date range' : r;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  console.log(`Total in DB:          ${all.length}`);
  console.log(`Already submitted:    ${all.filter(a => a.submitted).length}`);
  console.log(`Eligible to submit:   ${eligible.length}`);
  console.log(`Will process now:     ${todo.length}`);
  console.log(`Mode:                 ${args.submit ? 'LIVE SUBMIT' : 'DRY-RUN'} | headed=${args.headed} | screenshots=${args.screenshot}`);
  if (buckets.size) {
    console.log('Skipped (not eligible):');
    for (const [r, n] of buckets) console.log(`  ${String(n).padStart(4)}  ${r}`);
  }
  console.log();

  if (!todo.length) return;

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !args.headed,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    for (let i = 0; i < todo.length; i++) {
      const a = todo[i];
      const head = `[${i + 1}/${todo.length}] ${a.id}  ${a.date?.slice(0, 10)}  ${a.type}  ${a.name}`;
      console.log(head);
      const payload = buildPayload(a);
      console.log(`  -> ${payload.activityType} | ${payload.duration} | ${payload.distance} km | ${payload.link}`);

      try {
        const res = await processOne(ctx, a, args);
        if (res.ok && !res.dryRun) {
          a.submitted = true;
          a.submittedAt = new Date().toISOString();
          a.submitError = null;
          await db.write();
          console.log('  OK submitted');
        } else if (res.ok) {
          console.log('  [DRY-RUN] form filled, not submitted');
        }
      } catch (err) {
        a.submitError = err.message;
        await db.write();
        console.log(`  FAIL: ${err.message}`);
      }
    }
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

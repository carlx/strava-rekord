// Port src/submit.js — pełna automatyzacja (z klikaniem "Prześlij") sterowana
// systemowym Chrome. Screenshoty trafiają do katalogu aplikacji.
const fs = require('node:fs');
const { launchChrome } = require('./chrome');
const { loadConfig } = require('./config');
const { paths } = require('./paths');
const { readDb, writeDb } = require('./db');
const { buildPayload, fillForm, isEligible, ineligibleReason } = require('./mapping');

async function processOne(ctx, activity, config, opts) {
  const page = await ctx.newPage();
  try {
    await page.goto(config.formUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof FB_PUBLIC_LOAD_DATA_ !== 'undefined',
      null,
      { timeout: 30000 }
    );

    const payload = buildPayload(activity, config);
    await fillForm(page, payload);

    // W trybie live zawsze zapisujemy oba screeny (audit). W dry-run honorujemy opcję.
    if (opts.live || opts.screenshot) {
      fs.mkdirSync(paths.screenshots(), { recursive: true });
      await page.screenshot({
        path: `${paths.screenshots()}/${activity.id}-filled.png`,
        fullPage: true,
      });
    }

    if (!opts.live) {
      return { ok: true, dryRun: true };
    }

    await page.getByRole('button', { name: 'Prześlij' }).click();
    await page.waitForURL(/\/formResponse/, { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${paths.screenshots()}/${activity.id}-confirm.png`,
      fullPage: true,
    });
    return { ok: true, dryRun: false };
  } finally {
    await page.close();
  }
}

async function submit(opts, log = () => {}, shouldCancel = () => false) {
  const config = loadConfig();
  if (!fs.existsSync(paths.profile())) {
    throw new Error('Brak zapisanej sesji — najpierw kliknij „Zaloguj do Google”.');
  }

  const db = readDb();
  const all = db.activities;
  const eligible = all.filter((a) => isEligible(a, config));
  const limit = Number.isFinite(opts.limit) ? opts.limit : Infinity;
  const todo = eligible.slice(0, limit);

  // Podsumowanie powodów pominięcia.
  const buckets = new Map();
  for (const a of all) {
    if (a.submitted) continue;
    const r = ineligibleReason(a, config);
    if (!r) continue;
    const key = r.startsWith('out of date range') ? 'out of date range' : r;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  log(`W bazie:           ${all.length}`);
  log(`Już wysłane:       ${all.filter((a) => a.submitted).length}`);
  log(`Kwalifikujące się: ${eligible.length}`);
  log(`Przetworzę teraz:  ${todo.length}`);
  log(`Tryb:              ${opts.live ? 'WYSYŁKA LIVE' : 'DRY-RUN'} | okno=${opts.headed ? 'widoczne' : 'ukryte'}`);
  if (buckets.size) {
    log('Pominięte:');
    for (const [r, n] of buckets) log(`  ${String(n).padStart(4)}  ${r}`);
  }

  if (!todo.length) {
    log('Nic do wysłania.');
    return { processed: 0, ok: 0, fail: 0 };
  }

  const ctx = await launchChrome({ headless: !opts.headed });
  let ok = 0, fail = 0, processed = 0;
  try {
    for (let i = 0; i < todo.length; i++) {
      if (shouldCancel()) {
        log('⏹ Przerwano przez użytkownika.');
        break;
      }
      const a = todo[i];
      processed++;
      log(`[${i + 1}/${todo.length}] ${a.id}  ${a.date?.slice(0, 10)}  ${a.type}  ${a.name}`);
      const payload = buildPayload(a, config);
      log(`   -> ${payload.activityType} | ${payload.duration} | ${payload.distance} km`);

      try {
        const res = await processOne(ctx, a, config, opts);
        if (res.ok && !res.dryRun) {
          a.submitted = true;
          a.submittedAt = new Date().toISOString();
          a.submitError = null;
          writeDb(db);
          ok++;
          log('   ✅ wysłano');
        } else {
          ok++;
          log('   [dry-run] wypełniono, nie wysłano');
        }
      } catch (err) {
        a.submitError = err.message;
        writeDb(db);
        fail++;
        log(`   ❌ ${err.message}`);
      }
    }
  } finally {
    await ctx.close();
  }

  log(`Gotowe. OK: ${ok}, błędy: ${fail}.`);
  return { processed, ok, fail };
}

module.exports = { submit };

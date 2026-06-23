import { JSONFilePreset } from 'lowdb/node';
import { CONFIG, isInDateRange } from './formMapping.js';

const DB_PATH = new URL('../db.json', import.meta.url).pathname;

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDuration(s) {
  if (s == null) return '   --   ';
  const sec = Math.max(0, Math.round(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(sec % 60)}`;
}

function row(a) {
  const date = a.date?.slice(0, 10) ?? '??????????';
  const type = (a.type ?? '').padEnd(5);
  const dur = formatDuration(a.movingTimeSec);
  const dist = a.distanceKm != null ? `${a.distanceKm.toFixed(2)} km`.padStart(10) : '       --';
  const sent = a.submittedAt ? `  sent ${a.submittedAt}` : '';
  return `  ${date}  ${type}  ${dur}  ${dist}  ${a.id}  ${a.name}${sent}`;
}

async function main() {
  const db = await JSONFilePreset(DB_PATH, { activities: [] });
  const inRange = db.data.activities.filter(isInDateRange);
  const submitted = inRange.filter((a) => a.submitted);
  const pending = inRange.filter((a) => !a.submitted);

  console.log(`Config range: ${CONFIG.dateFrom} .. ${CONFIG.dateTo}`);
  console.log(`In range:     ${inRange.length}  (submitted: ${submitted.length}, pending: ${pending.length})`);
  console.log();

  console.log(`=== Submitted in range (${submitted.length}) ===`);
  if (!submitted.length) {
    console.log('  (none yet)');
  } else {
    for (const a of submitted) console.log(row(a));
  }
  console.log();

  console.log(`=== Pending in range (${pending.length}) ===`);
  if (!pending.length) {
    console.log('  (nothing to send)');
  } else {
    for (const a of pending) console.log(row(a));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

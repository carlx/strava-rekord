import { readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync(new URL('../config.json', import.meta.url), 'utf8')
);

export const FORM_URL = config.formUrl;
export const CONFIG = config;

// Short, unique prefixes — used to match the question's `div[role="listitem"]`
// container via `hasText`. Full labels include hints like "(np. 01:20:00)"
// which would also match other text on the page; prefixes are safer.
const LABELS = {
  name: 'Imię i nazwisko',
  date: 'Data aktywności',
  activityType: 'Rodzaj aktywności',
  duration: 'Czas trwania aktywności',
  distance: 'Ilość kilometrów',
  link: 'Link do zarejestrowanej aktywności',
  description: 'Dodatkowy opis',
};

function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

export function formatDuration(seconds) {
  if (seconds == null) return '00:00:00';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s % 60)}`;
}

// Form expects "km,m" e.g. "5,653" = 5 km 653 m. Use raw meters from CSV
// (raw column 17) for full precision; fall back to distanceKm * 1000.
export function formatDistance(activity) {
  let meters = Number(activity.raw?.[17]);
  if (!Number.isFinite(meters)) {
    meters = Math.round((activity.distanceKm ?? 0) * 1000);
  }
  const total = Math.round(meters);
  const km = Math.floor(total / 1000);
  const m = total % 1000;
  return `${km},${pad3(m)}`;
}

export function stravaUrl(activity) {
  return `https://www.strava.com/activities/${activity.id}`;
}

export function mapType(stravaType) {
  return config.typeMapping[stravaType] ?? null;
}

export function buildPayload(activity) {
  const seconds = config.timeSource === 'elapsed'
    ? activity.elapsedTimeSec
    : activity.movingTimeSec;
  return {
    name: config.displayName,
    date: activity.date?.slice(0, 10),
    activityType: mapType(activity.type),
    duration: formatDuration(seconds),
    distance: formatDistance(activity),
    link: stravaUrl(activity),
    description: activity.description || '',
  };
}

export function isInDateRange(activity) {
  if (!activity.date) return false;
  const d = activity.date.slice(0, 10);
  return d >= config.dateFrom && d <= config.dateTo;
}

export function ineligibleReason(activity) {
  if (activity.submitted) return 'already submitted';
  if (config.skipTypes?.includes(activity.type)) return `skip type: ${activity.type}`;
  if (!mapType(activity.type)) return `no mapping for type: ${activity.type}`;
  if (!isInDateRange(activity)) return `out of date range (${activity.date?.slice(0, 10) ?? '?'})`;
  return null;
}

export function isEligible(activity) {
  return ineligibleReason(activity) === null;
}

// Google Forms doesn't render real <label> elements — it wraps each question
// in a div[role="listitem"] with the question heading inside. We locate by
// listitem-containing-heading and reach into the input/textbox inside it.
function questionBox(page, headingText) {
  return page
    .locator('div[role="listitem"]')
    .filter({ hasText: headingText })
    .first();
}

export async function fillForm(page, payload) {
  await questionBox(page, LABELS.name).getByRole('textbox').fill(payload.name);

  // Date input is type=date — .fill() accepts ISO YYYY-MM-DD regardless of locale display.
  await questionBox(page, LABELS.date).locator('input').fill(payload.date);

  await page.getByRole('radio', { name: payload.activityType, exact: true }).click();

  await questionBox(page, LABELS.duration).getByRole('textbox').fill(payload.duration);
  await questionBox(page, LABELS.distance).getByRole('textbox').fill(payload.distance);
  await questionBox(page, LABELS.link).getByRole('textbox').fill(payload.link);

  if (payload.description) {
    await questionBox(page, LABELS.description).getByRole('textbox').fill(payload.description);
  }
}

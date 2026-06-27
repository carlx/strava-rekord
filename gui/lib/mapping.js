// Port src/formMapping.js — ta sama logika, ale config przekazujemy parametrem
// zamiast czytać go na poziomie modułu.

// Krótkie, unikalne prefiksy nagłówków pytań — używane do dopasowania
// kontenera div[role="listitem"] przez hasText.
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

function formatDuration(seconds) {
  if (seconds == null) return '00:00:00';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s % 60)}`;
}

// Formularz oczekuje "km,m" np. "5,653". Bierzemy surowe metry z CSV
// (kolumna 17) dla pełnej precyzji; fallback na distanceKm * 1000.
function formatDistance(activity) {
  let meters = Number(activity.raw?.[17]);
  if (!Number.isFinite(meters)) {
    meters = Math.round((activity.distanceKm ?? 0) * 1000);
  }
  const total = Math.round(meters);
  const km = Math.floor(total / 1000);
  const m = total % 1000;
  return `${km},${pad3(m)}`;
}

function stravaUrl(activity) {
  return `https://www.strava.com/activities/${activity.id}`;
}

function mapType(stravaType, config) {
  return config.typeMapping[stravaType] ?? null;
}

function buildPayload(activity, config) {
  const seconds = config.timeSource === 'elapsed'
    ? activity.elapsedTimeSec
    : activity.movingTimeSec;
  return {
    name: config.displayName,
    date: activity.date?.slice(0, 10),
    activityType: mapType(activity.type, config),
    duration: formatDuration(seconds),
    distance: formatDistance(activity),
    link: stravaUrl(activity),
    description: activity.description || '',
  };
}

function isInDateRange(activity, config) {
  if (!activity.date) return false;
  const d = activity.date.slice(0, 10);
  return d >= config.dateFrom && d <= config.dateTo;
}

function ineligibleReason(activity, config) {
  if (activity.submitted) return 'already submitted';
  if (config.skipTypes?.includes(activity.type)) return `skip type: ${activity.type}`;
  if (!mapType(activity.type, config)) return `no mapping for type: ${activity.type}`;
  if (!isInDateRange(activity, config)) return `out of date range (${activity.date?.slice(0, 10) ?? '?'})`;
  return null;
}

function isEligible(activity, config) {
  return ineligibleReason(activity, config) === null;
}

// Google Forms nie renderuje prawdziwych <label> — każde pytanie jest w
// div[role="listitem"] z nagłówkiem w środku. Lokalizujemy po listitem
// zawierającym nagłówek i sięgamy do inputa/textboxa w środku.
function questionBox(page, headingText) {
  return page
    .locator('div[role="listitem"]')
    .filter({ hasText: headingText })
    .first();
}

async function fillForm(page, payload) {
  await questionBox(page, LABELS.name).getByRole('textbox').fill(payload.name);

  // input type=date — .fill() przyjmuje ISO YYYY-MM-DD niezależnie od locale.
  await questionBox(page, LABELS.date).locator('input').fill(payload.date);

  await page.getByRole('radio', { name: payload.activityType, exact: true }).click();

  await questionBox(page, LABELS.duration).getByRole('textbox').fill(payload.duration);
  await questionBox(page, LABELS.distance).getByRole('textbox').fill(payload.distance);
  await questionBox(page, LABELS.link).getByRole('textbox').fill(payload.link);

  if (payload.description) {
    await questionBox(page, LABELS.description).getByRole('textbox').fill(payload.description);
  }
}

module.exports = {
  LABELS,
  formatDuration,
  formatDistance,
  stravaUrl,
  mapType,
  buildPayload,
  isInDateRange,
  ineligibleReason,
  isEligible,
  fillForm,
};

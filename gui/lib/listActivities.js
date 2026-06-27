const { readDb } = require('./db');
const { loadConfig } = require('./config');
const { isInDateRange } = require('./mapping');

function listActivities() {
  const config = loadConfig();
  const db = readDb();
  const inRange = db.activities.filter((a) => isInDateRange(a, config));
  const pick = (a) => ({
    id: a.id,
    date: a.date?.slice(0, 10) ?? '??',
    type: a.type,
    name: a.name,
    distanceKm: a.distanceKm,
    movingTimeSec: a.movingTimeSec,
    submittedAt: a.submittedAt,
  });
  return {
    range: { from: config.dateFrom, to: config.dateTo },
    submitted: inRange.filter((a) => a.submitted).map(pick),
    pending: inRange.filter((a) => !a.submitted).map(pick),
  };
}

module.exports = { listActivities };

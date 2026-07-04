const $ = (id) => document.getElementById(id);
const logEl = $('log');

function logLine(line) {
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  logEl.scrollTop = logEl.scrollHeight;
}

function fmtDur(s) {
  if (s == null) return '--';
  const sec = Math.max(0, Math.round(s));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`;
}

function statItem(k, v, cls = '') {
  return `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
}

async function refreshStatus() {
  const s = await window.api.status();
  $('appdir').textContent = s.base;

  const yn = (b) => (b ? ['tak', 'ok'] : ['nie', 'bad']);
  const cells = [];
  const [cfgTxt, cfgCls] = yn(s.hasConfig);
  cells.push(statItem('Ustawienia', s.configError ? 'błąd' : cfgTxt, s.configError ? 'bad' : cfgCls));
  cells.push(statItem('Plik z aktywnościami', ...wrap(yn(s.hasCsv))));
  cells.push(statItem('Zalogowanie do Google', ...wrap(yn(s.hasProfile))));

  if (s.counts) {
    cells.push(statItem('Wczytane aktywności', s.counts.total));
    cells.push(statItem('Wysłane', s.counts.submitted));
    cells.push(statItem('Do wysłania', s.counts.eligible ?? '—', s.counts.eligible ? 'ok' : ''));
  }
  if (s.range) cells.push(statItem('Zakres dat', `${s.range.from} → ${s.range.to}`));
  if (s.displayName) cells.push(statItem('Imię i nazwisko', s.displayName));

  $('status-grid').innerHTML = cells.join('');

  const setIfIdle = (id, value) => {
    const el = $(id);
    if (document.activeElement !== el) el.value = value ?? '';
  };
  setIfIdle('set-form-url', s.formUrl);
  setIfIdle('set-display-name', s.displayName);
  if (s.range) {
    setIfIdle('set-date-from', s.range.from);
    setIfIdle('set-date-to', s.range.to);
  }
  $('settings-hint').hidden = !s.needsSetup;
  $('settings-panel').classList.toggle('attention', !!s.needsSetup);

  if (s.configError) logOnce('config: ' + s.configError);
}

function wrap([v, cls]) { return [v, cls]; }

let lastConfigErr = '';
function logOnce(msg) {
  if (msg !== lastConfigErr) { lastConfigErr = msg; logLine('⚠ ' + msg); }
}

function setBusy(b) {
  for (const id of ['btn-login', 'btn-logout', 'btn-choose-csv', 'btn-import', 'btn-dry', 'btn-live', 'btn-list', 'refresh', 'save-settings']) {
    $(id).disabled = b;
  }
  $('btn-cancel').disabled = !b;
}

async function renderList() {
  const r = await window.api.list();
  const panel = $('list-panel');
  const tbl = (rows) =>
    rows.length
      ? `<table><thead><tr><th>Data</th><th>Typ</th><th>Dyst.</th><th>Czas</th><th>Nazwa</th><th>Wysłano</th></tr></thead><tbody>${rows
          .map(
            (a) =>
              `<tr><td>${a.date}</td><td>${a.type ?? ''}</td><td>${a.distanceKm != null ? a.distanceKm.toFixed(2) + ' km' : '--'}</td><td>${fmtDur(a.movingTimeSec)}</td><td>${a.name ?? ''}</td><td>${a.submittedAt ? a.submittedAt.slice(0, 16).replace('T', ' ') : ''}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p class="warn">(brak)</p>';

  $('list-content').innerHTML =
    `<p>Zakres ${r.range.from} → ${r.range.to}</p>` +
    `<h3>Do wysłania (${r.pending.length})</h3>${tbl(r.pending)}` +
    `<h3>Wysłane (${r.submitted.length})</h3>${tbl(r.submitted)}`;
  panel.hidden = false;
}

function submitOpts(live) {
  const limitRaw = $('limit').value.trim();
  return {
    live,
    limit: limitRaw ? Number(limitRaw) : Infinity,
    headed: $('headed').checked,
  };
}

// --- podgląd screenshotów (wiersze per aktywność) ---
let shotsMode = 'dry-run';

const KIND_LABEL = { filled: 'Wypełniony formularz', confirm: 'Potwierdzenie wysyłki' };
const BADGE_LABEL = { filled: 'wypełniony', confirm: 'potwierdzony' };

function rowTooltip(row) {
  const lines = [row.name || `(id ${row.id})`, `${row.date ?? '??'} · ${row.type ?? '?'}`];
  if (row.payload) lines.push(`${row.payload.duration} · ${row.payload.distance} km`, row.payload.link);
  return lines.join('\n');
}

async function loadShots() {
  const list = $('shots-list');
  const rows = await window.api.listShots(shotsMode);
  if (!rows.length) {
    list.innerHTML = '<li class="empty">(brak — zrób najpierw Dry-run albo Wyślij (LIVE), appka zapisze zrzuty ekranu)</li>';
    $('shots-preview').innerHTML = '<p class="muted">Wybierz aktywność z listy…</p>';
    return;
  }
  list.innerHTML = rows
    .map((r, i) => {
      const badges = r.shots.map((s) => `<span class="badge">${BADGE_LABEL[s.kind] || s.kind}</span>`).join('');
      const mark = r.submitted ? '<span class="ok">✔</span> ' : '';
      const title = r.name ? esc(r.name) : `<span class="muted">id ${esc(r.id)}</span>`;
      return `<li data-i="${i}"><span class="row-main">${mark}<b>${esc(r.date ?? '??')}</b> · ${esc(r.type ?? '?')} · ${title}</span><span class="row-badges">${badges}</span></li>`;
    })
    .join('');
  [...list.querySelectorAll('li[data-i]')].forEach((li) => {
    const row = rows[Number(li.dataset.i)];
    li.title = rowTooltip(row);
    li.onclick = () => showActivity(row, li);
  });
}

function showActivity(row, li) {
  document.querySelectorAll('#shots-list li').forEach((el) => el.classList.remove('active'));
  li.classList.add('active');
  const preview = $('shots-preview');
  preview.innerHTML = infoCardHtml(row);

  for (const shot of row.shots) {
    const block = document.createElement('div');
    block.className = 'shot-block';

    const head = document.createElement('div');
    head.className = 'shot-block-head';
    head.textContent = (KIND_LABEL[shot.kind] || shot.kind) + ' · ';
    const open = document.createElement('button');
    open.className = 'link';
    open.textContent = 'otwórz w systemie';
    open.onclick = () => window.api.openShot(shot.path);
    head.appendChild(open);

    const img = document.createElement('img');
    img.alt = shot.name;
    window.api.readShot(shot.path).then((url) => { img.src = url; }).catch(() => { img.alt = 'błąd wczytania zrzutu'; });

    block.appendChild(head);
    block.appendChild(img);
    preview.appendChild(block);
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FIELD_LABELS = [
  ['name', 'Imię i nazwisko'],
  ['date', 'Data aktywności'],
  ['activityType', 'Rodzaj aktywności'],
  ['duration', 'Czas trwania'],
  ['distance', 'Ilość kilometrów'],
  ['link', 'Link'],
  ['description', 'Dodatkowy opis'],
];

function infoCardHtml(info) {
  if (!info) return '<div class="shot-info warn">Brak tej aktywności w bazie (db.json).</div>';
  let head = `<div class="shot-info-head">Wprowadzone dane · <code>${esc(info.id)}</code>`;
  if (info.submitted) head += ` · <span class="ok">wysłano ${info.submittedAt ? esc(info.submittedAt.slice(0, 16).replace('T', ' ')) : ''}</span>`;
  if (info.submitError) head += ` · <span class="warn">błąd: ${esc(info.submitError)}</span>`;
  head += '</div>';

  const ctx = (info.date || info.type || info.name)
    ? `<div class="shot-info-ctx">${esc(info.date ?? '??')} · ${esc(info.type ?? '?')}${info.name ? ' · ' + esc(info.name) : ''}</div>`
    : '';

  if (!info.payload) {
    return `<div class="shot-info">${head}${ctx}<p class="warn">Nie można zbudować danych: ${esc(info.configError || 'brak configu')}</p></div>`;
  }
  const rows = FIELD_LABELS.map(([k, label]) => {
    const v = info.payload[k];
    return `<tr><th>${label}</th><td>${v ? esc(v) : '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  return `<div class="shot-info">${head}${ctx}<table>${rows}</table></div>`;
}

function setShotsMode(mode) {
  shotsMode = mode;
  $('shots-dry').classList.toggle('active', mode === 'dry-run');
  $('shots-live').classList.toggle('active', mode === 'live');
  loadShots().catch((e) => logLine('❌ ' + e.message));
}

$('shots-dry').onclick = () => setShotsMode('dry-run');
$('shots-live').onclick = () => setShotsMode('live');
$('shots-refresh').onclick = () => loadShots().catch((e) => logLine('❌ ' + e.message));

// --- wiring ---
$('btn-login').onclick = () => window.api.runLogin();
$('btn-logout').onclick = async () => {
  if (!confirm('Usunąć zapisaną sesję Chrome? Trzeba będzie zalogować się ponownie.')) return;
  try { await window.api.clearSession(); refreshStatus(); }
  catch (e) { logLine('❌ ' + e.message); }
};
$('btn-choose-csv').onclick = async () => {
  try {
    const r = await window.api.chooseCsv();
    if (r) {
      await refreshStatus();
      window.api.runImport();
    }
  } catch (e) { logLine('❌ ' + e.message); }
};
$('btn-import').onclick = () => window.api.runImport();
$('btn-dry').onclick = () => window.api.runSubmit(submitOpts(false));
$('btn-live').onclick = () => {
  const n = $('limit').value.trim() || 'WSZYSTKIE kwalifikujące się';
  if (confirm(`Wysłać na żywo (${n})? Tego nie da się cofnąć.`)) {
    window.api.runSubmit(submitOpts(true));
  }
};
$('btn-cancel').onclick = () => window.api.cancel();
$('btn-list').onclick = () => renderList().catch((e) => logLine('❌ ' + e.message));
$('refresh').onclick = () => refreshStatus();
$('save-settings').onclick = async () => {
  const formUrl = $('set-form-url').value.trim();
  const displayName = $('set-display-name').value.trim();
  const dateFrom = $('set-date-from').value;
  const dateTo = $('set-date-to').value;
  if (!formUrl || !displayName || !dateFrom || !dateTo) {
    logLine('⚠ Uzupełnij wszystkie pola ustawień.');
    return;
  }
  try {
    await window.api.saveSettings({ formUrl, displayName, dateFrom, dateTo });
    await refreshStatus();
    if (!$('list-panel').hidden) renderList().catch(() => {});
  } catch (e) { logLine('❌ ' + e.message); }
};
$('open-dir').onclick = () => window.api.openDir();
$('clear-log').onclick = () => { logEl.textContent = ''; };

window.api.onLog(logLine);
window.api.onBusy(setBusy);
window.api.onDone(() => { logLine('— gotowe —'); refreshStatus(); loadShots().catch(() => {}); });
window.api.onError(() => {});

refreshStatus().catch((e) => logLine('❌ ' + e.message));
loadShots().catch((e) => logLine('❌ ' + e.message));

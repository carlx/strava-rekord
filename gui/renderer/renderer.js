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
  cells.push(statItem('config.json', s.configError ? 'błąd' : cfgTxt, s.configError ? 'bad' : cfgCls));
  cells.push(statItem('activities.csv', ...wrap(yn(s.hasCsv))));
  cells.push(statItem('Sesja Google', ...wrap(yn(s.hasProfile))));

  if (s.counts) {
    cells.push(statItem('W bazie', s.counts.total));
    cells.push(statItem('Wysłane', s.counts.submitted));
    cells.push(statItem('Do wysłania', s.counts.eligible ?? '—', s.counts.eligible ? 'ok' : ''));
  }
  if (s.range) cells.push(statItem('Zakres dat', `${s.range.from} → ${s.range.to}`));
  if (s.displayName) cells.push(statItem('Podpis', s.displayName));

  $('status-grid').innerHTML = cells.join('');
  if (s.range) {
    $('date-from').value = s.range.from || '';
    $('date-to').value = s.range.to || '';
  }
  if (s.configError) logOnce('config: ' + s.configError);
}

function wrap([v, cls]) { return [v, cls]; }

let lastConfigErr = '';
function logOnce(msg) {
  if (msg !== lastConfigErr) { lastConfigErr = msg; logLine('⚠ ' + msg); }
}

function setBusy(b) {
  for (const id of ['btn-login', 'btn-logout', 'btn-import', 'btn-dry', 'btn-live', 'btn-list', 'refresh', 'save-range']) {
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
    screenshot: $('screenshot').checked,
  };
}

// --- podgląd screenshotów ---
let shotsMode = 'dry-run';

async function loadShots() {
  const list = $('shots-list');
  const files = await window.api.listShots(shotsMode);
  if (!files.length) {
    list.innerHTML = '<li class="empty">(brak — uruchom dry-run ze screenshotem lub wysyłkę live)</li>';
    $('shots-preview').innerHTML = '<p class="muted">Wybierz screenshot z listy…</p>';
    return;
  }
  list.innerHTML = files
    .map(
      (f, i) =>
        `<li data-i="${i}" title="${f.name}"><span>${f.id}</span><span class="kind">${f.kind}</span></li>`
    )
    .join('');
  [...list.querySelectorAll('li[data-i]')].forEach((li) => {
    const file = files[Number(li.dataset.i)];
    li.onclick = () => showShot(file, li);
    li.onmouseenter = async () => {
      if (li.dataset.tip) return;
      li.dataset.tip = '1';
      const info = await window.api.activityInfo(file.id).catch(() => null);
      if (info && info.payload) {
        const p = info.payload;
        li.title = `${p.name}\n${p.date} · ${p.activityType}\n${p.duration} · ${p.distance} km\n${p.link}`;
      }
    };
  });
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

  if (!info.payload) {
    return `<div class="shot-info">${head}<p class="warn">Nie można zbudować danych: ${esc(info.configError || 'brak configu')}</p></div>`;
  }
  const rows = FIELD_LABELS.map(([k, label]) => {
    const v = info.payload[k];
    return `<tr><th>${label}</th><td>${v ? esc(v) : '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  return `<div class="shot-info">${head}<table>${rows}</table></div>`;
}

async function showShot(file, li) {
  document.querySelectorAll('#shots-list li').forEach((el) => el.classList.remove('active'));
  li.classList.add('active');
  const preview = $('shots-preview');
  preview.innerHTML = '<p class="muted">Ładowanie…</p>';
  try {
    const [dataUrl, info] = await Promise.all([
      window.api.readShot(file.path),
      window.api.activityInfo(file.id).catch(() => null),
    ]);
    preview.innerHTML = infoCardHtml(info);

    const btn = document.createElement('button');
    btn.className = 'ghost open-native';
    btn.textContent = 'Otwórz w podglądzie systemowym';
    btn.onclick = () => window.api.openShot(file.path);
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = file.name;
    preview.appendChild(btn);
    preview.appendChild(img);
  } catch (e) {
    preview.innerHTML = `<p class="warn">Nie udało się wczytać: ${e.message}</p>`;
  }
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
$('save-range').onclick = async () => {
  const dateFrom = $('date-from').value;
  const dateTo = $('date-to').value;
  if (!dateFrom || !dateTo) { logLine('⚠ Podaj obie daty.'); return; }
  try {
    await window.api.saveRange({ dateFrom, dateTo });
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

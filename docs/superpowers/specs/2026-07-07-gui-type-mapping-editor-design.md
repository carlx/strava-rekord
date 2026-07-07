# GUI: edytor mapowania typów aktywności + auto-domyślna mapa per język

Data: 2026-07-07
Zakres: `gui/` (Electron GUI) only. `src/` (CLI) nie jest zmieniane — ten sam
podział co przy wcześniejszej obsłudze wielojęzycznego CSV w tej sesji.

## Problem

`typeMapping` (Strava-typ → opcja formularza) jest dziś stałym defaultem
zaszytym w `gui/lib/config.js`, nieedytowalnym z GUI (świadoma decyzja z
`docs/superpowers/specs/2026-07-04-gui-settings-panel-design.md`). Odkąd GUI
obsługuje eksporty CSV w PL/EN/DE, wartości w kolumnie "typ aktywności" są też
tłumaczone (np. `"Jazda"` zamiast `"Ride"`) — user musiał ręcznie edytować
`config.json`, żeby dodać brakujące mapowanie. Chcemy: (1) edytor mapowania w
GUI, (2) automatyczne dopełnienie sensownego domyślnego mapowania dla
wykrytego języka przy pierwszym imporcie.

## Ustalenia z rozmowy

- Cele formularza (prawa strona mapowania) są **stałe i znane** — potwierdzone
  realnym zrzutem `form-fields.json` (z `inspectForm.js`): pytanie "Rodzaj
  aktywności" ma dokładnie 3 opcje: `Jazda na rowerze`, `Spacery/wędrówki
  górskie`, `Bieganie`. Nie trzeba wyciągać ich na żywo z formularza przez
  Playwright — wystarczy zaszyć jako stałą `FORM_OPTIONS`.
- User może **dodawać i usuwać** wiersze mapowania (nie tylko dodawać) —
  prawa strona zawsze z zamkniętej listy `FORM_OPTIONS` (dropdown), lewa
  strona to dowolny tekst (typ Strava).
- Auto-dopełnianie domyślnej mapy dla wykrytego języka odpala się **tylko
  przy zupełnie pierwszym imporcie** (baza pusta / nie istnieje) — kolejne
  importy, nawet w innym języku, nie dotykają już `typeMapping`.
- Dodajemy czytelny sygnał w GUI dla aktywności bez mapowania typu (dziś:
  ciche pomijanie przy wysyłce) — pokazuje typ + licznik, klikalny → wypełnia
  pole dodawania mapowania.
- Panel mapowania to **osobna sekcja** w oknie, nie rozszerzenie istniejącego
  panelu "Ustawienia".

## 1. Wykrywanie języka + domyślne mapowania (`gui/lib/importCsv.js`)

`REQUIRED_HEADER_VARIANTS` (dziś lista tablic) zmienia kształt na listę
`{ lang, header }`:

```js
const HEADER_VARIANTS = [
  { lang: 'en', header: ['Activity ID', 'Activity Date', 'Activity Name', 'Activity Type'] },
  { lang: 'pl', header: ['Identyfikator aktywności', 'Data aktywności', 'Nazwa aktywności', 'Rodzaj aktywności'] },
  { lang: 'de', header: ['Aktivitäts-ID', 'Datum der Aktivität', 'Name der Aktivität', 'Aktivitätstyp'] },
];

function detectHeaderLanguage(header) {
  const match = HEADER_VARIANTS.find(
    (v) => header && v.header.every((name, i) => header[i] === name)
  );
  return match ? match.lang : null;
}
```

`assertValidActivitiesCsv` używa `detectHeaderLanguage(header) !== null` zamiast
dzisiejszego `REQUIRED_HEADER_VARIANTS.some(...)` — ten sam efekt, ale teraz
język jest dostępny do dalszego użycia.

Nowa stała, per-język domyślne mapowania:

```js
const DEFAULT_TYPE_MAPPING_BY_LANG = {
  en: { Ride: 'Jazda na rowerze', Walk: 'Spacery/wędrówki górskie', Hike: 'Spacery/wędrówki górskie', Run: 'Bieganie', TrailRun: 'Bieganie' }, // = dzisiejszy DEFAULT_CONFIG.typeMapping
  pl: { Jazda: 'Jazda na rowerze', Spacer: 'Spacery/wędrówki górskie', Bieganie: 'Bieganie' }, // Jazda/Spacer POTWIERDZONE na realnym pliku; Bieganie->Bieganie to rozsądne, ale NIEZWERYFIKOWANE domniemanie
  de: { Radfahren: 'Jazda na rowerze', Wandern: 'Spacery/wędrówki górskie', Laufen: 'Bieganie' }, // best-effort, NIEZWERYFIKOWANE (brak próbki)
};
```

Celowo **bez** zgadywania PL/DE odpowiedników `Hike`/`TrailRun` — lepiej żeby
taki typ trafił do sygnału "niezmapowane" (sekcja 3) niż żeby błędny domysł po
cichu przypisał aktywność do złej kategorii formularza.

W `importCsv()`: **przed** przetworzeniem wierszy, jeśli `readDb().activities.length === 0`,
wywołaj `detectHeaderLanguage(header)` na wczytanym nagłówku pliku i, jeśli
język ≠ `null` i ≠ `'en'` (en jest już zawsze pokryty przez `DEFAULT_CONFIG`),
zawołaj `mergeTypeMappingDefaults(DEFAULT_TYPE_MAPPING_BY_LANG[lang])` z
`gui/lib/config.js`.

## 2. Edycja mapowania — `gui/lib/config.js` + IPC

Nowa stała (obok `DEFAULT_CONFIG`):

```js
const FORM_OPTIONS = ['Jazda na rowerze', 'Spacery/wędrówki górskie', 'Bieganie'];
```

Nowe funkcje:

```js
function addTypeMapping(stravaType, formOption) {
  const key = stravaType.trim();
  if (!key) throw new Error('Podaj typ aktywności ze Stravy.');
  if (!FORM_OPTIONS.includes(formOption)) throw new Error('Nieprawidłowa opcja formularza.');
  const cfg = loadConfig();
  cfg.typeMapping = { ...cfg.typeMapping, [key]: formOption }; // upsert
  fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2) + '\n');
  return cfg.typeMapping;
}

function removeTypeMapping(stravaType) {
  const cfg = loadConfig();
  delete cfg.typeMapping[stravaType]; // no-op jeśli klucz nie istnieje
  fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2) + '\n');
  return cfg.typeMapping;
}

// wołane wyłącznie z importCsv.js przy pierwszym imporcie — addytywne,
// nigdy nie nadpisuje istniejących kluczy.
function mergeTypeMappingDefaults(defaults) {
  const cfg = loadConfig();
  cfg.typeMapping = { ...defaults, ...cfg.typeMapping };
  fs.writeFileSync(paths.config(), JSON.stringify(cfg, null, 2) + '\n');
}
```

`module.exports` dorzuca: `addTypeMapping, removeTypeMapping,
mergeTypeMappingDefaults, FORM_OPTIONS`.

`gui/main.js`:
- `status` handler: `out.typeMapping = config.typeMapping`, `out.formOptions
  = FORM_OPTIONS`, `out.unmappedTypes = unmappedTypeCounts(db.activities,
  config)` (patrz sekcja 3) — dorzucane obok istniejących pól, w tym samym
  try/catch co dziś.
- Nowe handlery: `ipcMain.handle('add-type-mapping', (_e, { stravaType,
  formOption }) => addTypeMapping(stravaType, formOption))`,
  `ipcMain.handle('remove-type-mapping', (_e, stravaType) =>
  removeTypeMapping(stravaType))`.

`gui/preload.js`: `addTypeMapping: (m) => ipcRenderer.invoke('add-type-mapping', m)`,
`removeTypeMapping: (t) => ipcRenderer.invoke('remove-type-mapping', t)`.

## 3. Panel UI + sygnał niezmapowanych typów

`gui/lib/mapping.js` — nowa czysta funkcja obok `isEligible`/`ineligibleReason`:

```js
function unmappedTypeCounts(activities, config) {
  const counts = new Map();
  for (const a of activities) {
    if (!a.type || config.skipTypes?.includes(a.type) || mapType(a.type, config)) continue;
    counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}
```

Nowy panel w `gui/renderer/index.html`, zaraz po panelu "Ustawienia":

```html
<section class="panel" id="mapping-panel">
  <div class="mapping-head">Mapowanie typów aktywności</div>

  <p id="unmapped-hint" class="warn" hidden>
    Niezmapowane typy: <span id="unmapped-chips"></span>
    — kliknij typ, żeby go szybko dodać poniżej.
  </p>

  <ul id="mapping-list"><!-- "TrailRun → Bieganie [usuń]" --></ul>

  <div class="mapping-add-row">
    <input id="map-new-type" type="text" placeholder="typ ze Stravy, np. TrailRun" />
    <select id="map-new-target"><!-- opcje z FORM_OPTIONS --></select>
    <button id="map-add" class="secondary">Dodaj</button>
  </div>
</section>
```

`gui/renderer/renderer.js`: `renderMapping(s)` wołane z `refreshStatus()` —
buduje `#mapping-list` z `s.typeMapping`, opcje `<select>` z `s.formOptions`,
chipy z `s.unmappedTypes` (klik → wpisuje typ w `#map-new-type` i fokusuje
pole). Usuwanie wiersza → `window.api.removeTypeMapping(type)` → odśwież.
Dodawanie → walidacja niepustego typu w JS (wzorem `save-settings`) →
`window.api.addTypeMapping({ stravaType, formOption })` → odśwież i wyczyść
pole.

## 4. Walidacja, dokumentacja, testy

**Walidacja/błędy:**
- `addTypeMapping` rzuca przy pustym `stravaType` (po `trim()`) i przy
  `formOption` spoza `FORM_OPTIONS` (obrona w głąb — `<select>` i tak
  ogranicza wybór, analogicznie do podwójnej walidacji `.csv` przy wyborze
  pliku).
- Renderer waliduje niepusty typ przed wywołaniem IPC; błędy z IPC lądują w
  logu jak wszędzie indziej w aplikacji.
- `removeTypeMapping` na nieistniejącym kluczu to no-op.

**Dokumentacja:**
- `CLAUDE.md`: dopisać do sekcji o lokalizacji CSV, że `typeMapping` jest
  teraz edytowalny z GUI (dodawanie/usuwanie), że domyślne mapowanie PL/DE
  dopełnia się tylko przy pierwszym imporcie (pusta baza), i że część wpisów
  w `DEFAULT_TYPE_MAPPING_BY_LANG` to niezweryfikowane domysły.
- `gui/README.md`: krótka wzmianka o nowym panelu w opisie kroków obsługi.

**Testy** (throwaway skrypty w scratchpadzie, mockujące `electron`, wzorem
całej reszty tej sesji):
1. `detectHeaderLanguage` zwraca `'en'/'pl'/'de'/null` dla znanych i
   nieznanych nagłówków.
2. Pierwszy import prawdziwego `activities-pl.csv` na pustej bazie →
   `config.json` dostaje `Jazda`/`Spacer`/`Bieganie`, angielskie klucze z
   `DEFAULT_CONFIG` nietknięte.
3. Drugi import (baza już niepusta) **nie** nadpisuje mapowania, nawet jeśli
   user wcześniej usunął jeden z auto-dodanych kluczy.
4. `addTypeMapping` — upsert działa, odrzuca pusty typ i zły `formOption`.
5. `removeTypeMapping` — usuwa klucz, no-op na nieistniejącym.
6. `unmappedTypeCounts` — pomija `skipTypes` i już zmapowane typy, poprawnie
   liczy i sortuje malejąco.
7. Ręczna weryfikacja w oknie (Playwright, jak dotąd w tej sesji): panel się
   renderuje, dodawanie/usuwanie działa, klik w chip niezmapowanego typu
   wypełnia pole tekstowe, sygnał znika po dodaniu mapowania.

**Poza zakresem:** `src/` (CLI) — zmiana tylko w `gui/`.

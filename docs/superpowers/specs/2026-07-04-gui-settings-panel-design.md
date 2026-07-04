# GUI: panel ustawień zamiast ręcznego config.json

Data: 2026-07-04
Zakres: `gui/` (Electron GUI). Nie dotyczy `src/` (CLI) — CLI zachowuje dotychczasowy
manualny flow `config.example.json` → `config.json`.

## Problem

Dziś użytkownik GUI musi ręcznie skopiować `config.example.json` do `config.json`
i wypełnić go w edytorze tekstu, zanim GUI w ogóle zacznie działać
(`loadConfig()` rzuca błąd przy braku pliku). Chcemy to wyeliminować: GUI ma
samo utworzyć `config.json` z sensownymi defaultami i udostępnić edycję
personalnych pól przez panel w oknie aplikacji.

## Zakres

**Edytowalne w GUI:** `formUrl`, `displayName`, `dateFrom`, `dateTo`.

**Stałe defaulty zaszyte w kodzie** (nieedytowalne w GUI, ale nadal zapisane w
pliku i możliwe do ręcznej edycji w edytorze tekstu przez power-usera):
`timeSource`, `skipTypes`, `typeMapping` — wartości identyczne jak dziś w
`config.example.json`.

Poza zakresem: konfigurowanie mapowania typów aktywności / opcji formularza
przez GUI, wybór timeSource w GUI, wsparcie wielu profili/configów.

## Architektura

Wariant wybrany (spośród trzech rozważanych — jeden plik z pełnym kształtem
na dysku vs. rozdzielone źródła vs. jawny przycisk "utwórz config"): **jeden
plik `config.json`, pełny kształt na dysku, z automatycznym tworzeniem przy
pierwszym uruchomieniu.** Uzasadnienie: zgodność z dzisiejszym formatem pliku
(brak migracji dla istniejących configów), zachowanie ręcznej furtki edycji
`skipTypes`/`typeMapping` w pliku, minimalna zmiana istniejącego wzorca kodu
(`updateDateRange` już robi read-modify-write całego obiektu).

## 1. Warstwa configu (`gui/lib/config.js`)

Nowa stała:

```js
const DEFAULT_CONFIG = {
  timeSource: 'moving',
  skipTypes: ['Swim'],
  typeMapping: {
    Ride: 'Jazda na rowerze',
    Walk: 'Spacery/wędrówki górskie',
    Hike: 'Spacery/wędrówki górskie',
    Run: 'Bieganie',
    TrailRun: 'Bieganie',
  },
};
```

`loadConfig()`:
- Jeśli `config.json` nie istnieje → tworzy go: `{ ...DEFAULT_CONFIG, formUrl: '',
  displayName: '', dateFrom: <dziś ISO>, dateTo: <dziś+90dni ISO> }`, zapisuje na
  dysk, zwraca.
- Jeśli istnieje → czyta plik i **merguje z `DEFAULT_CONFIG` na każdym
  wczytaniu** (`{ ...DEFAULT_CONFIG, ...JSON.parse(raw) }`), nie tylko przy
  tworzeniu — zabezpiecza to przypadek ręcznie edytowanego pliku, w którym
  ktoś usunie/pominie `timeSource`/`skipTypes`/`typeMapping` (dzisiejszy
  `if (!cfg.typeMapping) throw` znika, zastąpiony mergem).
- Walidacja "formUrl/displayName niepuste" **nie** blokuje samego
  `loadConfig()` (bo `status`, `list-shots`, panel ustawień i
  `listActivities.js` muszą móc wczytać config z pustymi polami) — `loadConfig()`
  zawsze zwraca obiekt, nigdy nie rzuca dla brakującego/pustego pola.

Nowa funkcja `requireReady(config)` (eksportowana obok `loadConfig`):
```js
function requireReady(cfg) {
  if (!cfg.formUrl) throw new Error('Uzupełnij link do formularza w panelu Ustawienia.');
  if (!cfg.displayName) throw new Error('Uzupełnij imię i nazwisko w panelu Ustawienia.');
  return cfg;
}
```
Wołana jawnie w miejscach, które faktycznie potrzebują kompletnego configu:
- `gui/lib/login.js:10` — `const config = requireReady(loadConfig());` (dziś
  woła gołe `loadConfig()`; bez tej zmiany kliknięcie "Zaloguj do Google" przy
  pustym `formUrl` poleci do `page.goto('')` i wywali się niezrozumiałym
  błędem Playwrighta zamiast czytelnego komunikatu).
- `gui/lib/submit.js:52` — analogicznie, `requireReady(loadConfig())`.

Bez zmian (zostają na gołym `loadConfig()`, bo nie potrzebują formUrl/displayName):
- `gui/lib/listActivities.js:6` — używa tylko `dateFrom`/`dateTo`/`typeMapping`.
- `gui/main.js` (`status`, `list-shots`) — mają celowo tolerować niekompletny
  config, żeby `needsSetup` mogło się w ogóle policzyć.

`updateDateRange` → uogólnione na:

```js
function updateSettings({ formUrl, displayName, dateFrom, dateTo })
```

Waliduje: `formUrl` niepuste i zaczyna się od `https://` (celowo bez sztywnego
wymogu `docs.google.com/forms/` — odrzuciłoby to poprawne krótkie linki
`https://forms.gle/...`); `displayName` niepuste; daty w formacie `YYYY-MM-DD`,
`dateFrom <= dateTo` (jak dziś). Read-modify-write całego pliku — nadpisuje
tylko te 4 pola, resztę zostawia nietkniętą.

`paths.configExample()` i przepływ "skopiuj `config.example.json`" znikają z
GUI (pozostają nieużywane / do usunięcia z `gui/lib/paths.js`; sam plik
`config.example.json` w repo dalej służy CLI).

## 2. IPC + preload

`gui/main.js`:
- `save-range` → `save-settings`, przyjmuje `{ formUrl, displayName, dateFrom,
  dateTo }`, woła `updateSettings(...)`.
- `status` handler: dodaje `needsSetup: !config.formUrl || !config.displayName`
  oraz zwraca też `formUrl` (dziś zwraca tylko `range`/`displayName`
  częściowo) — panel potrzebuje wszystkich 4 wartości do wypełnienia pól przy
  starcie.
- `configError` w statusie od teraz oznacza wyłącznie realnie uszkodzony JSON
  (parse error), nie brak pliku — plik zawsze istnieje po pierwszym
  `loadConfig()`.

`gui/preload.js`:
- `saveRange` → `saveSettings: (settings) => ipcRenderer.invoke('save-settings',
  settings)`.

Reszta IPC (import/submit/list/logout/screenshoty) bez zmian.

## 3. UI (`gui/renderer/`)

`index.html`: panel `range-panel` zamienia się w panel `settings-panel`
("Ustawienia"), umieszczony na górze `col-main` (przed `status-panel`):

```html
<section class="panel" id="settings-panel">
  <div class="settings-row">
    <label>Link do formularza
      <input id="set-form-url" type="text" placeholder="https://docs.google.com/forms/d/e/.../viewform" />
    </label>
  </div>
  <div class="settings-row">
    <label>Imię i nazwisko
      <input id="set-display-name" type="text" placeholder="Imię Nazwisko" />
    </label>
  </div>
  <div class="settings-row">
    <label>Od <input id="set-date-from" type="date" /></label>
    <label>Do <input id="set-date-to" type="date" /></label>
  </div>
  <button id="save-settings" class="secondary">Zapisz ustawienia</button>
  <p id="settings-hint" class="muted" hidden>
    Uzupełnij link do formularza i imię/nazwisko, żeby móc importować i wysyłać aktywności.
  </p>
</section>
```

`renderer.js` — zmiany do istniejącego kodu (nie tylko dodanie nowego):
- `refreshStatus()` (dziś linie 40-43, `renderer.js:40-43`): usunąć
  `$('date-from')`/`$('date-to')` (te id znikają z `index.html` razem z
  `range-panel` — bez usunięcia tego kodu `$('date-from')` zwróci `null` i
  `refreshStatus()` wywali się przy każdym odświeżeniu statusu). Zastąpić
  wypełnianiem `set-form-url`/`set-display-name`/`set-date-from`/`set-date-to`
  wartościami ze `status()` (potrzebne jest więc, żeby `status` IPC zwracał
  też `formUrl`, patrz sekcja 2), ale tylko gdy dane pole nie jest aktualnie
  fokusowane (nie nadpisuje w trakcie pisania).
- `setBusy()` (dziś `renderer.js:55`): id `'save-range'` w tablicy przycisków
  do wyłączenia zmienia się na `'save-settings'`.
- Stary handler `$('save-range').onclick` (dziś `renderer.js:215-224`) —
  usunąć całość, zastąpić nowym `$('save-settings').onclick`, który czyta
  `set-form-url`/`set-display-name`/`set-date-from`/`set-date-to`, waliduje że
  wszystkie 4 są niepuste (jak dziś robi to dla samych dat), woła
  `window.api.saveSettings({ formUrl, displayName, dateFrom, dateTo })`,
  odświeża status i (jeśli lista jest widoczna) listę — analogicznie do
  dzisiejszego wzorca.
- Nowe: gdy `status.needsSetup`, pokazuje `#settings-hint` i dodaje klasę
  `.attention` na `#settings-panel`; w przeciwnym razie ukrywa/usuwa.

`styles.css`: `.panel.attention { border-color: <akcent ostrzegawczy> }`,
spójny z istniejącą paletą (`danger`/`secondary`).

## 4. Obsługa błędów, dokumentacja, testy

**Błędy:** komunikaty przy braku `formUrl`/`displayName` w `import`/`submit`
zmieniają treść na odesłanie do panelu Ustawienia (nie do
`config.example.json`).

**Migracja:** istniejący, już wypełniony `config.json` (kształt niezmieniony)
wczytuje się bez żadnej migracji.

**Dokumentacja:**
- `gui/README.md`: usunąć instrukcję "połóż config.json obok binarki" w
  części dotyczącej formUrl/displayName/dat; opisać automatyczne tworzenie
  configu + panel Ustawienia. `activities.csv` nadal wymaga ręcznego
  podłożenia — bez zmian.
- `CLAUDE.md`: zaktualizować opis `config.json`/`config.example.json` o
  wbudowane defaulty GUI (`DEFAULT_CONFIG` w `gui/lib/config.js`) i
  automatyczne tworzenie pliku; CLI bez zmian.

**Testy** (brak frameworka w repo — throwaway skrypt w scratchpadzie,
mockujący `electron`, wzorem istniejących testów):
- brak `config.json` → `loadConfig()` tworzy plik z defaultami + pustymi
  `formUrl`/`displayName` + datami dziś/+90 dni.
- istniejący pełny `config.json` → `loadConfig()` zwraca bez zmian.
- `updateSettings` z pustym `formUrl`/`displayName`/złymi datami → błąd
  walidacji, plik niezmieniony.
- `updateSettings` z poprawnymi danymi → nadpisuje tylko 4 pola, reszta
  nietknięta.
- ręczna weryfikacja w oknie (`npm start` w `gui/`): usunięcie `config.json`,
  restart, sprawdzenie że panel Ustawienia pokazuje podpowiedź i po zapisaniu
  import/submit działają.

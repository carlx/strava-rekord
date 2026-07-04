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
- Jeśli istnieje → czyta jak dziś. Walidacja "formUrl/displayName niepuste"
  **nie** blokuje samego `loadConfig()` (bo `status` i panel ustawień muszą
  móc wczytać config z pustymi polami) — przenosi się do miejsc, które
  faktycznie potrzebują kompletnego configu (import, submit — przez
  `mapping.js`/`importCsv.js`/`submit.js`), z komunikatem odsyłającym do
  panelu Ustawienia zamiast do `config.example.json`.

`updateDateRange` → uogólnione na:

```js
function updateSettings({ formUrl, displayName, dateFrom, dateTo })
```

Waliduje: `formUrl` niepuste i zaczyna się od `https://docs.google.com/forms/`;
`displayName` niepuste; daty w formacie `YYYY-MM-DD`, `dateFrom <= dateTo` (jak
dziś). Read-modify-write całego pliku — nadpisuje tylko te 4 pola, resztę
zostawia nietkniętą.

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

`renderer.js`:
- `refreshStatus()`: wypełnia pola `set-form-url`/`set-display-name`/
  `set-date-from`/`set-date-to` wartościami ze `status()`, ale tylko gdy pole
  nie jest aktualnie fokusowane (nie nadpisuje w trakcie pisania).
- Gdy `status.needsSetup`: pokazuje `#settings-hint`, dodaje klasę
  `.attention` na `#settings-panel`.
- `#save-settings` click → `window.api.saveSettings({...})`; sukces odświeża
  status; błędy walidacji lecą przez istniejący `onError`/log (ten sam wzorzec
  co dzisiejszy `save-range`).

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

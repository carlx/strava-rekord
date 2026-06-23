# Strava → "Rekordowe kilometry" (Google Forms)

Skrypt który importuje eksport aktywności ze Stravy (`activities.csv`)
do lokalnej bazy JSON, a potem wypełnia formularz Google
("Rekordowe kilometry") jedną aktywnością po drugiej. Każda wysłana
aktywność dostaje flagę `submitted: true`, więc kolejny przebieg pomija
to, co już poszło.

## Wymagania

- Node.js 20+
- Google Chrome (Playwright używa zainstalowanego Chrome — nie testowego Chromium,
  bo Google blokuje logowanie z bundlowanego Chromium)
- Konto Google z dostępem do formularza

## Pierwsze uruchomienie

```bash
npm install
cp config.example.json config.json  # potem uzupełnij formUrl, displayName, daty
npx playwright install chromium     # potrzebne raz, ~100 MB
node src/login.js                   # otwiera Chrome, logujesz się ręcznie
```

`login.js` otworzy okno Chrome na adresie formularza. Zaloguj się normalnie
(Google + 2FA), a gdy zobaczysz pola formularza, skrypt sam wykryje że
sesja jest gotowa, zapisze ją w `.chrome-profile/` i zamknie okno. Hasło
nigdzie nie trafia — `.chrome-profile/` to zwykły profil Chrome z cookies
sesji.

Jeśli zobaczysz "Couldn't sign you in — This browser or app may not be secure",
to znaczy że Playwright spadł z powrotem na bundlowanego Chromium. Sprawdź,
czy masz Google Chrome zainstalowane w `/Applications/Google Chrome.app` (macOS).

## Codzienny workflow

```bash
# 1. Zaimportuj/odśwież bazę z CSV (idempotentne — flagi submitted przeżywają)
node src/import.js

# 2. Dry-run: wypełnia formularz, NIE klika "Prześlij", zapisuje screenshot
node src/submit.js --screenshot --limit 1

# 3. Sprawdź screenshots/{activity_id}.png

# 4. Live submit
node src/submit.js --submit

# 5. Podgląd co już wysłałeś (z zakresu config + submitted=true)
node src/list.js
```

Sensowne flagi `submit.js`:

| Flaga | Domyślnie | Co robi |
|---|---|---|
| `--submit` | off | Faktycznie klika "Prześlij". Bez tej flagi jest dry-run. |
| `--limit N` | brak | Przetwarza maks. N aktywności (od najstarszych spośród eligible). |
| `--screenshot` | off | W dry-run zapisuje `screenshots/{id}-filled.png`. W trybie `--submit` ignorowane (i tak są zawsze zapisywane). |
| `--headed` | off | Pokazuje okno przeglądarki. Przydatne do debugowania. |

### Screenshoty

- **Dry-run** + `--screenshot` → `screenshots/{id}-filled.png` (formularz wypełniony, nie wysłany).
- **`--submit`** → zawsze **dwa** screenshoty na aktywność (audit log):
  - `screenshots/{id}-filled.png` — formularz tuż przed kliknięciem "Prześlij"
  - `screenshots/{id}-confirm.png` — strona potwierdzenia od Google po wysłaniu

## Konfiguracja (`config.json`)

```json
{
  "formUrl": "...",
  "displayName": "Karol Wawrzecki",
  "dateFrom": "2026-06-22",
  "dateTo": "2026-09-21",
  "timeSource": "moving",
  "skipTypes": ["Swim"],
  "typeMapping": {
    "Ride": "Jazda na rowerze",
    "Walk": "Spacery/wędrówki górskie",
    "Hike": "Spacery/wędrówki górskie",
    "Run": "Bieganie",
    "TrailRun": "Bieganie"
  }
}
```

- `dateFrom`/`dateTo` — okno akcji. Aktywności poza zakresem są pomijane.
- `timeSource` — `"moving"` (czas faktycznego ruchu) lub `"elapsed"` (z pauzami).
- `skipTypes` — typy Stravy które mają być całkowicie pomijane (np. Swim,
  bo formularz nie ma opcji pływania).
- `typeMapping` — Strava activity type → opcja w polu "Rodzaj aktywności".
  Brak mapowania = aktywność pominięta z opisem przyczyny w logu.

## Format danych w formularzu

| Pole formularza | Skąd | Format |
|---|---|---|
| Imię i nazwisko | `config.displayName` | tekst |
| Data aktywności | `activity.date` | `YYYY-MM-DD` (input type=date) |
| Rodzaj aktywności | `typeMapping[activity.type]` | radio |
| Czas trwania | `movingTimeSec` lub `elapsedTimeSec` | `hh:mm:ss` |
| Ilość kilometrów | dystans w metrach z CSV | `km,mmm` np. `28,581` (przecinek dziesiętny, 3 cyfry po) |
| Link | `activity.id` | `https://www.strava.com/activities/{id}` |
| Dodatkowy opis | `activity.description` z CSV | tekst lub puste |
| Zdjęcie | — | pomijane (pole opcjonalne) |

## Struktura `db.json`

```js
{
  importedAt: "2026-06-23T21:30:00Z",
  activities: [
    {
      id: "19040043792",
      date: "2026-06-23T17:54:25",
      name: "Evening Ride",
      type: "Ride",
      description: null,
      elapsedTimeSec: 4603,
      movingTimeSec: 4067,
      distanceKm: 28.58,
      avgSpeedKmh: 25.3,
      maxSpeedKmh: 39.72,
      elevationGainM: 98,
      // ...
      raw: [...],          // pełny wiersz CSV na zapas
      submitted: false,
      submittedAt: null,
      submitError: null
    },
    // ...
  ]
}
```

Po `--submit` aktywność dostaje `submitted: true` i `submittedAt: <ISO>`.
Jeśli wysyłanie się wywaliło, w `submitError` jest tekst błędu — następny
przebieg spróbuje ponownie (chyba że to wynik `--limit`/zakresu).

## Re-export ze Stravy

Nadpisz `activities.csv` nowym eksportem i uruchom `node src/import.js`.
Importer dolewa nowe `id` i odświeża pola dla istniejących, ale **nie
zmienia** flag `submitted/submittedAt/submitError`. Idempotentne, można
puszczać codziennie.

## Częste problemy

**`No .chrome-profile/ — run node src/login.js first`**
Sesja nigdy nie była zapisana albo katalog został skasowany. Zaloguj się ponownie.

**`Timed out waiting for the form to load`** w `login.js`
Logowanie potrwało dłużej niż 10 min, albo Google przekierował gdzieś indziej.
Sprawdź adres URL w oknie. Restart skryptu.

**`locator.fill: Timeout` na konkretnym polu**
Google zmienił labelki/strukturę formularza. Odpal `node src/inspectForm.js`,
sprawdź czy labelki w `form-fields.json` zgadzają się z `LABELS` w
`src/formMapping.js`, popraw.

**Sesja wygasła w środku przebiegu**
Submitter sczyta dotychczas wysłane z `db.json`, więc po `node src/login.js`
i ponownym `node src/submit.js --submit` ruszy od tej, na której padło.

## Pliki w repo

- `activities.csv` — źródło, eksport ze Stravy
- `config.json` — Twoja konfiguracja
- `db.json` — stan (generowany przez `import.js`, modyfikowany przez `submit.js`)
- `form-fields.json`, `form-raw.json` — dump struktury formularza (`inspectForm.js`)
- `screenshots/` — dry-run preview formularza
- `.chrome-profile/` — sesja Chrome (cookies, localStorage)
- `src/login.js`, `src/import.js`, `src/inspectForm.js`, `src/formMapping.js`, `src/submit.js`, `src/list.js`

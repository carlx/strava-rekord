# Strava Rekord — GUI (Electron)

Graficzna nakładka na skrypty z `../src`. Robi to samo (import CSV → logowanie →
dry-run → wysyłka → lista), tylko w okienku, i daje się spakować do
samodzielnej binarki: **Windows `.exe`**, **Linux `AppImage`**, **macOS `.dmg`**.

## Jak to działa pod spodem

- **GUI:** Electron (jego Chromium = interfejs).
- **Automatyzacja:** `playwright-core` sterujący **systemowym Google Chrome**
  (`channel: 'chrome'`) — to jedyny wariant przechodzący blokadę logowania
  Google („browser not secure”). Pełna automatyzacja, łącznie z klikaniem
  „Prześlij”.
- **Pakowanie:** `electron-builder`.

### Co jest w binarce, a co nie

| W binarce | Poza binarką (wymagane na maszynie) |
|---|---|
| Electron + Playwright + cała logika | **Google Chrome** (zainstalowany) |

Nie pakujemy przeglądarki — bundlowany Chromium jest blokowany przez Google.
To jedyne zewnętrzne wymaganie.

## Katalog aplikacji (gdzie żyją pliki)

Wszystkie pliki robocze są czytane i tworzone w **katalogu aplikacji**:

- wersja spakowana → katalog obok pliku wykonywalnego,
- tryb deweloperski → katalog główny projektu.

Dotyczy to: `config.json`, `activities.csv`, `db.json`, `screenshots/`,
`.chrome-profile/`. Przycisk **„Otwórz”** w GUI otwiera ten katalog.

`config.json` tworzy się automatycznie przy pierwszym uruchomieniu (z
wbudowanymi defaultami mapowania typów aktywności) — link do formularza,
imię/nazwisko i zakres dat ustawia się w panelu **Ustawienia** w oknie
aplikacji, bez ręcznej edycji pliku.

> Dla wersji spakowanej: połóż `activities.csv` obok binarki.

## Uruchomienie w trybie dev

```bash
cd gui
npm install
npm start
```

## Budowa binarki

```bash
npm run dist          # dla bieżącego systemu
npm run dist:win      # Windows  .exe (portable)
npm run dist:linux    # Linux    AppImage
npm run dist:mac      # macOS    .dmg
```

Wynik ląduje w `gui/dist/`. Budowanie pod inny system niż własny bywa
ograniczone (np. `.dmg` realnie tylko na macOS).

## Obsługa w oknie

0. **Ustawienia** — link do formularza, imię/nazwisko i zakres dat. Przy
   pierwszym uruchomieniu pola są puste, panel podpowiada co uzupełnić.
1. **Zaloguj do Google** — raz, otwiera Twój Chrome; zaloguj się ręcznie.
2. **Importuj activities.csv** — wczytuje eksport ze Stravy do bazy.
3. **Dry-run** — wypełnia formularz bez wysyłki (zawsze zapisuje zrzut).
4. **Wyślij (LIVE)** — wysyła naprawdę; `Limit` ogranicza liczbę, `Stop`
   przerywa po bieżącej aktywności.
5. **Pokaż listę** — co w zakresie dat jest wysłane / oczekuje.

Screenshoty zapisują się w osobnych podfolderach, żeby się nie nadpisywały:
`screenshots/dry-run/` i `screenshots/live/`. Panel **„Podgląd screenshotów”**
w oknie pozwala je przeglądać (przełącznik Dry-run / Live) i otworzyć w
podglądzie systemowym.

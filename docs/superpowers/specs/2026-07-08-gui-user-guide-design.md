# GUI: przewodnik krok-po-kroku dla zwykłego użytkownika

Data: 2026-07-08
Zakres: dokumentacja, `gui/` only.

## Problem

Jedyna dokumentacja GUI to `gui/README.md`, pisana pod deweloperów (npm,
electron-builder, architektura). Zwykły użytkownik klikający w gotową appkę
nie ma przewodnika krok-po-kroku ze zrzutami ekranu.

## Rozwiązanie

Nowy plik `gui/PRZEWODNIK.md` — osobny od `gui/README.md`, wyłącznie o
obsłudze okna aplikacji, bez treści deweloperskich. Link do niego na górze
`gui/README.md`.

### Zrzuty ekranu — izolacja od prawdziwych danych

Zrzuty robione przez Playwright (`_electron`) na **skopiowanej, spakowanej
appce w tymczasowym folderze poza repo** — nie na `npm start` w repo (które
czyta prawdziwy `config.json`/`db.json` użytkownika). Przed zrzutami do tego
tymczasowego folderu wgrywane są fikcyjne `config.json` (przykładowy link
`https://forms.gle/PRZYKLAD1234`, imię „Jan Kowalski”, sensowny zakres dat) i
fikcyjne `db.json` (kilka zmyślonych aktywności o różnych typach/datach/
statusach wysyłki — część zmapowana, część nie, żeby zilustrować panel
mapowania i sygnał niezmapowanych typów). Appka nie ma dostępu do prawdziwych
plików użytkownika w żadnym momencie tego procesu.

Pliki PNG lądują w `gui/przewodnik-img/*.png`, osadzone w
`gui/PRZEWODNIK.md` względnymi ścieżkami (`![...](przewodnik-img/...png)`).

### Struktura przewodnika

1. **Instalacja** — osobne podsekcje:
   - Windows: rozpakuj `.zip` do stałego folderu (Pulpit/Dokumenty) i uruchom
     `.exe` stamtąd — nie z folderu Pobrane/tymczasowego (appka trzyma tam
     swoje dane; ryzyko utraty przy sprzątaniu Pobranych).
   - macOS: otwórz `.dmg`, przeciągnij `.app` do wybranego folderu; przy
     pierwszym uruchomieniu prawy klik → „Otwórz” (appka niepodpisana).
   - Linux: `chmod +x` na `AppImage`, uruchom.
2. Pierwsze uruchomienie — puste Ustawienia, widoczna podpowiedź.
3. Uzupełnienie Ustawień (link do formularza, imię/nazwisko, zakres dat) +
   „Zapisz ustawienia”.
4. Zalogowanie do Google („1 · Zaloguj do Google”).
5. Skąd wziąć `activities.csv` (rozwijana pomoc już w appce) i jak go wgrać.
6. Sprawdzenie/uzupełnienie mapowania typów aktywności (panel „Mapowanie
   typów aktywności”, sygnał niezmapowanych).
7. Sprawdzenie listy do wysłania (stała lista pod krokiem importu).
8. Dry-run (co robi, że nic nie wysyła).
9. Wysyłka na żywo — wyraźne ostrzeżenie o nieodwracalności.
10. Podgląd zrzutów ekranu (panel „Podgląd wypełnionych formularzy”).
11. Aktualizacja do nowej wersji — kopiowanie `config.json`/`db.json`/
    `screenshots/`/`.chrome-profile/` do folderu nowej wersji (appka już to
    podpowiada pod „Folder aplikacji”).

Każdy krok: 1 zrzut ekranu + kilka zdań prostym językiem (kontynuacja stylu
z sesji upraszczania GUI — bez żargonu, krótkie zdania).

## Poza zakresem

Pełny cykl recenzji spec-review-agentem — nieproporcjonalny do zadania
dokumentacyjnego; ten spec jest jednocześnie planem wykonania.

# GUI: podpowiedzi typów w polu dodawania mapowania

Data: 2026-07-08
Zakres: `gui/` only. Mały dodatek do edytora mapowania typów aktywności
(`docs/superpowers/specs/2026-07-07-gui-type-mapping-editor-design.md`).

## Problem

Pole „typ ze Stravy” (`#map-new-type`) w panelu „Mapowanie typów aktywności”
to zwykły wolny tekst — user musi pamiętać/przepisać dokładną pisownię typu
(np. `TrailRun`, `Jazda`). Chcemy podpowiedzi z listy typów już widzianych w
bazie, bez rezygnacji z możliwości wpisania czegokolwiek innego.

## Rozwiązanie

Baza (`db.json`) po imporcie zawsze pokrywa się z plikiem CSV (import wpisuje
każdy typ z pliku do bazy), więc źródłem podpowiedzi jest `db.activities` —
nie trzeba osobno parsować CSV. Lista obejmuje **wszystkie** typy z bazy
(zmapowane i niezmapowane) — przydatne też przy zmianie celu istniejącego
mapowania.

Mechanizm: natywny `<datalist>` podpięty przez atrybut `list` do istniejącego
`#map-new-type`. To daje „wybierz z listy LUB wpisz własne” za darmo — input
zostaje zwykłym polem tekstowym, przeglądarka sama pokazuje podpowiedzi.

### Zmiany

**`gui/main.js`** — w `status` handlerze, w tym samym bloku try/catch co
`out.counts`/`out.unmappedTypes` (ten sam już wczytany `all`):
```js
out.allTypes = [...new Set(all.map((a) => a.type).filter(Boolean))].sort();
```

**`gui/renderer/index.html`** — dodać `<datalist>` i podpiąć do inputa:
```html
<input id="map-new-type" type="text" list="known-types" placeholder="typ ze Stravy, np. TrailRun" />
<datalist id="known-types"></datalist>
```

**`gui/renderer/renderer.js`** — w `renderMapping(s)`, obok budowania
`#unmapped-chips`:
```js
$('known-types').innerHTML = (s.allTypes ?? []).map((t) => `<option value="${esc(t)}"></option>`).join('');
```

Nie koliduje z istniejącymi chipami niezmapowanych typów — to uzupełniające
się mechanizmy (chipy = „to wymaga uwagi”, datalist = „oto co w ogóle
istnieje”).

## Testy

- `status` zwraca `allTypes` jako posortowaną listę unikalnych, niepustych
  typów z bazy.
- Ręczna weryfikacja w oknie (Playwright, jak dotąd w tej sesji): `<datalist>`
  zawiera oczekiwane typy, pole nadal przyjmuje dowolny wpisany tekst.

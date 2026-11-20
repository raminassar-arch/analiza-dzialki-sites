# Analiza działki — wersja WWW (statyczna)

Statyczna wersja aplikacji **Analiza działki**: same pliki HTML, CSS i JavaScript.
Działa na GitHub Pages, dowolnym hostingu statycznym oraz jako osadzenie
w **Google Sites**. Nie wymaga Electrona, Pythona, serwera ani kluczy API.

Silnik analizy (`app.js`) i wygląd (`styles.css`) są tymi samymi plikami co
w wersji desktopowej. Różni się tylko warstwa hostingu: PDF powstaje w oknie
druku przeglądarki, a `web-bridge.js` zastępuje most Electrona.

## Adresy publikacji

| Co | Adres |
| --- | --- |
| Aplikacja | https://raminassar-arch.github.io/analiza-dzialki-sites/ |
| Pomocnik osadzania | https://raminassar-arch.github.io/analiza-dzialki-sites/embed.html |
| Repozytorium | https://github.com/raminassar-arch/analiza-dzialki-sites |

Hosting: GitHub Pages, gałąź `main`, katalog główny (`/`). Plik `.nojekyll`
zapobiega przetwarzaniu przez Jekyll.

## Co jest w środku

| Plik | Rola |
| --- | --- |
| `index.html` | interfejs aplikacji — kartowy panel, mapa, pasek postępu, legenda |
| `app.js` | analiza działki, zapytania do otwartych źródeł, cienie, uzbrojenie, raport |
| `styles.css` | design: jasne karty, butelkowa zieleń, nagłówki wielkimi literami, linie podziału |
| `site.css` | adaptacja układu do karty przeglądarki / ramki Google Sites |
| `web-bridge.js` | marked `ANALIZA_DZIALKI_WEB`, obsługa nieoczekiwanych błędów pobierania |
| `embed.html` | generator kodu iframe dla Google Sites + podgląd |
| `vendor/` | lokalne Leaflet, SunCalc i zasoby ikon — bez CDN |
| `favicon.svg` | zielony znak PL |

## Funkcje

- wyszukiwanie adresów i miejsc w Polsce (Photon, fallback Nominatim),
- klik na mapę → dane działki z ULDK, powierzchnia, identyfikator, EGiB,
- budynki, drogi, POI i **uzbrojenie działki** z OSM/Overpass,
- sprawdzanie budynku: lista działek i dostępne dane o budynku,
- plan miejscowy (MPZP) — tylko bezpośrednie dane/links; brakujące pola jako `-`,
- dane społeczne (liczba ludności, gęstość) z GUS BDL,
- nasłonecznienie i cienie budynków z SunCalc, sterowanie w „Warstwach”,
- pasek postępu z etapami, procentem i licznikiem pobranych danych,
- pięć podkładów map (OSM France, OSM, ciemny OSM, OpenTopoMap, ortofotomapa GUGiK),
- raport PDF z widokiem sytuacyjnym 1:500 / 1:1000, cieniami i listą obiektów.

## Źródła danych

Wszystkie źródła są otwarte i bezkluczowe:

- **GUGiK** — ULDK (działki), EGiB (działki i budynki), MPZP (KIMP WMS/WFS),
- **GUS BDL** — liczba ludności i gęstość zaludnienia gminy,
- **OpenStreetMap** — Photon, Nominatim, Overpass, standardowe kafelki OSM,
- **SunCalc** — pozycja słońca i geometria cieni.

Nie używamy CARTO ani żadnej usługi komercyjnej/kluczowej. Wymagane jest
połączenie z Internetem — kafelki i API nie są pakowane do repozytorium.

## Publikacja na GitHub Pages

Repozytorium `analiza-dzialki-sites` jest publiczne. Po zmianie plików:

```powershell
git add .
git commit -m "Analiza działki WWW — aktualizacja"
git push origin main
```

Jeśli Pages nie jest jeszcze włączone: **Settings → Pages → Build and deployment
→ Source: Deploy from a branch → Branch: `main`, folder: `/ (root)` → Save**.

Po zmianach w `app.js`, `styles.css`, `site.css` lub `web-bridge.js` podnieś
sufiks `?v=1.0.0` w `index.html`, aby przeglądarki nie trzymały starych plików
z pamięci podręcznej (GitHub Pages ustawia `Cache-Control: max-age=600`).

## Osadzenie w Google Sites

Otwórz `https://raminassar-arch.github.io/analiza-dzialki-sites/embed.html`,
skopiuj wygenerowany kod i wybierz w Google Sites
**Wstaw → Osadź → Kod osadzania**. Rozciągnij blok na całą szerokość i ustaw
wysokość około 900–1100 px.

Gotowy kod:

```html
<iframe src="https://raminassar-arch.github.io/analiza-dzialki-sites/"
        title="Analiza działki — mapa i raport"
        style="width:100%;height:1000px;border:0;display:block"
        allow="geolocation; clipboard-write"></iframe>
```

Warto dodać obok ramki odnośnik „Otwórz aplikację w nowej karcie” — w części
przeglądarek drukowanie z wnętrza ramki Google Sites obejmuje całą stronę.

## Ograniczenia wersji WWW

- PDF zapisujesz przez okno druku przeglądarki (w desktopie jest natywny zapis pliku).
- Atrybut `allow="geolocation"` jest wymagany, aby działał przycisk „Moja lokalizacja”.
- Google Sites nie dopasowuje wysokości ramki automatycznie.
- Dane z zewnętrznych API zależą od ich dostępności i odpowiedzi CORS.

## Uruchomienie lokalne

Jak każdy statyczny serwer, np.:

```powershell
python -m http.server 8000
```

Potem otwórz `http://localhost:8000/`. Nie otwieraj `index.html` przez
`file://` — przeglądarki blokują wtedy część zapytań CORS.

---

Rami Nassar · © 2026 · wersja WWW 1.0.0

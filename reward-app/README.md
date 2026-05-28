# Min Sparegris 🐷

En lille selvstændig belønnings-app til iPad. Lavet til at hjælpe et barn med at spare op til et større mål gennem konkrete aktiviteter med kr.-belønninger.

## Hvad er det

- Forældre opretter aktiviteter (fx "Cykel 20 min" → 20 kr) og et mål (fx "Ny computer" → 5000 kr).
- Barnet trykker på en aktivitet når den er gennemført. Pengene tikker op på sparegrisen.
- Når opsparingen når målet, kommer en stjerne-fest og et nyt mål kan sættes.
- Indstillinger låses med en 4-cifret forældre-PIN.

## Funktioner

- 🎯 Ét aktivt mål ad gangen, med navn, beløb og emoji.
- 🏆 Ubegrænset antal aktiviteter (navn, kr.-belønning, emoji).
- 🐷 Visuel fremdrift (procentbar + manglende beløb).
- 🎉 Konfetti og "ka-ching"-lyd ved gennemførsel (kan slås fra under "Andet").
- 📖 Historik over de seneste gennemførsler (parent kan fortryde en gennemførsel).
- 🔒 PIN-låste indstillinger.
- 💾 Alt gemmes lokalt på enheden i `localStorage` — ingen backend, ingen konto.
- 📱 Kan tilføjes til iPadens hjemmeskærm og åbnes fuldskærm som en almindelig app (PWA).

## Filer

- `index.html` — selve appen (HTML/CSS/JS, ingen build-trin)
- `manifest.webmanifest` — PWA-manifest
- `icon.svg`, `icon-maskable.svg` — app-ikoner

## Sådan bruger du den

### Kør lokalt

Det er en statisk side, så en hvilken som helst statisk webserver virker:

```bash
cd reward-app
npx serve .
# eller
python3 -m http.server 8000
```

Åbn `http://localhost:3000` (eller den port serveren viser).

### På iPad

1. Hostr appen et sted (Railway, Netlify, Vercel, GitHub Pages, eller bare det interne netværk).
2. Åbn URL'en i Safari på iPad.
3. Tryk på del-ikonet → "Føj til hjemmeskærm" → giv den et navn.
4. Nu kan din søn åbne appen som en almindelig app i fuldskærm.

### Første gang

- Tryk på ⚙️-tandhjulet.
- Vælg en 4-cifret forældre-PIN (skriv den ned).
- Sæt målet (navn, beløb, evt. emoji).
- Tilføj eller rediger aktiviteter under fanen "Aktiviteter".

### Data

Al data ligger i `localStorage` på den enkelte enhed. Det betyder:
- Nulstilling af Safari-data sletter opsparingen.
- Appen virker offline efter første åbning.
- Data deles ikke mellem enheder.

## Flytning til eget repo

Hele appen er selvstændig — kopier hele `reward-app/`-mappen til et nyt repo. Der er ingen afhængigheder uden for mappen.

## Tilpasning

Farver og afstande står som CSS-variabler øverst i `index.html` (`:root { --brand: ...; }`). Standard-aktiviteterne (cykel 10/20/30 min) defineres i `defaultState()`-funktionen i samme fil — ret eller fjern efter behov.

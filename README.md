# cq-hjemmeside

Statisk landingsside deployet via Railway. Bilingual: dansk (primær) og engelsk.

## Filstruktur

- `index.html` — dansk version (primær, serveres på `/`)
- `en/index.html` — engelsk version (serveres på `/en/`)
- `serve.json` — routing-regler (path-baseret rewrite for begge sprog)
- `sitemap.xml` — bilingual sitemap med hreflang-annoteringer
- `llms.txt` + `en/llms.txt` — markdown-overblik til LLM crawlers (dansk og engelsk)
- `robots.txt` — crawl-regler
- `assets/` — billeder og media (delt mellem begge sprog)

## Sprog-routing

`serve.json` håndterer fallback til den korrekte SPA-fil:

- `/en` og `/en/*` → `/en/index.html` (engelsk SPA, path-baseret routing)
- alt andet → `/index.html` (dansk SPA, path-baseret routing)

Sprogskift sker via nav-knappen `DA / EN` — hver version peger på den anden sprogversion via hreflang.

## Lokal kørsel

```bash
npm install
npm start
```

Åbn http://localhost:3000 (dansk) eller http://localhost:3000/en/ (engelsk).

## Deploy

Push til `main` på GitHub → Railway bygger automatisk via nixpacks og kører `npm start`.

`npm start` kører `server.js` — en lille Express-server med gzip-komprimering og cache-headers. Det erstattede `serve` så vores 2,3 MB `index.html` shippes komprimeret (~500 KB on the wire) og så statiske assets får sensibel `Cache-Control`. Hash- og path-baserede SPA-ruter falder tilbage til `index.html`.

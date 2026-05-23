# cq-hjemmeside

Statisk landingsside (single `index.html`) deployet via Railway.

## Lokal kørsel

```bash
npm install
npm start
```

Åbn http://localhost:3000

## Deploy

Push til `main` på GitHub → Railway bygger automatisk via nixpacks og kører `npm start`.

`npm start` kører `server.js` — en lille Express-server med gzip-komprimering og cache-headers. Det erstattede `serve` så vores 2,3 MB `index.html` shippes komprimeret (~500 KB on the wire) og så statiske assets får sensibel `Cache-Control`. Hash- og path-baserede SPA-ruter falder tilbage til `index.html`.

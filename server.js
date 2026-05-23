// Minimal Express server with gzip compression and sensible cache headers.
// Replaces `serve` so the 2.3 MB static index.html ships compressed (~500 KB
// over the wire) and so we can set per-asset Cache-Control without a CDN.
// SPA fallback: all non-file routes return index.html — the client-side
// router reads window.location.pathname to swap visible .page-route divs.

const path = require('path');
const express = require('express');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

app.disable('x-powered-by');
app.use(compression({ level: 6, threshold: 1024 }));

app.use(express.static(ROOT, {
    index: false,
    extensions: ['html'],
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        } else if (/\.(webp|avif|jpe?g|png|svg|ico|woff2?)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        } else if (/\.(xml|txt|json)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    },
}));

// SPA fallback: serve index.html for client-side routes (/trivselsmåling, /apv, ...)
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`culturequest.io listening on http://0.0.0.0:${PORT}`);
});

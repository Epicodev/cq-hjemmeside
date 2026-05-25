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

// Canonical host is www.culturequest.io (the domain served by Railway). The
// apex culturequest.io → www redirect is handled upstream at the DNS registrar,
// and the *.up.railway.app duplicate is handled by the <link rel="canonical">
// in index.html — so no host redirect is needed here.

// Security headers. CSP ships as Report-Only first so any missing origin only
// logs to the browser console instead of breaking the site. Once you've
// reloaded a few flows (cookie consent + PostHog, Apollo tracker, Storylane
// demo embeds, jsPDF download) without violations in DevTools > Console,
// rename the header to `Content-Security-Policy` to enforce.
const CSP = [
    "default-src 'self'",
    // 'unsafe-inline' is required because the site has many inline <script>
    // blocks (~50). Migrating to nonces would need a build step.
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://assets.apollo.io",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // data: covers the ~12 inline base64 images. https: stays permissive
    // because various blog/demo content references external imagery.
    "img-src 'self' data: https:",
    "connect-src 'self' https://ytiboqiihekaerznainv.supabase.co https://eu.i.posthog.com https://eu-assets.i.posthog.com https://*.ingest.posthog.com https://app.apollo.io https://assets.apollo.io",
    "frame-src 'self' https://app.storylane.io",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
].join('; ');

app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy-Report-Only', CSP);
    next();
});

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

// Minimal Express server with gzip compression and sensible cache headers.
// Replaces `serve` so the 2.3 MB static index.html ships compressed (~500 KB
// over the wire) and so we can set per-asset Cache-Control without a CDN.
//
// SPA SEO fix (Jun 2026): per-route HTML variants are pre-built at boot so
// every SPA path gets the correct <title>, <meta description>, and
// <link rel="canonical"> in the HTML BEFORE JS runs. Without this Google
// captured the homepage canonical for every sub-page → all sub-pages were
// treated as duplicates of / and never indexed separately.

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ORIGIN = 'https://www.culturequest.io';

app.disable('x-powered-by');
app.use(compression({ level: 6, threshold: 1024 }));

// --- Per-route meta. Keep in sync with PAGE_META in index.html. ---
// These values get injected into the HTML before serving so Googlebot sees
// the correct canonical/title/description without waiting for JS to update.
const ROUTE_META = {
    '/': {
        title: 'Forudse opsigelser før de rammer bundlinjen | culturequest',
        description: 'Predictive culture intelligence til danske virksomheder. Forudse opsigelser, stress og mistrivsel uger før de rammer bundlinjen. APV, MUS, pulsmåling i ét.',
        canonical: ORIGIN + '/',
    },
    '/apv': {
        title: 'APV værktøj · Digital arbejdspladsvurdering | culturequest',
        description: 'APV værktøj der opfylder Arbejdstilsynets krav til arbejdspladsvurdering på 14 dage. Skriftlig dokumentation, handlingsplan, opdatering hvert 3. år.',
        canonical: ORIGIN + '/apv',
    },
    '/1to1': {
        title: 'MUS værktøj for ledere · 1:1-værktøj | culturequest',
        description: 'MUS værktøj bygget til ledere, ikke til HR-arkivet. AI-coach til forberedelse, optagelse, og opfølgning på MUS-samtaler og 1:1\'er. Beta Q3 2026.',
        canonical: ORIGIN + '/1to1',
    },
    '/trivselsmåling': {
        title: 'Trivselsmåling vs. culture intelligence | culturequest',
        description: 'Den årlige trivselsmåling er en fotostat. Culture intelligence fanger mønstrene før de bliver dyre — kontinuerlig kulturmåling.',
        canonical: ORIGIN + '/trivselsmåling',
    },
    '/consult': {
        title: 'Ledelsesudvikling baseret på data | culturequest',
        description: 'Ledelsesudvikling der starter med jeres data. Kurateret netværk af danske kultur-konsulenter til team-coaching, workshops og strategisk kulturarbejde.',
        canonical: ORIGIN + '/consult',
    },
    '/pilotprojekt': {
        title: 'Pilotprogram · alternativ til trivselsmåling | culturequest',
        description: 'Alternativet til den årlige trivselsmåling: 365 dages culture intelligence med ledelsessparring inkluderet. For udvalgte virksomheder.',
        canonical: ORIGIN + '/pilotprojekt',
    },
    '/blog': {
        title: 'Blog · kultur, ledelse og medarbejdertrivsel | culturequest',
        description: 'Ekspertartikler om culture intelligence, APV, MUS-samtaler, trivselsmåling, ledelsesudvikling og datadrevet ledelse.',
        canonical: ORIGIN + '/blog',
    },
    '/about': {
        title: 'Om culturequest | Predictive culture intelligence',
        description: 'culturequest er grundlagt af Benjamin Brandt og Benjamin Laudrup. Vi bygger kultur-analytik til danske virksomheder. Dansk og GDPR-purist.',
        canonical: ORIGIN + '/about',
    },
    '/kontakt': {
        title: 'Kontakt culturequest | Benjamin Brandt og Benjamin Laudrup',
        description: 'Skriv til hej@culturequest.io. Vi er to stiftere, og vi læser alle henvendelser selv. Skriv på dansk eller engelsk — svar inden for 4 timer.',
        canonical: ORIGIN + '/kontakt',
    },
    '/roadmap': {
        title: 'Roadmap | Det vi bygger på culturequest',
        description: 'Åben oversigt over hvor culturequest er på vej hen. Hvad vi bygger nu, hvad der er næste, og hvad der er på radaren. Selvfinansieret og kundedrevet.',
        canonical: ORIGIN + '/roadmap',
    },
    '/demo': {
        title: 'Klikbar demo af culturequest | 2-min produkt-tour',
        description: 'Klik gennem hele culture intelligence-flowet: pulsmåling, kulturscore, AI-anbefalinger og handlingsplan. Ingen tilmelding.',
        canonical: ORIGIN + '/demo',
    },
};

// Aliases — multiple paths that map to the same route.
const ROUTE_ALIASES = {
    '/om': '/about',
    '/contact': '/kontakt',
    '/konsulenter': '/consult',
    '/pilot': '/pilotprojekt',
    '/trivselsmaaling': '/trivselsmåling',
    '/trivsel': '/trivselsmåling',
    '/1-1': '/1to1',
    '/1til1': '/1to1',
};

function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resolveRoute(reqPath) {
    let p = decodeURI(reqPath || '/');
    // Strip trailing slash except root
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    // Try alias mapping first
    if (ROUTE_ALIASES[p]) p = ROUTE_ALIASES[p];
    // Blog post slug
    if (p.startsWith('/blog/')) p = '/blog';
    return ROUTE_META[p] ? p : null;
}

// --- Pre-build per-route HTML at boot ---
const indexHtmlPath = path.join(ROOT, 'index.html');
let baseHtml = '';
const ROUTE_HTML = {};

function rebuildHtml() {
    try {
        baseHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    } catch (e) {
        console.error('[server] Failed to read index.html:', e.message);
        return;
    }
    for (const [route, meta] of Object.entries(ROUTE_META)) {
        let html = baseHtml;
        const t = escapeHtmlAttr(meta.title);
        const d = escapeHtmlAttr(meta.description);
        const c = escapeHtmlAttr(meta.canonical);

        // <title>
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
        // <meta name="description" ...>
        html = html.replace(/<meta\s+name="description"\s+content="[^"]*"/, `<meta name="description" content="${d}"`);
        // <link rel="canonical" ...>
        html = html.replace(/<link\s+rel="canonical"\s+href="[^"]*"/, `<link rel="canonical" href="${c}"`);
        // OG title + description + url
        html = html.replace(/<meta\s+property="og:title"\s+content="[^"]*"/, `<meta property="og:title" content="${t}"`);
        html = html.replace(/<meta\s+property="og:description"\s+content="[^"]*"/, `<meta property="og:description" content="${d}"`);
        html = html.replace(/<meta\s+property="og:url"\s+content="[^"]*"/, `<meta property="og:url" content="${c}"`);
        // Twitter card
        html = html.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"/, `<meta name="twitter:title" content="${t}"`);
        html = html.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"/, `<meta name="twitter:description" content="${d}"`);

        ROUTE_HTML[route] = html;
    }
    console.log(`[server] Pre-built ${Object.keys(ROUTE_HTML).length} route HTML variants`);
}
rebuildHtml();

// In dev, watch for index.html changes so we don't need a restart.
if (process.env.NODE_ENV !== 'production') {
    try {
        fs.watchFile(indexHtmlPath, { interval: 1000 }, () => {
            console.log('[server] index.html changed, rebuilding route variants...');
            rebuildHtml();
        });
    } catch (e) { /* not fatal */ }
}

// Canonical host is www.culturequest.io (the domain served by Railway). The
// apex culturequest.io → www redirect is handled upstream at the DNS registrar,
// and the *.up.railway.app duplicate is handled by the canonical injection above.

// Security headers. CSP ships as Report-Only first so any missing origin only
// logs to the browser console instead of breaking the site. Once you've
// reloaded a few flows (cookie consent + PostHog, Apollo tracker, Storylane
// demo embeds, jsPDF download) without violations in DevTools > Console,
// rename the header to `Content-Security-Policy` to enforce.
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://assets.apollo.io",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
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

// SPA fallback: serve route-specific HTML variant with correct title/canonical.
// Falls back to homepage variant for unknown paths (404-as-home behaviour is
// preserved from previous version, just with correct meta tags).
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const route = resolveRoute(req.path) || '/';
    const html = ROUTE_HTML[route] || ROUTE_HTML['/'];
    if (!html) return res.sendFile(indexHtmlPath);
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.send(html);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`culturequest.io listening on http://0.0.0.0:${PORT}`);
});

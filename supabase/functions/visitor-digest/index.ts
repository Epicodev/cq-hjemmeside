// Supabase Edge Function: visitor-digest
// Daily digest of identified website visitors from Apollo.
//
// FLOW:
//   1. Cron trigger fires once per day (08:00 Europe/Copenhagen)
//   2. Fetches yesterday's identified companies from Apollo Website Visitors API
//   3. Segments by employee count: SMV (10-49) / Mid-market (50-249) / Enterprise (250+)
//   4. Filters by ICP industry (configurable, defaults to knowledge-work industries)
//   5. Sends formatted digest email via Resend to founders
//
// TRIGGER:
//   - Cron (daily): Supabase Cron job hits this function at 06:00 UTC
//   - Manual:       POST/GET https://<project>.functions.supabase.co/visitor-digest
//   - Test mode:    Add ?test=1 to URL — sends sample email without Apollo call
//
// ENV VARS REQUIRED:
//   APOLLO_API_KEY      Apollo Master API key (Settings > Integrations > API)
//                       Note: This is DIFFERENT from the Website Visitor tracker App ID.
//   RESEND_API_KEY      Already configured (re-used from lead-notify)
//   FROM_EMAIL          Already configured (sender address)
//   ALERT_EMAILS        Already configured (comma-separated recipient list)
//
// ENV VARS OPTIONAL:
//   APOLLO_TIME_RANGE   '24h' (default) | '7d' | '30d'
//   ICP_INDUSTRIES      Comma-separated industry keywords to prioritize (default: knowledge-work set)
//   MIN_EMPLOYEES       Lower employee cutoff (default: 10 — filters out micro-orgs/freelancers)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const ALERT_EMAILS = (Deno.env.get("ALERT_EMAILS") || "bvb@culturequest.io")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const APOLLO_TIME_RANGE = Deno.env.get("APOLLO_TIME_RANGE") || "24h";
const MIN_EMPLOYEES = parseInt(Deno.env.get("MIN_EMPLOYEES") || "10", 10);

const DEFAULT_ICP_INDUSTRIES = [
    "saas", "software", "information technology", "internet",
    "professional services", "management consulting",
    "financial services", "banking", "insurance", "venture capital",
    "legal services", "law practice",
    "marketing and advertising", "design",
    "research", "biotechnology", "pharmaceuticals",
    "architecture", "engineering",
    "media production", "publishing",
    "telecommunications",
];
const ICP_INDUSTRIES = (Deno.env.get("ICP_INDUSTRIES") || DEFAULT_ICP_INDUSTRIES.join(","))
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// ============================================================
// Types
// ============================================================

interface ApolloVisitorCompany {
    organization_id?: string;
    name?: string;
    domain?: string;
    industry?: string;
    estimated_num_employees?: number;
    num_employees?: number;
    employees_count?: number;
    country?: string;
    state?: string;
    city?: string;
    /** Pages visited — exact field varies by Apollo plan */
    visited_pages?: string[];
    pages_visited?: string[];
    /** Visit count or session info */
    visit_count?: number;
    visits_count?: number;
    last_visited_at?: string;
    /** Some Apollo responses nest the org */
    organization?: {
        id?: string;
        name?: string;
        primary_domain?: string;
        industry?: string;
        estimated_num_employees?: number;
        country?: string;
    };
}

interface SegmentedCompany {
    name: string;
    domain: string;
    industry: string;
    employees: number;
    country: string;
    visits: number;
    pages: string[];
    apolloUrl: string;
    organizationId: string;
}

type Segment = "smv" | "mid" | "enterprise";

interface Segments {
    smv: SegmentedCompany[];
    mid: SegmentedCompany[];
    enterprise: SegmentedCompany[];
}

const SEGMENT_LABELS: Record<Segment, string> = {
    smv: "SMV (10-49 ansatte)",
    mid: "Mid-market (50-249 ansatte)",
    enterprise: "Enterprise (250+ ansatte)",
};

const SEGMENT_EMOJI: Record<Segment, string> = {
    smv: "🟢",
    mid: "🟡",
    enterprise: "🔵",
};

// ============================================================
// Apollo API
// ============================================================

/**
 * Fetch website visitor companies from Apollo.
 *
 * NOTE: Apollo's exact endpoint for Website Visitors varies by plan version.
 * The most common endpoint is `POST /api/v1/website_visitor_searches/search`.
 * If your plan exposes a different endpoint, update APOLLO_ENDPOINT below.
 */
async function fetchApolloVisitors(): Promise<ApolloVisitorCompany[]> {
    if (!APOLLO_API_KEY) {
        throw new Error("APOLLO_API_KEY not configured");
    }

    const APOLLO_ENDPOINT = "https://api.apollo.io/api/v1/website_visitor_searches/search";

    const body = {
        page: 1,
        per_page: 100,
        time_range: APOLLO_TIME_RANGE,
        sort_by_field: "last_visited_at",
        sort_ascending: false,
    };

    const res = await fetch(APOLLO_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "x-api-key": APOLLO_API_KEY,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Apollo API ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    // Apollo response shape varies — handle both wrapping and direct array
    const companies = (data.website_visitors || data.companies || data.results || data.organizations || []) as ApolloVisitorCompany[];
    return companies;
}

// ============================================================
// Segmenting + ICP filtering
// ============================================================

function normalizeCompany(c: ApolloVisitorCompany): SegmentedCompany | null {
    const org = c.organization || {};
    const name = c.name || org.name || "";
    const domain = c.domain || org.primary_domain || "";
    const industry = (c.industry || org.industry || "").toLowerCase();
    const employees = c.estimated_num_employees
        || c.num_employees
        || c.employees_count
        || org.estimated_num_employees
        || 0;
    const country = c.country || org.country || "";
    const visits = c.visit_count || c.visits_count || 1;
    const pages = c.visited_pages || c.pages_visited || [];
    const orgId = c.organization_id || org.id || "";

    if (!name && !domain) return null;
    if (employees > 0 && employees < MIN_EMPLOYEES) return null;

    const apolloUrl = orgId
        ? `https://app.apollo.io/#/accounts/${orgId}/overview`
        : `https://app.apollo.io/#/websites?tab=companies&q=${encodeURIComponent(domain || name)}`;

    return {
        name,
        domain,
        industry,
        employees,
        country,
        visits,
        pages,
        apolloUrl,
        organizationId: orgId,
    };
}

function matchesICP(industry: string): boolean {
    if (!industry) return true; // Don't filter out unknowns — they may be relevant
    return ICP_INDUSTRIES.some((kw) => industry.includes(kw));
}

function segmentByEmployees(companies: SegmentedCompany[]): Segments {
    const segments: Segments = { smv: [], mid: [], enterprise: [] };
    for (const c of companies) {
        if (c.employees >= 250) segments.enterprise.push(c);
        else if (c.employees >= 50) segments.mid.push(c);
        else if (c.employees >= 10) segments.smv.push(c);
        // <10 already filtered in normalize
    }
    return segments;
}

// ============================================================
// Email rendering
// ============================================================

function escapeHtml(s: unknown): string {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[c]!);
}

function renderCompanyRow(c: SegmentedCompany): string {
    const pagesStr = c.pages.length > 0
        ? c.pages.slice(0, 4).map((p) => escapeHtml(p)).join(" · ")
        : "—";
    const meta = [
        c.industry ? c.industry.replace(/^\w/, (l) => l.toUpperCase()) : null,
        c.employees ? `${c.employees} ansatte` : null,
        c.country || null,
    ].filter(Boolean).join(" · ");

    return `
    <tr>
        <td style="padding: 14px 0; border-bottom: 1px solid #f0f0f5; vertical-align: top;">
            <div style="font-size: 15px; font-weight: 700; color: #1a1c2c; letter-spacing: -0.01em; margin-bottom: 4px;">${escapeHtml(c.name || c.domain)}</div>
            <div style="font-size: 12.5px; color: #6f7090; margin-bottom: 8px;">${escapeHtml(meta)}</div>
            <div style="font-size: 12px; color: #4a4c66; margin-bottom: 8px;">
                <span style="color: #9a9caf;">Besøg:</span> ${c.visits} · <span style="color: #9a9caf;">Sider:</span> ${pagesStr}
            </div>
            <a href="${escapeHtml(c.apolloUrl)}" style="display: inline-block; padding: 6px 12px; background: #383da0; color: #fff; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 600;">Find kontakter i Apollo →</a>
        </td>
    </tr>`;
}

function renderSegment(segment: Segment, companies: SegmentedCompany[]): string {
    if (companies.length === 0) {
        return `
        <h3 style="font-size: 14px; font-weight: 700; color: #1a1c2c; margin: 28px 0 6px;">${SEGMENT_EMOJI[segment]} ${escapeHtml(SEGMENT_LABELS[segment])}</h3>
        <p style="font-size: 13px; color: #9a9caf; margin: 0 0 8px;">Ingen identificerede besøg i gårs digest.</p>`;
    }
    return `
    <h3 style="font-size: 14px; font-weight: 700; color: #1a1c2c; margin: 28px 0 6px;">${SEGMENT_EMOJI[segment]} ${escapeHtml(SEGMENT_LABELS[segment])} <span style="color: #9a9caf; font-weight: 500;">(${companies.length})</span></h3>
    <table style="width: 100%; border-collapse: collapse;">
        ${companies.map(renderCompanyRow).join("")}
    </table>`;
}

function buildDigestEmail(segments: Segments, dateLabel: string): string {
    const total = segments.smv.length + segments.mid.length + segments.enterprise.length;
    const summary = total === 0
        ? "Ingen identificerede leads i gårs digest. Apollo har ikke matchet besøgende firmaer i den valgte periode."
        : `${total} firmaer matchede jeres ICP-filter (10+ ansatte · relevant industri).`;

    return `<!DOCTYPE html>
<html lang="da"><head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1a1c2c; background: #fff;">
    <p style="font-size: 12px; color: #4f53cc; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: 0 0 6px;">📊 Daglig digest · ${escapeHtml(dateLabel)}</p>
    <h2 style="font-size: 22px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.015em;">Besøgende firmaer på culturequest.io</h2>
    <p style="font-size: 14px; color: #4a4c66; line-height: 1.6; margin: 0 0 8px;">${escapeHtml(summary)}</p>

    ${renderSegment("enterprise", segments.enterprise)}
    ${renderSegment("mid", segments.mid)}
    ${renderSegment("smv", segments.smv)}

    <hr style="border: 0; border-top: 1px solid #e0e0e8; margin: 32px 0 16px;">
    <p style="font-size: 12px; color: #9a9caf; margin: 0;">
        Du modtager denne digest dagligt kl. 08:00. ICP-filter: ${MIN_EMPLOYEES}+ ansatte · ${ICP_INDUSTRIES.length} industri-keywords.
        Justér via Supabase env vars: <code>MIN_EMPLOYEES</code>, <code>ICP_INDUSTRIES</code>, <code>APOLLO_TIME_RANGE</code>.
    </p>
    <p style="font-size: 12px; color: #9a9caf; margin: 12px 0 0;">
        <a href="https://app.apollo.io/#/websites?tab=companies" style="color: #4f53cc;">Åbn fuld liste i Apollo →</a>
    </p>
</body></html>`;
}

// ============================================================
// Test fixtures (used when ?test=1)
// ============================================================

function buildTestSegments(): Segments {
    return {
        enterprise: [{
            name: "Maersk",
            domain: "maersk.com",
            industry: "transportation",
            employees: 80000,
            country: "Denmark",
            visits: 3,
            pages: ["/", "/priser", "/pilotprojekt"],
            apolloUrl: "https://app.apollo.io/#/accounts/fake-1/overview",
            organizationId: "fake-1",
        }],
        mid: [{
            name: "SLA Landskabsarkitekter",
            domain: "sla.dk",
            industry: "architecture",
            employees: 120,
            country: "Denmark",
            visits: 5,
            pages: ["/apv", "/priser", "/1to1", "/consult"],
            apolloUrl: "https://app.apollo.io/#/accounts/fake-2/overview",
            organizationId: "fake-2",
        }, {
            name: "Trustpilot",
            domain: "trustpilot.com",
            industry: "internet",
            employees: 200,
            country: "Denmark",
            visits: 2,
            pages: ["/", "/trivselsmaaling"],
            apolloUrl: "https://app.apollo.io/#/accounts/fake-3/overview",
            organizationId: "fake-3",
        }],
        smv: [{
            name: "Bouvet Studios",
            domain: "bouvet.dk",
            industry: "marketing and advertising",
            employees: 25,
            country: "Denmark",
            visits: 4,
            pages: ["/apv", "/pilotprojekt", "/priser"],
            apolloUrl: "https://app.apollo.io/#/accounts/fake-4/overview",
            organizationId: "fake-4",
        }],
    };
}

// ============================================================
// Resend send
// ============================================================

async function sendEmail(payload: Record<string, unknown>): Promise<unknown> {
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Resend ${res.status}: ${text}`);
    }
    return res.json();
}

// ============================================================
// Main handler
// ============================================================

serve(async (req) => {
    const url = new URL(req.url);
    const isTest = url.searchParams.get("test") === "1";

    if (!RESEND_API_KEY) {
        return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    const dateLabel = new Date().toLocaleDateString("da-DK", {
        weekday: "long",
        day: "numeric",
        month: "long",
    });

    let segments: Segments;
    let total = 0;

    if (isTest) {
        segments = buildTestSegments();
        total = segments.smv.length + segments.mid.length + segments.enterprise.length;
    } else {
        try {
            const raw = await fetchApolloVisitors();
            const normalized = raw
                .map(normalizeCompany)
                .filter((c): c is SegmentedCompany => c !== null)
                .filter((c) => matchesICP(c.industry));
            segments = segmentByEmployees(normalized);
            total = normalized.length;
        } catch (e) {
            return new Response(JSON.stringify({
                ok: false,
                error: (e as Error).message,
                hint: "Verify APOLLO_API_KEY is set and your Apollo plan exposes the Website Visitors API. Some plans require Professional tier.",
            }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    }

    const subject = total === 0
        ? `📊 Ingen identificerede leads i går — ${dateLabel}`
        : `🔥 ${total} nye potentielle leads i går — ${dateLabel}${isTest ? " (TEST)" : ""}`;

    try {
        await sendEmail({
            from: `culturequest digest <${FROM_EMAIL}>`,
            to: ALERT_EMAILS,
            subject,
            html: buildDigestEmail(segments, dateLabel),
        });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({
        ok: true,
        total,
        segments: {
            smv: segments.smv.length,
            mid: segments.mid.length,
            enterprise: segments.enterprise.length,
        },
        test: isTest,
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});

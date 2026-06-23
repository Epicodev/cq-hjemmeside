// Supabase Edge Function: hot-visitor-notify
// Triggered by client-side intent scoring (in index.html) when a visitor
// crosses a behavioural intent threshold. Sends ONE email per visitor per
// 24h cooldown so the founders can act on warm-but-anonymous prospects.
//
// PAYLOAD (from client):
//   {
//     distinct_id, intent_score, signals: [{event, points, ts}, ...],
//     page_url, referrer, user_agent,
//     posthog_session_url, utm: {...}
//   }
//
// ENV VARS:
//   RESEND_API_KEY, FROM_EMAIL, ALERT_EMAILS (all shared with lead-notify)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const ALERT_EMAILS = (Deno.env.get("ALERT_EMAILS") || "bvb@culturequest.io")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

interface IntentSignal {
    event: string;
    points: number;
    ts?: string;
}

interface HotVisitorPayload {
    distinct_id?: string;
    intent_score?: number;
    signals?: IntentSignal[];
    page_url?: string;
    referrer?: string | null;
    user_agent?: string | null;
    posthog_session_url?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
}

function escapeHtml(s: unknown): string {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[c]!);
}

function buildHotVisitorEmail(p: HotVisitorPayload): string {
    const signals = p.signals || [];
    const signalRows = signals.slice(0, 20)
        .map((s) =>
            `<tr>
                <td style="padding: 6px 12px 6px 0; color: #4f53cc; font-family: 'JetBrains Mono', monospace; font-size: 13px;">+${escapeHtml(s.points)}</td>
                <td style="padding: 6px 0; font-family: 'JetBrains Mono', monospace; font-size: 13px;">${escapeHtml(s.event)}</td>
            </tr>`
        )
        .join("");

    const utmRows = [
        p.utm_source && ["UTM source", p.utm_source],
        p.utm_medium && ["UTM medium", p.utm_medium],
        p.utm_campaign && ["UTM campaign", p.utm_campaign],
    ].filter(Boolean) as [string, string][];

    const utmHtml = utmRows.length > 0
        ? `<h3 style="font-size: 12px; color: #6f7090; text-transform: uppercase; letter-spacing: 0.06em; margin: 24px 0 8px; font-weight: 600;">Attribution</h3>
           <table style="width: 100%; font-size: 14px; line-height: 1.6;">
               ${utmRows.map(([k, v]) => `<tr><td style="padding: 4px 0; color: #6f7090; width: 140px;">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}
           </table>`
        : "";

    const sessionLink = p.posthog_session_url
        ? `<p style="margin: 24px 0 0;">
               <a href="${escapeHtml(p.posthog_session_url)}" style="display: inline-block; padding: 11px 20px; background: #383da0; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">Se session replay i PostHog →</a>
           </p>`
        : "";

    return `<!DOCTYPE html>
<html lang="da"><head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1e1b4b; background: #fff;">
    <p style="font-size: 12px; color: #c26a4c; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: 0 0 8px;">🔥 Hot visitor på culturequest.io</p>
    <h2 style="font-size: 28px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.025em;">Intent score: ${escapeHtml(p.intent_score ?? 0)}</h2>
    <p style="font-size: 14px; color: #6f7090; margin: 0 0 24px;">Visitor ${escapeHtml((p.distinct_id || "").slice(0, 20))}... har lige passeret intent-threshold.</p>

    <table style="width: 100%; font-size: 14px; line-height: 1.7; border-collapse: collapse; margin-bottom: 16px;">
        <tr><td style="padding: 6px 0; color: #6f7090; width: 140px; vertical-align: top;">Aktuel side</td><td style="font-weight: 600; word-break: break-all;">${escapeHtml(p.page_url || "—")}</td></tr>
        <tr><td style="padding: 6px 0; color: #6f7090; vertical-align: top;">Henvist fra</td><td style="word-break: break-all;">${escapeHtml(p.referrer || "direct")}</td></tr>
        <tr><td style="padding: 6px 0; color: #6f7090; vertical-align: top;">Device</td><td style="font-size: 12px; word-break: break-all;">${escapeHtml((p.user_agent || "").slice(0, 100))}</td></tr>
    </table>

    <h3 style="font-size: 12px; color: #6f7090; text-transform: uppercase; letter-spacing: 0.06em; margin: 24px 0 8px; font-weight: 600;">Intent signals der trigged alerten</h3>
    <table style="width: 100%; border-collapse: collapse; background: #f5efe2; border-radius: 8px; padding: 8px;">
        ${signalRows || '<tr><td style="padding: 12px;">Ingen signals registered (test trigger?)</td></tr>'}
    </table>

    ${utmHtml}

    ${sessionLink}

    <p style="margin: 16px 0 0;">
        <a href="https://app.apollo.io/#/engagement/website-visitors" style="display: inline-block; padding: 11px 20px; background: #c26a4c; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">Åbn Apollo Website Visitors →</a>
    </p>

    <p style="font-size: 12px; color: #6f7090; margin: 16px 0 0; padding-top: 16px; border-top: 1px solid #e0e0e8;">
        Apollo identificerer typisk 25-40 % af B2B-trafik via reverse-IP. Filtrer på <strong>"Last 1 hour"</strong> eller <strong>"Today"</strong> for at finde den session der lige trigged denne alert. Hvis Apollo ikke har match, er det enten privat-IP, VPN, mobil-IP, eller et firma uden i Apollos database.
    </p>
</body></html>`;
}

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

serve(async (req) => {
    // CORS headers — client-side fetch needs these
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!RESEND_API_KEY) {
        return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    let payload: HotVisitorPayload;
    try {
        payload = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    if (!payload.distinct_id || typeof payload.intent_score !== "number") {
        return new Response(JSON.stringify({ error: "Missing distinct_id or intent_score" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        await sendEmail({
            from: `culturequest hot-visitor <${FROM_EMAIL}>`,
            to: ALERT_EMAILS,
            subject: `🔥 Hot visitor (intent ${payload.intent_score}) på ${(payload.page_url || "").replace(/^https?:\/\/[^/]+/, "")}`,
            html: buildHotVisitorEmail(payload),
        });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});

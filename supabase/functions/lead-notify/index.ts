// Supabase Edge Function: lead-notify
// Triggered by Database Webhook on INSERT to public.leads.
// Sends ONE email via Resend: alert to the founders with full lead context.
// Lead confirmation is intentionally skipped — culturequest does manual outbound
// follow-up, so an automated "thanks" email would feel hollow.
//
// NOTE: Until culturequest.io is verified in Resend, ALERT_EMAILS is restricted
// to bvb@culturequest.io (the Resend account email). After domain verification,
// add bbl@culturequest.io via the ALERT_EMAILS env var.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const ALERT_EMAILS = (Deno.env.get("ALERT_EMAILS") || "bvb@culturequest.io")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const SUPABASE_PROJECT_REF = Deno.env.get("SUPABASE_PROJECT_REF") || "ytiboqiihekaerznainv";

interface Lead {
    id: string;
    created_at: string;
    email: string;
    source: string;
    page_url?: string | null;
    referrer?: string | null;
    user_agent?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_term?: string | null;
    utm_content?: string | null;
    metadata?: Record<string, unknown> | null;
}

interface SourceInfo {
    label: string;
    subject: string;
    greeting: string;
    body: string;
}

const SOURCE_INFO: Record<string, SourceInfo> = {
    "footer-guide-opsigelse": {
        label: "Footer guide (opsigelse 6-8 uger)",
        subject: "Din guide: Sådan ser du opsigelsen 6-8 uger før den sker",
        greeting: "Tak for din tilmelding",
        body: "Som lovet sender vi guiden til dig. 24 sider med konkrete signaler, datapunkter og leder-tjekliste — bygget på culture intelligence-data fra danske SMV'er.",
    },
    "1to1-beta-signup": {
        label: "1:1 Beta-tilmelding",
        subject: "Du er på listen — culturequest 1:1 & MUS-værktøj",
        greeting: "Du er på listen",
        body: "Vi vender tilbage så snart vi åbner early access til 1:1 & MUS-værktøjet. Du bliver én af de første der prøver det.",
    },
    "apv-cycle": {
        label: "APV-cycle (med svar)",
        subject: "Din skræddersyede APV-anbefaling",
        greeting: "Tak for at gennemføre APV-tjekket",
        body: "Baseret på dine svar har vi sammensat en anbefaling skræddersyet til jeres organisation. Vi vender tilbage med en konkret plan inden for et par dage.",
    },
    "mus-skabelon": {
        label: "MUS-skabelon download",
        subject: "Din MUS-skabelon (12 sider)",
        greeting: "Tak for din interesse",
        body: "Som lovet sender vi MUS-skabelonen til dig. Den indeholder skabelon, spørgsmålsbank og forberedelses-tjekliste til både leder og medarbejder.",
    },
    "trivselsmaaling-guide": {
        label: "Trivselsmåling-guide download",
        subject: "Din guide: Forskellen på trivselsmåling og culture intelligence",
        greeting: "Tak for din tilmelding",
        body: "Som lovet sender vi guiden til dig. 24 sider med konkrete signaler, datapunkter og leder-tjekliste der viser hvad culture intelligence ser, men trivselsmåling ikke fanger.",
    },
    "demo-page-unlock": {
        label: "Demo gate unlock (live demo-side)",
        subject: "Tak for at åbne demoen",
        greeting: "Tak for at åbne demoen",
        body: "Du har nu fuld adgang til den interaktive produkt-tour. Vi vender tilbage med en kort follow-up inden for et par dage.",
    },
};

function escapeHtml(s: unknown): string {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[c]!);
}

function buildLeadEmail(_lead: Lead, info: SourceInfo): string {
    return `<!DOCTYPE html>
<html lang="da"><head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1c2c; background: #fff;">
    <h2 style="font-size: 22px; font-weight: 700; letter-spacing: -0.015em; margin: 0 0 16px;">${escapeHtml(info.greeting)}</h2>
    <p style="font-size: 16px; line-height: 1.6; color: #2a2c40; margin: 0 0 16px;">${escapeHtml(info.body)}</p>
    <p style="font-size: 16px; line-height: 1.6; color: #2a2c40; margin: 0 0 24px;">Vi vender tilbage hvis du har spørgsmål — du kan altid svare direkte på denne mail.</p>
    <p style="font-size: 14px; color: #6f7090; margin: 28px 0 0;">— Benjamin &amp; Benjamin, culturequest</p>
    <hr style="border: 0; border-top: 1px solid #e0e0e8; margin: 28px 0 16px;">
    <p style="font-size: 12px; color: #9a9caf; margin: 0;">Du modtog denne mail fordi du tilmeldte dig på culturequest.io. Du kan altid afmelde ved at svare på denne mail.</p>
</body></html>`;
}

function buildAlertEmail(lead: Lead, info: SourceInfo): string {
    const metaHtml = lead.metadata
        ? `<pre style="background: #f5f5fa; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; margin: 0;">${escapeHtml(JSON.stringify(lead.metadata, null, 2))}</pre>`
        : "";

    const utmRows = [
        lead.utm_source && ["UTM source", lead.utm_source],
        lead.utm_medium && ["UTM medium", lead.utm_medium],
        lead.utm_campaign && ["UTM campaign", lead.utm_campaign],
        lead.utm_term && ["UTM term", lead.utm_term],
        lead.utm_content && ["UTM content", lead.utm_content],
    ].filter(Boolean) as [string, string][];

    const utmHtml = utmRows.length > 0
        ? `<h3 style="font-size: 12px; color: #6f7090; text-transform: uppercase; letter-spacing: 0.06em; margin: 24px 0 8px; font-weight: 600;">UTM</h3>
           <table style="width: 100%; font-size: 14px; line-height: 1.6;">
               ${utmRows.map(([k, v]) => `<tr><td style="padding: 4px 0; color: #6f7090; width: 140px;">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}
           </table>`
        : "";

    return `<!DOCTYPE html>
<html lang="da"><head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1a1c2c; background: #fff;">
    <p style="font-size: 12px; color: #4f53cc; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: 0 0 8px;">🔥 Ny lead på culturequest.io</p>
    <h2 style="font-size: 24px; font-weight: 700; margin: 0 0 24px; word-break: break-all; letter-spacing: -0.015em;">${escapeHtml(lead.email)}</h2>

    <table style="width: 100%; font-size: 14px; line-height: 1.7; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; color: #6f7090; width: 140px; vertical-align: top;">Kilde</td><td style="font-weight: 600;">${escapeHtml(info.label)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6f7090; vertical-align: top;">Tid</td><td>${escapeHtml(new Date(lead.created_at).toLocaleString("da-DK", { dateStyle: "full", timeStyle: "short" }))}</td></tr>
        <tr><td style="padding: 6px 0; color: #6f7090; vertical-align: top;">Side</td><td style="word-break: break-all;">${escapeHtml(lead.page_url || "—")}</td></tr>
        <tr><td style="padding: 6px 0; color: #6f7090; vertical-align: top;">Henvist fra</td><td style="word-break: break-all;">${escapeHtml(lead.referrer || "direct")}</td></tr>
    </table>

    ${utmHtml}

    ${metaHtml ? `<h3 style="font-size: 12px; color: #6f7090; text-transform: uppercase; letter-spacing: 0.06em; margin: 24px 0 8px; font-weight: 600;">Form-data</h3>${metaHtml}` : ""}

    <p style="margin: 32px 0 0;">
        <a href="https://supabase.com/dashboard/project/${escapeHtml(SUPABASE_PROJECT_REF)}/editor" style="display: inline-block; padding: 11px 20px; background: #383da0; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">Åbn alle leads i Supabase →</a>
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
    if (!RESEND_API_KEY) {
        return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    let payload: { record?: Lead; type?: string };
    try {
        payload = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const lead = payload.record;
    if (!lead || !lead.email || !lead.source) {
        return new Response(JSON.stringify({ error: "Missing lead fields" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const info: SourceInfo = SOURCE_INFO[lead.source] || {
        label: lead.source,
        subject: "Tak for din tilmelding hos culturequest",
        greeting: "Tak for din tilmelding",
        body: "Vi vender tilbage hurtigst muligt.",
    };

    // Alert email to founders. Lead confirmation is intentionally not sent —
    // culturequest follows up manually so an automated "thanks" feels hollow.
    try {
        await sendEmail({
            from: `culturequest leads <${FROM_EMAIL}>`,
            to: ALERT_EMAILS,
            subject: `🔥 Ny lead: ${lead.email} via ${info.label}`,
            html: buildAlertEmail(lead, info),
            reply_to: lead.email,
        });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});

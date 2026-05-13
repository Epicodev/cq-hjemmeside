# visitor-digest

Daglig email-digest af identificerede website-visitors fra Apollo.

## Hvordan det virker

1. Cron fires kl. 06:00 UTC (08:00 Europe/Copenhagen)
2. Henter sidste 24 timers identificerede firmaer fra Apollo Website Visitors API
3. Segmenterer i SMV (10-49) / Mid-market (50-249) / Enterprise (250+)
4. Filtrerer på ICP-industrier (knowledge-work brancher som default)
5. Sender én formateret email via Resend til `ALERT_EMAILS`

## Setup

### 1. Hent Apollo Master API Key

> **NB**: Dette er ANDET key end Website Visitor tracker App ID i index.html.

I Apollo:
1. Settings → Integrations
2. Find **"Apollo API"** sektionen
3. Klik **Create new API key**
4. Navn: `culturequest-digest`
5. Kopier nøglen (vises kun én gang)

### 2. Sæt environment variables i Supabase

```bash
supabase secrets set APOLLO_API_KEY=<paste-apollo-key>

# Eventuelt — overriders for default-værdier
supabase secrets set ALERT_EMAILS="bvb@culturequest.io,bbl@culturequest.io"
supabase secrets set APOLLO_TIME_RANGE="24h"
supabase secrets set MIN_EMPLOYEES="10"
```

`RESEND_API_KEY`, `FROM_EMAIL` og `ALERT_EMAILS` er allerede sat (deles med `lead-notify`).

### 3. Deploy

```bash
supabase functions deploy visitor-digest --project-ref <ref>
```

### 4. Test pipelinen

Manuelt test med sample data (kalder ikke Apollo):

```bash
curl "https://<project-ref>.functions.supabase.co/visitor-digest?test=1"
```

Du skulle modtage en email med 4 fake firmaer fordelt på 3 segmenter — bekræfter at Resend-template virker.

Test med rigtige Apollo-data:

```bash
curl "https://<project-ref>.functions.supabase.co/visitor-digest"
```

### 5. Opsæt daglig cron

I Supabase Dashboard → Database → Cron Jobs (eller `pg_cron`):

```sql
SELECT cron.schedule(
    'visitor-digest-daily',
    '0 6 * * *',  -- 06:00 UTC = 08:00 Europe/Copenhagen
    $$
    SELECT net.http_post(
        url := 'https://<project-ref>.functions.supabase.co/visitor-digest',
        headers := '{"Content-Type": "application/json"}'::jsonb
    );
    $$
);
```

## Env vars

| Variabel | Default | Beskrivelse |
|---|---|---|
| `APOLLO_API_KEY` | *(required)* | Apollo Master API key |
| `RESEND_API_KEY` | *(required)* | Re-used fra lead-notify |
| `FROM_EMAIL` | `onboarding@resend.dev` | Sender |
| `ALERT_EMAILS` | `bvb@culturequest.io` | Komma-separeret modtagere |
| `APOLLO_TIME_RANGE` | `24h` | `24h` / `7d` / `30d` |
| `MIN_EMPLOYEES` | `10` | Cutoff for micro-firmaer |
| `ICP_INDUSTRIES` | *(knowledge-work)* | Komma-separeret industri-keywords |

## Default ICP-industrier

`saas, software, information technology, internet, professional services, management consulting, financial services, banking, insurance, venture capital, legal services, law practice, marketing and advertising, design, research, biotechnology, pharmaceuticals, architecture, engineering, media production, publishing, telecommunications`

## Troubleshooting

**`Apollo API 401`**: Forkert API key, eller key mangler `website_visitors`-scope.

**`Apollo API 404`**: Endpoint findes ikke på din plan. Website Visitors API kræver ofte Professional+. Verificér ved at gå til Apollo Settings → API → check tilgængelige scopes.

**Email kommer ikke**: Tjek Resend-dashboardet for fejl. Pre-launch må afsender-email kun være `bvb@culturequest.io` indtil culturequest.io er verificeret i Resend.

**Tom digest hver dag**: Apollo har ikke matchet trafik — enten ingen besøgende, eller tracking-pixel ikke aktiv. Verificér via Apollo dashboard → Website Visitors → "Visitors will only show up after data flows in (24h)".

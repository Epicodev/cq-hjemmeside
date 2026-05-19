#!/usr/bin/env python3
"""
Build culturequest PostHog dashboards via API.

Idempotent-ish: each run creates a fresh set of dashboards. Old ones aren't
deleted automatically. Re-run only after deleting the old set in PostHog if
you want a clean slate.

Usage:
    POSTHOG_API_KEY=phx_... POSTHOG_PROJECT_ID=182402 python build_posthog_dashboards.py

Env:
    POSTHOG_HOST defaults to https://eu.posthog.com
"""
import json
import os
import sys
import urllib.request
import urllib.error

API_KEY = os.environ.get("POSTHOG_API_KEY")
PROJECT_ID = os.environ.get("POSTHOG_PROJECT_ID")
HOST = os.environ.get("POSTHOG_HOST", "https://eu.posthog.com")

if not API_KEY or not PROJECT_ID:
    print("Missing POSTHOG_API_KEY or POSTHOG_PROJECT_ID env vars", file=sys.stderr)
    sys.exit(1)

BASE = f"{HOST}/api/projects/{PROJECT_ID}"


def req(method: str, path: str, body=None):
    url = f"{BASE}{path}"
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {API_KEY}")
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"HTTPError {e.code} on {method} {path}: {body_text[:300]}", file=sys.stderr)
        raise


def create_dashboard(name: str, description: str, tags=None) -> int:
    body = {"name": name, "description": description, "pinned": False, "tags": tags or []}
    r = req("POST", "/dashboards/", body)
    print(f"  Dashboard #{r['id']}: {name}")
    return r["id"]


def create_insight(name: str, dashboard_id: int, query: dict, description: str = "") -> int:
    body = {
        "name": name,
        "description": description,
        "dashboards": [dashboard_id],
        "query": query,
        "saved": True,
    }
    r = req("POST", "/insights/", body)
    print(f"    Insight #{r['id']}: {name}")
    return r["id"]


def create_cohort(name: str, groups: list, is_static=False) -> int:
    body = {
        "name": name,
        "is_static": is_static,
        "groups": groups,
    }
    r = req("POST", "/cohorts/", body)
    print(f"  Cohort #{r['id']}: {name}")
    return r["id"]


# === Query helpers (HogQL-based InsightVizNode payloads) ===

def trends_query(series, breakdown=None, date_from="-30d", interval="day",
                 display="ActionsLineGraph", filter_test_accounts=False):
    """
    series: list of dicts like {"event": "$pageview", "math": "total"}
    breakdown: {"breakdown_type": "event", "breakdown": "$pathname"}  (or "person", etc)
    """
    source = {
        "kind": "TrendsQuery",
        "series": [
            {
                "kind": "EventsNode",
                "event": s["event"],
                "math": s.get("math", "total"),
                **({"properties": s["properties"]} if s.get("properties") else {}),
            }
            for s in series
        ],
        "interval": interval,
        "dateRange": {"date_from": date_from},
        "trendsFilter": {"display": display},
        "filterTestAccounts": filter_test_accounts,
    }
    if breakdown:
        source["breakdownFilter"] = breakdown
    return {"kind": "InsightVizNode", "source": source}


def funnel_query(steps, date_from="-30d", funnel_window_days=7, filter_test_accounts=False,
                 breakdown=None):
    """
    steps: list of {"event": "...", "name": "..."} dicts in order.
    """
    source = {
        "kind": "FunnelsQuery",
        "series": [
            {"kind": "EventsNode", "event": s["event"], "name": s.get("name", s["event"]),
             **({"properties": s["properties"]} if s.get("properties") else {})}
            for s in steps
        ],
        "dateRange": {"date_from": date_from},
        "funnelsFilter": {
            "funnelWindowInterval": funnel_window_days,
            "funnelWindowIntervalUnit": "day",
            "funnelVizType": "steps",
        },
        "filterTestAccounts": filter_test_accounts,
    }
    if breakdown:
        source["breakdownFilter"] = breakdown
    return {"kind": "InsightVizNode", "source": source}


def retention_query(target_event="$pageview", returning_event="$pageview",
                    period="Week", date_from="-60d", filter_test_accounts=False):
    return {
        "kind": "InsightVizNode",
        "source": {
            "kind": "RetentionQuery",
            "retentionFilter": {
                "period": period,
                "totalIntervals": 8,
                "targetEntity": {"id": target_event, "name": target_event, "type": "events"},
                "returningEntity": {"id": returning_event, "name": returning_event, "type": "events"},
                "retentionType": "retention_first_time",
            },
            "dateRange": {"date_from": date_from},
            "filterTestAccounts": filter_test_accounts,
        }
    }


# === Build dashboards ===

print("Building dashboards on project", PROJECT_ID, "@", HOST)
print()

# ---------- Dashboard 1: Realtid ----------
print("[1/6] Realtid")
d1 = create_dashboard("📈 Realtid", "Live visitors, top sider og kilder lige nu.", tags=["realtid"])

create_insight(
    "Live visitors (24h)",
    d1,
    trends_query(
        series=[{"event": "$pageview", "math": "dau"}],
        date_from="-24h",
        interval="hour",
    ),
)
create_insight(
    "Top sider i dag",
    d1,
    trends_query(
        series=[{"event": "$pageview"}],
        breakdown={"breakdown_type": "event", "breakdown": "$pathname"},
        date_from="-1d",
        display="ActionsTable",
    ),
)
create_insight(
    "Top kilder (referrer)",
    d1,
    trends_query(
        series=[{"event": "$pageview"}],
        breakdown={"breakdown_type": "event", "breakdown": "$referring_domain"},
        date_from="-7d",
        display="ActionsTable",
    ),
)
create_insight(
    "Leads sidste 7 dage",
    d1,
    trends_query(
        series=[{"event": "lead_captured"}],
        date_from="-7d",
        interval="day",
        display="ActionsBar",
    ),
)
create_insight(
    "Pageviews-trend (24h interval)",
    d1,
    trends_query(
        series=[{"event": "$pageview", "math": "total"}],
        date_from="-30d",
        interval="day",
    ),
)

# ---------- Dashboard 2: Lead funnel master ----------
print("[2/6] Lead funnel master")
d2 = create_dashboard("🎯 Lead funnel master", "Den vigtigste — pageview → engagement → lead.",
                      tags=["leads", "funnel"])

create_insight(
    "Master funnel (visit → engaged → lead)",
    d2,
    funnel_query(
        steps=[
            {"event": "$pageview", "name": "Visit"},
            {"event": "page_engaged", "name": "Engaged (30s+)"},
            {"event": "lead_captured", "name": "Lead captured"},
        ],
        funnel_window_days=7,
    ),
)
create_insight(
    "Lead capture per source",
    d2,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "event", "breakdown": "source"},
        date_from="-30d",
        display="ActionsBar",
    ),
)
create_insight(
    "Leads per dag",
    d2,
    trends_query(
        series=[{"event": "lead_captured"}],
        date_from="-30d",
        interval="day",
    ),
)
create_insight(
    "Conversion rate per landing page (lead vs pageview)",
    d2,
    trends_query(
        series=[
            {"event": "$pageview"},
            {"event": "lead_captured"},
        ],
        breakdown={"breakdown_type": "event", "breakdown": "$pathname"},
        date_from="-30d",
        display="ActionsTable",
    ),
)
create_insight(
    "Demo gate impression → submit",
    d2,
    funnel_query(
        steps=[
            {"event": "demo_gate_viewed", "name": "Gate viewed"},
            {"event": "demo_gate_submitted", "name": "Gate submitted"},
        ],
        funnel_window_days=1,
    ),
)

# ---------- Dashboard 3: Demo & wizard funnels ----------
print("[3/6] Demo & wizard funnels")
d3 = create_dashboard("🧩 Demo & wizard funnels",
                      "Hvor falder folk fra i de interaktive flows.",
                      tags=["funnels", "demo"])

create_insight(
    "Sandbox demo (homepage chat)",
    d3,
    funnel_query(
        steps=[
            {"event": "sandbox_demo_started", "name": "Started"},
            {"event": "sandbox_step_shown", "name": "Step 1 (company)",
             "properties": [{"key": "step_index", "value": "0", "operator": "exact", "type": "event"}]},
            {"event": "sandbox_step_shown", "name": "Step 2 (email)",
             "properties": [{"key": "step_index", "value": "1", "operator": "exact", "type": "event"}]},
            {"event": "sandbox_step_shown", "name": "Step 3 (size)",
             "properties": [{"key": "step_index", "value": "2", "operator": "exact", "type": "event"}]},
            {"event": "sandbox_demo_finished", "name": "Finished"},
        ],
        funnel_window_days=1,
    ),
)
create_insight(
    "/demo gate funnel",
    d3,
    funnel_query(
        steps=[
            {"event": "$pageview", "name": "Viewed /demo",
             "properties": [{"key": "$pathname", "value": "/demo", "operator": "icontains", "type": "event"}]},
            {"event": "demo_gate_viewed", "name": "Gate shown"},
            {"event": "demo_gate_submitted", "name": "Gate submitted"},
            {"event": "lead_captured", "name": "Lead captured",
             "properties": [{"key": "source", "value": "demo-page-gate", "operator": "exact", "type": "event"}]},
        ],
        funnel_window_days=1,
    ),
)
create_insight(
    "Pricing wizard funnel",
    d3,
    funnel_query(
        steps=[
            {"event": "pricing_section_viewed", "name": "Pricing section seen"},
            {"event": "pricing_wizard_started", "name": "Wizard started"},
            {"event": "pricing_wizard_step", "name": "Wizard step answered"},
            {"event": "pricing_wizard_finished", "name": "Wizard finished"},
        ],
        funnel_window_days=1,
    ),
)
create_insight(
    "Pilot qualifier funnel",
    d3,
    funnel_query(
        steps=[
            {"event": "pilot_qualifier_started", "name": "Pilot qualifier started"},
            {"event": "pilot_qualifier_step", "name": "Pilot step answered"},
            {"event": "pilot_qualifier_finished", "name": "Pilot qualifier finished"},
            {"event": "lead_captured", "name": "Lead captured",
             "properties": [{"key": "source", "value": "pilotprojekt", "operator": "icontains", "type": "event"}]},
        ],
        funnel_window_days=1,
    ),
)
create_insight(
    "Pricing wizard answer distribution (entry)",
    d3,
    trends_query(
        series=[{"event": "pricing_wizard_step",
                 "properties": [{"key": "step", "value": "entry", "operator": "exact", "type": "event"}]}],
        breakdown={"breakdown_type": "event", "breakdown": "answer"},
        date_from="-30d",
        display="ActionsBar",
    ),
)

# ---------- Dashboard 4: Landing page leaderboard ----------
print("[4/6] Landing page leaderboard")
d4 = create_dashboard("🏆 Landing page leaderboard",
                      "Per side: views, scroll-depth, CTA-clicks, leads.",
                      tags=["landing-pages"])

create_insight(
    "Pageviews per landing page",
    d4,
    trends_query(
        series=[{"event": "$pageview"}],
        breakdown={"breakdown_type": "event", "breakdown": "$pathname"},
        date_from="-30d",
        display="ActionsBar",
    ),
)
create_insight(
    "Scroll-depth 75%+ per side",
    d4,
    trends_query(
        series=[{"event": "scroll_depth_reached",
                 "properties": [{"key": "depth_pct", "value": ["75", "100"], "operator": "exact", "type": "event"}]}],
        breakdown={"breakdown_type": "event", "breakdown": "page"},
        date_from="-30d",
        display="ActionsBar",
    ),
)
create_insight(
    "CTA clicks per side",
    d4,
    trends_query(
        series=[{"event": "cta_clicked"}],
        breakdown={"breakdown_type": "event", "breakdown": "page"},
        date_from="-30d",
        display="ActionsBar",
    ),
)
create_insight(
    "Engagement (30s+) per side",
    d4,
    trends_query(
        series=[{"event": "page_engaged"}],
        breakdown={"breakdown_type": "event", "breakdown": "page"},
        date_from="-30d",
        display="ActionsBar",
    ),
)
create_insight(
    "Leads per landing page",
    d4,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "event", "breakdown": "page"},
        date_from="-30d",
        display="ActionsBar",
    ),
)

# ---------- Dashboard 5: Hot leads & companies ----------
print("[5/6] Hot leads & companies")
d5 = create_dashboard("🔥 Hot leads & companies",
                      "Hvem skal I ringe til. Engagement, repeat visits, pricing-views.",
                      tags=["outbound", "leads"])

create_insight(
    "Recent lead captures (sidste 14 dage)",
    d5,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "event", "breakdown": "company"},
        date_from="-14d",
        display="ActionsTable",
    ),
)
create_insight(
    "Pricing-section views per session (uden lead)",
    d5,
    trends_query(
        series=[{"event": "pricing_section_viewed", "math": "unique_session"}],
        date_from="-14d",
        interval="day",
    ),
)
create_insight(
    "Pilot qualifier started (sidste 30 dage)",
    d5,
    trends_query(
        series=[{"event": "pilot_qualifier_started"}],
        date_from="-30d",
        interval="day",
        display="ActionsBar",
    ),
)
create_insight(
    "Competitor matrix views",
    d5,
    trends_query(
        series=[{"event": "competitor_matrix_viewed"}],
        date_from="-30d",
        interval="day",
    ),
)
create_insight(
    "Guide downloads",
    d5,
    trends_query(
        series=[{"event": "guide_download_requested"}],
        breakdown={"breakdown_type": "event", "breakdown": "guide"},
        date_from="-30d",
        display="ActionsBar",
    ),
)

# ---------- Dashboard 6: Source attribution & cohorts ----------
print("[6/6] Source attribution & cohorts")
d6 = create_dashboard("🧭 Source attribution & cohorts",
                      "Hvor kommer leads fra, hvor lang er rejsen.",
                      tags=["attribution"])

create_insight(
    "Leads per UTM source",
    d6,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "person", "breakdown": "utm_source"},
        date_from="-30d",
        display="ActionsBar",
    ),
)
create_insight(
    "Leads per referrer",
    d6,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "person", "breakdown": "$initial_referring_domain"},
        date_from="-30d",
        display="ActionsTable",
    ),
)
create_insight(
    "Lead conversion by first landing page",
    d6,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "person", "breakdown": "$initial_pathname"},
        date_from="-30d",
        display="ActionsTable",
    ),
)
create_insight(
    "Weekly returning visitor retention",
    d6,
    retention_query(target_event="$pageview", returning_event="$pageview", period="Week"),
)
create_insight(
    "Leads per first_source",
    d6,
    trends_query(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "person", "breakdown": "first_source"},
        date_from="-30d",
        display="ActionsBar",
    ),
)

# ---------- Cohorts ----------
print()
print("Building cohorts")

try:
    create_cohort(
        "Pricing-window-shoppers (no lead)",
        groups=[{
            "properties": [
                {"key": "pricing_section_viewed", "type": "behavioral",
                 "value": "performed_event_multiple", "operator_value": 2,
                 "time_interval": "day", "time_value": 14, "operator": "gte"},
                {"key": "lead_captured", "type": "behavioral",
                 "value": "performed_event", "negation": True,
                 "time_interval": "day", "time_value": 30},
            ]
        }],
    )
except Exception as e:
    print(f"  (skipped Pricing-window-shoppers — cohort schema differs: {e})")

try:
    create_cohort(
        "Pilot interested (started qualifier)",
        groups=[{
            "properties": [
                {"key": "pilot_qualifier_started", "type": "behavioral",
                 "value": "performed_event", "time_interval": "day", "time_value": 30},
            ]
        }],
    )
except Exception as e:
    print(f"  (skipped Pilot interested cohort — schema differs: {e})")

try:
    create_cohort(
        "Engaged leads (page_engaged on 2+ pages)",
        groups=[{
            "properties": [
                {"key": "page_engaged", "type": "behavioral",
                 "value": "performed_event_multiple", "operator_value": 2,
                 "time_interval": "day", "time_value": 14, "operator": "gte"},
            ]
        }],
    )
except Exception as e:
    print(f"  (skipped Engaged leads cohort — schema differs: {e})")

print()
print("Done. Open:")
print(f"  {HOST}/project/{PROJECT_ID}/dashboard")

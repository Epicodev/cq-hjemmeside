#!/usr/bin/env python3
"""
Build the single Overview dashboard — the one you open daily.

Pulls the highest-signal insights from across the 6 detail dashboards
into a single page. Pinned so it loads by default.

Usage:
    POSTHOG_API_KEY=phx_... POSTHOG_PROJECT_ID=182402 python build_overview_dashboard.py
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


def req(method, path, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {API_KEY}")
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTPError {e.code}: {e.read().decode('utf-8', errors='replace')[:300]}", file=sys.stderr)
        raise


def trends(series, breakdown=None, date_from="-30d", interval="day",
           display="ActionsLineGraph", show_values_on_series=False):
    source = {
        "kind": "TrendsQuery",
        "series": [
            {
                "kind": "EventsNode",
                "event": s["event"],
                "math": s.get("math", "total"),
                **({"name": s["name"]} if s.get("name") else {}),
                **({"properties": s["properties"]} if s.get("properties") else {}),
            }
            for s in series
        ],
        "interval": interval,
        "dateRange": {"date_from": date_from},
        "trendsFilter": {"display": display, "showValuesOnSeries": show_values_on_series},
        "filterTestAccounts": True,
    }
    if breakdown:
        source["breakdownFilter"] = breakdown
    return {"kind": "InsightVizNode", "source": source}


def funnel(steps, date_from="-30d", window_days=7):
    return {"kind": "InsightVizNode", "source": {
        "kind": "FunnelsQuery",
        "series": [
            {"kind": "EventsNode", "event": s["event"], "name": s.get("name", s["event"]),
             **({"properties": s["properties"]} if s.get("properties") else {})}
            for s in steps
        ],
        "dateRange": {"date_from": date_from},
        "funnelsFilter": {
            "funnelWindowInterval": window_days,
            "funnelWindowIntervalUnit": "day",
            "funnelVizType": "steps",
        },
        "filterTestAccounts": True,
    }}


# === Build Overview dashboard ===

print("Building Overview dashboard…")

dash = req("POST", "/dashboards/", {
    "name": "⭐ Overview",
    "description": "Daglig overblik. Pin'et som default. Klik ind på de specifikke dashboards for at dykke ned.",
    "pinned": True,
    "tags": ["overview", "daily"],
})
dash_id = dash["id"]
print(f"  Dashboard #{dash_id}: ⭐ Overview")


def insight(name, query, description=""):
    r = req("POST", "/insights/", {
        "name": name, "description": description,
        "dashboards": [dash_id], "query": query, "saved": True,
    })
    print(f"    Insight #{r['id']}: {name}")


# Top row: BIG NUMBERS for at-a-glance
insight(
    "Leads i dag",
    trends(series=[{"event": "lead_captured", "math": "total"}],
           date_from="-1d", display="BoldNumber"),
)
insight(
    "Leads sidste 7 dage",
    trends(series=[{"event": "lead_captured", "math": "total"}],
           date_from="-7d", display="BoldNumber"),
)
insight(
    "Unikke besøgende sidste 7 dage",
    trends(series=[{"event": "$pageview", "math": "dau"}],
           date_from="-7d", display="BoldNumber"),
)
insight(
    "Demo gate submissions sidste 7 dage",
    trends(series=[{"event": "demo_gate_submitted", "math": "total"}],
           date_from="-7d", display="BoldNumber"),
)

# Trend over time: leads + visitors
insight(
    "Leads per dag (30d)",
    trends(series=[{"event": "lead_captured"}],
           date_from="-30d", interval="day", display="ActionsBar",
           show_values_on_series=True),
)
insight(
    "Daglige besøgende (30d)",
    trends(series=[{"event": "$pageview", "math": "dau"}],
           date_from="-30d", interval="day"),
)

# The main funnel
insight(
    "Master funnel: visit → engaged → lead",
    funnel(
        steps=[
            {"event": "$pageview", "name": "Visit"},
            {"event": "page_engaged", "name": "Engaged (30s+)"},
            {"event": "lead_captured", "name": "Lead captured"},
        ],
        date_from="-30d",
        window_days=7,
    ),
)

# Where leads come from
insight(
    "Leads per kilde",
    trends(series=[{"event": "lead_captured"}],
           breakdown={"breakdown_type": "event", "breakdown": "source"},
           date_from="-30d", display="ActionsBar"),
)
insight(
    "Top referrers",
    trends(series=[{"event": "$pageview"}],
           breakdown={"breakdown_type": "event", "breakdown": "$referring_domain"},
           date_from="-7d", display="ActionsTable"),
)

# High-intent signals — useful for sales priorities
insight(
    "High-intent signaler (7d)",
    trends(
        series=[
            {"event": "pricing_wizard_finished", "name": "Pricing wizard finished"},
            {"event": "pilot_qualifier_started", "name": "Pilot qualifier started"},
            {"event": "demo_gate_submitted", "name": "Demo gate submitted"},
            {"event": "guide_download_requested", "name": "Guide download"},
        ],
        date_from="-7d", interval="day", display="ActionsLineGraph"),
)

# Top landing pages
insight(
    "Top landing pages (7d)",
    trends(series=[{"event": "$pageview"}],
           breakdown={"breakdown_type": "event", "breakdown": "$pathname"},
           date_from="-7d", display="ActionsTable"),
)

print()
print("Done. Open:")
print(f"  {HOST}/project/{PROJECT_ID}/dashboard/{dash_id}")

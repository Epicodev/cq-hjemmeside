#!/usr/bin/env python3
"""
Add Apollo company_identified insights to existing dashboards.

Inserts into:
  - ⭐ Overview dashboard (690354)
  - 🔥 Hot leads & companies dashboard (690333)

Usage:
    POSTHOG_API_KEY=phx_... POSTHOG_PROJECT_ID=182402 python add_apollo_insights.py
"""
import json, os, sys, urllib.request

API_KEY = os.environ.get("POSTHOG_API_KEY")
PROJECT_ID = os.environ.get("POSTHOG_PROJECT_ID")
HOST = os.environ.get("POSTHOG_HOST", "https://eu.posthog.com")

if not (API_KEY and PROJECT_ID):
    sys.exit("Missing POSTHOG_API_KEY or POSTHOG_PROJECT_ID")

BASE = f"{HOST}/api/projects/{PROJECT_ID}"

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    r.add_header("Authorization", f"Bearer {API_KEY}")
    r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read())

def trends(series, breakdown=None, date_from="-30d", interval="day",
           display="ActionsLineGraph"):
    source = {
        "kind": "TrendsQuery",
        "series": [{"kind": "EventsNode", "event": s["event"],
                    "math": s.get("math", "total"),
                    **({"name": s["name"]} if s.get("name") else {})}
                   for s in series],
        "interval": interval,
        "dateRange": {"date_from": date_from},
        "trendsFilter": {"display": display},
        "filterTestAccounts": False,
    }
    if breakdown:
        source["breakdownFilter"] = breakdown
    return {"kind": "InsightVizNode", "source": source}

def insight(name, dashboard_id, query, description=""):
    r = req("POST", "/insights/", {
        "name": name, "description": description,
        "dashboards": [dashboard_id], "query": query, "saved": True,
    })
    print(f"  #{r['id']}  {name}")

OVERVIEW = 690354
HOT_LEADS = 690333

# === Overview dashboard: add ONE big number ===
print("Overview dashboard:")
insight(
    "Apollo-identificerede firmaer (7d)",
    OVERVIEW,
    trends(
        series=[{"event": "company_identified", "math": "total"}],
        date_from="-7d",
        display="BoldNumber",
    ),
)

# === Hot leads & companies: 4 detailed insights ===
print("\nHot leads & companies dashboard:")
insight(
    "Apollo company identifications (30d)",
    HOT_LEADS,
    trends(
        series=[{"event": "company_identified"}],
        date_from="-30d", interval="day", display="ActionsBar",
    ),
)
insight(
    "Identificerede firmaer per industri",
    HOT_LEADS,
    trends(
        series=[{"event": "company_identified"}],
        breakdown={"breakdown_type": "event", "breakdown": "industry"},
        date_from="-30d", display="ActionsTable",
    ),
)
insight(
    "Identificerede firmaer per størrelse",
    HOT_LEADS,
    trends(
        series=[{"event": "company_identified"}],
        breakdown={"breakdown_type": "event", "breakdown": "employees"},
        date_from="-30d", display="ActionsTable",
    ),
)
insight(
    "Identificerede firmaer per land",
    HOT_LEADS,
    trends(
        series=[{"event": "company_identified"}],
        breakdown={"breakdown_type": "event", "breakdown": "country"},
        date_from="-30d", display="ActionsTable",
    ),
)
insight(
    "Top identificerede firmaer (domain)",
    HOT_LEADS,
    trends(
        series=[{"event": "company_identified"}],
        breakdown={"breakdown_type": "event", "breakdown": "company_domain"},
        date_from="-30d", display="ActionsTable",
    ),
)

print(f"\nDone. Open {HOST}/project/{PROJECT_ID}/dashboard/{OVERVIEW} and /{HOT_LEADS}")

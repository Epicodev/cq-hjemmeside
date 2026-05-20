#!/usr/bin/env python3
"""
Add Apollo SEQUENCE TRAFFIC insights to the Hot leads dashboard.

These insights answer:
  - How many Apollo sequence recipients actually visited the site?
  - Which sequences/campaigns drive the most clicks?
  - What do Apollo-sourced visitors do once on site?
  - Conversion: Apollo click -> form submit

Usage:
    POSTHOG_API_KEY=phx_... POSTHOG_PROJECT_ID=182402 python add_apollo_traffic_insights.py
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
           display="ActionsLineGraph", properties=None):
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
    if properties:
        source["properties"] = properties
    return {"kind": "InsightVizNode", "source": source}

def insight(name, dashboard_id, query, description=""):
    r = req("POST", "/insights/", {
        "name": name, "description": description,
        "dashboards": [dashboard_id], "query": query, "saved": True,
    })
    print(f"  #{r['id']}  {name}")

HOT_LEADS = 690333

print("Adding Apollo traffic insights to Hot leads dashboard:")

insight(
    "Apollo sequence-besøg (30d)",
    HOT_LEADS,
    trends(
        series=[{"event": "apollo_link_visited"}],
        date_from="-30d", interval="day", display="ActionsBar",
    ),
    description="Antal klik fra Apollo outbound-mails der landede på siden",
)

insight(
    "Apollo-besøg per sequence",
    HOT_LEADS,
    trends(
        series=[{"event": "apollo_link_visited"}],
        breakdown={"breakdown_type": "event", "breakdown": "utm_campaign"},
        date_from="-30d", display="ActionsTable",
    ),
    description="Hvilke sekvenser driver mest sitet-trafik?",
)

insight(
    "Apollo-leads der submittede en formular",
    HOT_LEADS,
    trends(
        series=[{"event": "lead_captured"}],
        breakdown={"breakdown_type": "person", "breakdown": "utm_source"},
        date_from="-30d", display="ActionsTable",
        properties=[{
            "key": "utm_source", "value": "apollo",
            "operator": "exact", "type": "person"
        }],
    ),
    description="Leads hvor utm_source = apollo (kom fra outbound)",
)

insight(
    "Apollo-traffic pricing engagement",
    HOT_LEADS,
    trends(
        series=[{"event": "pricing_section_viewed"}],
        date_from="-30d", display="ActionsLineGraph",
        properties=[{
            "key": "utm_source", "value": "apollo",
            "operator": "exact", "type": "person"
        }],
    ),
    description="Apollo-besoegende der scrollede til pricing",
)

print(f"\nDone. Open {HOST}/project/{PROJECT_ID}/dashboard/{HOT_LEADS}")

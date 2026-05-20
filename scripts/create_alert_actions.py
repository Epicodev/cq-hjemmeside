#!/usr/bin/env python3
"""
Create 2 PostHog Actions used as Zapier triggers for warm/hot lead alerts.

Actions created:
  - "Apollo lead - engaged"  (Tier 1: 15+ sec page_engaged from Apollo source)
  - "Apollo lead - hot"      (Tier 2: pricing viewed, formularer startet, lead captured)

Each Action wraps one or more events with property filters.
In Zapier, the PostHog "Action Performed" trigger lets you pick these actions by name.

Usage:
    POSTHOG_API_KEY=phx_... POSTHOG_PROJECT_ID=182402 python create_alert_actions.py
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

def apollo_person_filter():
    """Property filter: person.utm_source = apollo"""
    return [{
        "key": "utm_source",
        "value": ["apollo"],
        "operator": "exact",
        "type": "person",
    }]

# === Tier 1: Engaged Apollo lead ===
tier1 = {
    "name": "Apollo lead - engaged",
    "description": "Person fra Apollo der har vaeret aktiv 15+ sek paa siden",
    "steps": [
        {
            "event": "page_engaged",
            "properties": apollo_person_filter(),
        },
    ],
    "post_to_slack": False,
}

# === Tier 2: Hot Apollo lead ===
tier2 = {
    "name": "Apollo lead - hot",
    "description": "Hot signal fra Apollo-lead: pricing viewed, formular startet, eller submission",
    "steps": [
        {
            "event": "pricing_section_viewed",
            "properties": apollo_person_filter(),
        },
        {
            "event": "pricing_wizard_started",
            "properties": apollo_person_filter(),
        },
        {
            "event": "pilot_qualifier_started",
            "properties": apollo_person_filter(),
        },
        {
            "event": "lead_captured",
            "properties": apollo_person_filter(),
        },
    ],
    "post_to_slack": False,
}

print("Creating PostHog Actions:")
for action in (tier1, tier2):
    r = req("POST", "/actions/", action)
    print(f"  #{r['id']}  {r['name']}")
    print(f"    Steps: {len(r.get('steps', []))}")

print("\nDone. In Zapier:")
print("  1. New Zap -> Trigger: PostHog -> Action Performed")
print("  2. Pick action 'Apollo lead - engaged' or 'Apollo lead - hot'")
print("  3. Add Gmail step -> send to bvb@culturequest.io")

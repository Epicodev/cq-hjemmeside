#!/usr/bin/env python3
"""
Add missing `name` properties to JSON-LD schema items so Google's
rich-results validator stops flagging "Unnamed item" warnings.

Targets:
  - Review                → "Review by <author-name>"
  - Offer (single)        → derived from parent context if available
  - AggregateOffer        → "<product> pricing"
  - FAQPage (top-level)   → derived from URL or "FAQ"

Operates on index.html and en/index.html.
"""
import re
import json
import sys
import pathlib

def process_html(path: pathlib.Path) -> int:
    """Returns number of items renamed."""
    html = path.read_text()
    pattern = re.compile(r'(<script type="application/ld\+json">)(.*?)(</script>)', re.DOTALL)

    fixed_count = [0]

    def add_names(node, parent_ctx=None):
        if isinstance(node, dict):
            t = node.get("@type")
            # Review without name
            if t == "Review" and "name" not in node:
                author_name = "anonymous"
                a = node.get("author")
                if isinstance(a, dict):
                    author_name = a.get("name") or author_name
                node["name"] = f"Review by {author_name}"
                fixed_count[0] += 1

            # Offer (single, not list) without name
            elif t == "Offer" and "name" not in node:
                parent_name = parent_ctx or "culturequest"
                node["name"] = f"{parent_name} subscription"
                fixed_count[0] += 1

            # AggregateOffer without name
            elif t == "AggregateOffer" and "name" not in node:
                parent_name = parent_ctx or "culturequest"
                node["name"] = f"{parent_name} pricing plans"
                fixed_count[0] += 1

            # FAQPage without name
            elif t == "FAQPage" and "name" not in node:
                main = node.get("mainEntityOfPage")
                url = main.get("@id") if isinstance(main, dict) else None
                slug = (url or "").rstrip("/").split("/")[-1] or "site"
                node["name"] = f"FAQ — {slug}" if slug else "FAQ"
                fixed_count[0] += 1

            # Recurse, passing this node's name as context for children
            ctx = node.get("name") or parent_ctx
            for v in node.values():
                add_names(v, ctx)
        elif isinstance(node, list):
            for v in node:
                add_names(v, parent_ctx)

    def repl(m):
        prefix, body, suffix = m.group(1), m.group(2), m.group(3)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return m.group(0)
        add_names(data)
        new_body = "\n" + json.dumps(data, indent=4, ensure_ascii=False) + "\n"
        return prefix + new_body + suffix

    new_html = pattern.sub(repl, html)
    if new_html != html:
        path.write_text(new_html)
    return fixed_count[0]


if __name__ == "__main__":
    for f in ["index.html", "en/index.html"]:
        p = pathlib.Path(f)
        n = process_html(p)
        print(f"{f}: added {n} name properties")

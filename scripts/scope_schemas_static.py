#!/usr/bin/env python3
"""
Change all FAQPage / Service / BreadcrumbList JSON-LD scripts from
`application/ld+json` to `application/x-scoped-ld+json` in the static
HTML.

The runtime schema-scoping JS will activate the matching one per route.
This eliminates the 'Duplicate field FAQPage' error Googlebot was
hitting because its first-pass parser sees ALL FAQPages as active.

Now the first-pass sees ZERO page-specific schemas (all inactive).
The second-pass (rendered) sees ONE active per current route.

Global schemas (Organization, SoftwareApplication, Product, WebSite,
Review, etc.) stay as `application/ld+json` (always active).
"""
import re
import pathlib

PAGE_SPECIFIC_TYPES = {"FAQPage", "Service", "BreadcrumbList"}


def transform(html: str) -> tuple[str, int]:
    """Return (new_html, count_changed)."""
    # Match each <script type="application/ld+json">...</script> block
    pattern = re.compile(
        r'(<script\s+type=)"application/ld\+json"(>\s*\{.*?\}\s*</script>)',
        re.DOTALL,
    )

    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        prefix, body = m.group(1), m.group(2)
        # Look at first ~200 chars of the body for the @type
        head = body[:600]
        type_match = re.search(r'"@type"\s*:\s*"([^"]+)"', head)
        if type_match and type_match.group(1) in PAGE_SPECIFIC_TYPES:
            count += 1
            return f'{prefix}"application/x-scoped-ld+json"{body}'
        return m.group(0)

    new_html = pattern.sub(repl, html)
    return new_html, count


if __name__ == "__main__":
    for path_str in ("index.html", "en/index.html"):
        p = pathlib.Path(path_str)
        if not p.exists():
            print(f"Skipping {path_str} (not found)")
            continue
        original = p.read_text()
        new_html, n = transform(original)
        if new_html != original:
            p.write_text(new_html)
            print(f"{path_str}: changed {n} page-specific schemas to x-scoped-ld+json")
        else:
            print(f"{path_str}: no changes")

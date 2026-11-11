#!/usr/bin/env python3
"""Turn the frozen 50,000-product Amazon catalog into a browser-sized index.

Counterask ships its whole storefront to the client: retrieval, attribute
extraction and the stopping policy all run in the tab, so the catalog has to
arrive over the wire and stay small enough to be worth waiting for.

We keep the menswear slice (9,901 products), drop everything the ranker never
reads, and pre-extract the attribute evidence the policy asks about, so the
browser does no parsing beyond JSON.parse.

    python scripts/build_catalog.py --source /path/to/catalog.jsonl

The 50,000-product source file is not part of this repository (see "Data" in
the README), so this step cannot be re-run from a clean clone. Its output,
public/data/catalog.json, is committed and is what the app, the tests and the
benchmarks read. Python 3.11, standard library only.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "catalog.json"

# Attributes a shopper actually volunteers, and the surface forms they use.
# Values are matched against title + features + details, lowercased, as whole
# words with the endings people add ("buttons", "laced", "washable"), longest
# form first and never overlapping — so "faux leather" is faux leather and not
# leather, and "leather sole" is a sole and not a material. The page reads
# queries with the same rule and the same forms (facetForms below), which is
# what keeps the index a superset of anything a shopper can say.
FACETS: dict[str, dict[str, tuple[str, ...]]] = {
    "material": {
        "leather": ("genuine leather", "full grain leather", "full-grain leather", "top grain leather", "cowhide", "leather"),
        "faux leather": ("faux leather", "faux-leather", "vegan leather", "pu leather", "synthetic leather", "leatherette", "pleather"),
        "suede": ("suede",),
        "cotton": ("100% cotton", "cotton",),
        "polyester": ("polyester",),
        "wool": ("merino wool", "merino", "wool", "lambswool"),
        "cashmere": ("cashmere",),
        "denim": ("denim",),
        "linen": ("linen",),
        "silk": ("silk",),
        "nylon": ("nylon",),
        "fleece": ("fleece",),
        "spandex": ("spandex", "elastane", "lycra"),
        "canvas": ("canvas",),
        "mesh": ("mesh",),
        "acrylic": ("acrylic",),
        "rayon": ("rayon", "viscose"),
        "modal": ("modal",),
        "bamboo": ("bamboo",),
        "rubber": ("rubber",),
        "steel": ("stainless steel", "steel"),
    },
    "closure": {
        "buckle": ("buckle closure", "buckle"),
        "zipper": ("zipper closure", "zip fly", "zipper", "zippered", "full zip", "full-zip", "half zip", "half-zip", "quarter zip", "quarter-zip", "zip"),
        "button": ("button closure", "button fly", "button-down", "button down", "button"),
        "lace-up": ("lace-up", "lace up", "shoelaces", "laces", "laced", "lace"),
        "pull-on": ("pull on closure", "pull-on", "pull on"),
        "slip-on": ("slip-on", "slip on", "slipon"),
        "hook and loop": ("hook and loop", "hook & loop", "hook-and-loop", "velcro"),
        "snap": ("snap closure", "snap button", "snap"),
        "drawstring": ("drawstring", "draw string"),
        "elastic waist": ("elastic waist", "elastic waistband", "elasticated waist"),
    },
    "sleeve": {
        "short sleeve": ("short sleeve", "short-sleeve"),
        "long sleeve": ("long sleeve", "long-sleeve"),
        "3/4 sleeve": ("3/4 sleeve", "3/4-sleeve", "three quarter sleeve", "three-quarter sleeve"),
        "sleeveless": ("sleeveless", "tank top", "tank"),
    },
    "fit": {
        "slim fit": ("slim fit", "slim-fit", "skinny fit", "tailored fit", "slim cut"),
        "regular fit": ("regular fit", "regular-fit", "classic fit", "traditional fit", "standard fit", "straight fit"),
        "relaxed fit": ("relaxed fit", "relaxed-fit", "loose fit", "loose-fit", "baggy"),
        "athletic fit": ("athletic fit", "athletic cut"),
        "big and tall": ("big & tall", "big and tall", "big-tall", "plus size"),
    },
    "care": {
        "machine wash": ("machine wash", "machine-wash"),
        "hand wash": ("hand wash", "hand-wash"),
        "dry clean": ("dry clean", "dry-clean"),
    },
    "origin": {
        "imported": ("imported",),
        "made in usa": ("made in usa", "made in the usa", "made in u.s.a", "made in the u.s.a", "made in america", "usa made", "american made"),
    },
    "sole": {
        "rubber sole": ("rubber sole", "rubber outsole"),
        "synthetic sole": ("synthetic sole", "synthetic outsole"),
        "leather sole": ("leather sole", "leather outsole"),
    },
    "occasion": {
        "formal": ("formal", "dress shirt", "dress shoe", "dress pant", "business", "office", "wedding", "tuxedo"),
        "casual": ("casual", "everyday", "weekend"),
        "athletic": ("athletic", "running", "workout", "gym", "sport", "sports", "training", "exercise", "fitness", "jogging", "basketball", "tennis", "golf", "soccer", "cycling", "yoga"),
        "outdoor": ("hiking", "outdoor", "work boot", "camping", "trail", "hunting", "fishing", "climbing", "trekking", "mountain"),
    },
    "pocket": {
        "with pockets": ("pockets", "pocket", "pocketed"),
    },
    "waterproof": {
        "water resistant": ("waterproof", "water resistant", "water-resistant", "water proof", "water-proof", "rainproof", "weatherproof", "gore-tex", "gore tex", "rain"),
    },
    "color": {
        "black": ("black",),
        "white": ("white", "ivory", "cream"),
        "grey": ("grey", "gray", "heather grey", "heather gray", "charcoal"),
        "navy": ("navy", "navy blue"),
        "blue": ("blue", "royal blue", "light blue", "teal"),
        "brown": ("brown", "chocolate", "coffee"),
        "tan": ("tan", "camel", "sand"),
        "beige": ("beige", "khaki"),
        "red": ("red", "maroon", "burgundy", "wine"),
        "green": ("green", "olive", "forest green"),
        "orange": ("orange", "rust"),
        "yellow": ("yellow", "mustard"),
        "pink": ("pink",),
        "purple": ("purple",),
        "silver": ("silver",),
        "gold": ("gold", "golden"),
    },
}

# The same tolerance the page uses: a whole word, with the endings people add.
SUFFIX = r"(?:s|es|ed|d|able|ing)?"


def _compile() -> list[tuple[re.Pattern[str], str, str]]:
    out = []
    for facet, values in FACETS.items():
        for value, forms in values.items():
            for form in forms:
                pat = re.compile(r"(?<![a-z])" + re.escape(form) + SUFFIX + r"(?![a-z])")
                out.append((pat, facet, value))
    return out


PATTERNS = _compile()

# No tokenizer here on purpose. An earlier version shipped pre-split title
# terms, and its split disagreed with the browser's — "V-Neck T-Shirt" became
# neck/shirt on this side and also vneck/tshirt on that one, so a product could
# be absent from the results for a query built out of its own title. The page
# tokenizes titles itself, with the same function it runs over queries.


def facets_for(blob: str) -> dict[str, list[str]]:
    """Attribute evidence the stopping policy can ask about and filter on."""

    spans: list[tuple[int, int, str, str]] = []
    for pat, facet, value in PATTERNS:
        for m in pat.finditer(blob):
            spans.append((m.start(), m.end(), facet, value))
    # Longest form first, never overlapping: "faux leather" claims its span
    # before "leather" can, "leather sole" before "leather".
    spans.sort(key=lambda s: (-(s[1] - s[0]), s[0]))
    taken: list[tuple[int, int]] = []
    kept: list[tuple[int, int, str, str]] = []
    for s in spans:
        if any(s[0] < t[1] and t[0] < s[1] for t in taken):
            continue
        taken.append((s[0], s[1]))
        kept.append(s)
    kept.sort(key=lambda s: s[0])

    found: dict[str, list[str]] = {}
    for _, _, facet, value in kept:
        lst = found.setdefault(facet, [])
        if value not in lst:
            lst.append(value)
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="path to catalog.jsonl")
    ap.add_argument("--department", default="Men", help="level-2 category to keep")
    args = ap.parse_args()

    src = Path(args.source)
    if not src.is_file():
        raise SystemExit(f"catalog not found: {src}")

    kept: list[dict] = []
    facet_counts: collections.Counter[str] = collections.Counter()

    with src.open(encoding="utf-8") as fh:
        for line in fh:
            d = json.loads(line)
            cats = d.get("categories") or []
            if len(cats) < 2 or cats[1] != args.department:
                continue

            title = (d.get("title") or "").strip()
            if not title:
                continue
            feats = [(f or "").strip() for f in (d.get("features") or [])[:6]]
            feats = [f[:80] for f in feats if len(f) > 2]
            details = d.get("details") or {}
            blob = " ".join([title, *feats, *(str(v) for v in details.values())]).lower()

            fac = facets_for(blob)
            for k in fac:
                facet_counts[k] += 1

            kept.append({
                "id": d.get("parent_asin") or "",
                "t": title[:110],
                "p": d.get("price"),
                "r": d.get("average_rating"),
                "n": d.get("rating_number") or 0,
                "b": (d.get("store") or "")[:36],
                "c": cats[2:5],
                "f": fac,
            })

    payload = {
        "meta": {
            "source": "Amazon Reviews 2023 (McAuley Lab, UCSD) — frozen 50,000-product TechJam catalog",
            "slice": f"level-2 category = {args.department}",
            "count": len(kept),
            "facets": list(FACETS.keys()),
        },
        "facetValues": {k: sorted(v.keys()) for k, v in FACETS.items()},
        # The wording a shopper uses is rarely the canonical value: they type
        # "waterproof", the catalog records "water resistant". Ship the surface
        # forms so the page can recognise what was already said.
        "facetForms": {
            facet: {value: list(forms) for value, forms in values.items()}
            for facet, values in FACETS.items()
        },
        "items": kept,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    OUT.write_bytes(raw)

    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  items      {len(kept)}")
    print(f"  raw        {len(raw)/1048576:.2f} MB")
    print(f"  gzip       {len(gzip.compress(raw, 9))/1048576:.2f} MB")
    print("  facet coverage:")
    for k in FACETS:
        print(f"    {k:<12} {100*facet_counts[k]/max(len(kept),1):5.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

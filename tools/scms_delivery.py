"""tools/scms_delivery.py - delivery lateness by shipment mode from a public dataset (v3.55).

The USAID Supply Chain Management System (SCMS) delivery history - published by the USAID
Development Data Library as "Supply Chain Shipment Pricing Data" - lists 10 324 shipment lines
of HIV/AIDS commodities delivered to some forty countries between 2006 and 2015, with, among
33 columns, the Shipment Mode (Air, Truck, Ocean, Air Charter), the date the purchase order
was sent to the vendor, the scheduled delivery date, the date delivered to the client and the
date the delivery was recorded. This tool reduces the CSV (a public GitHub mirror of the DDL
file) to ONE small, committed, reviewable file of per-mode aggregates that the app reads for
the SHAPE of delivery lateness - nothing else of the dataset is shipped, and no row is
committed.

THE RULE (stated once, applied everywhere, recorded in the JSON):
  1. A row is usable for lateness when both `Scheduled Delivery Date` and `Delivered to
     Client Date` parse as a date - day-Mon-yy (e.g. 2-Jun-06) or, as some PO dates are
     written, m/d/yy (e.g. 8/27/14). Values such as "Date Not Captured" or "N/A - From RDC"
     are counted as unusable per column, never filled in.
  2. lateness_days = delivered - scheduled (negative = early). Per Shipment Mode (a blank
     mode or the literal "N/A" is "(not captured)") and overall: n rows, usable rows, min / p10 / median / p90 /
     max by the NEAREST-RANK rule (values sorted ascending, rank = ceil(p x n), 1-based; the
     median is p50), and the shares late (> 0), early (< 0) and on time (= 0), rounded to
     four decimals.
  3. po_to_delivery_days = delivered - `PO Sent to Vendor Date`, the same way, over the rows
     where both parse.
  4. Nothing is weighted, trimmed, winsorised or fitted. The app uses the quantiles as a
     piecewise-linear shape, scaled to plant ticks by a declared teaching parameter; these
     are international pharmaceutical lanes, not a warehouse's dock.

LICENCE: the dataset page (data.usaid.gov / datahub.usaid.gov) did not resolve from the
machine that ran the reduction (2026-09-23), so the licence is recorded as UNRESOLVED. The
DDL issues either a US Government Work licence (no copyright) or a Partner licence under
CC BY-ND 4.0, per dataset. Whichever applies, only aggregate statistics are committed, with
the attribution the DDL asks for: "USAID Development Data Library".

    python tools/scms_delivery.py fetch            # download the CSV (~3.8 MB) into .cache/scms/ (git-ignored)
    python tools/scms_delivery.py reduce           # cache -> data/scms-delivery.json + .js + docs/SCMS_DELIVERY.md
    python tools/scms_delivery.py --check          # fetch + reduce into a temp dir, compare with the committed files (network)
    python tools/scms_delivery.py --offline-check  # JS twin, Markdown and schema agree with the JSON (no network; the tests run this)
"""
import argparse
import csv
import hashlib
import io
import json
import math
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "scms"
DATA_JSON = ROOT / "data" / "scms-delivery.json"
DATA_JS = ROOT / "data" / "scms-delivery.js"
DOC_MD = ROOT / "docs" / "SCMS_DELIVERY.md"

SCHEMA = "scms-delivery-aggregates/v1"
DATASET_ID = "scms-delivery"
MIRROR = "https://github.com/jrcinco/supply-chain-shipment-price-data/raw/master/SCMS_Delivery_History_Dataset.csv"
CSV_NAME = "SCMS_Delivery_History_Dataset.csv"
DATE_FORMAT = "%d-%b-%y"
DATE_FORMATS = (DATE_FORMAT, "%m/%d/%y")  # day-Mon-yy everywhere; some PO dates are written m/d/yy
COL_MODE, COL_SCHED, COL_DELIV, COL_PO = "Shipment Mode", "Scheduled Delivery Date", "Delivered to Client Date", "PO Sent to Vendor Date"
NOT_CAPTURED = "(not captured)"
ATTRIBUTION = "USAID Development Data Library"
QUANTILES = (("min", 0.0), ("p10", 0.1), ("median", 0.5), ("p90", 0.9), ("max", 1.0))
RULE = (
    "A row is usable when both the scheduled and the delivered-to-client dates parse as a date (day-Mon-yy, or m/d/yy as some PO dates are written); "
    "lateness_days = delivered - scheduled (negative = early); per shipment mode (blank or 'N/A' = '(not captured)') and overall: "
    "n, usable, min / p10 / median / p90 / max by the nearest-rank rule (sorted ascending, rank = ceil(p x n), 1-based), "
    "shares late (> 0), early (< 0) and on time (= 0) rounded to four decimals; po_to_delivery_days the same way over the rows "
    "where the PO date parses too. Nothing weighted, trimmed or fitted; unparseable dates are counted, never filled in."
)
HONESTY = (
    "Aggregate statistics of a public dataset of international pharmaceutical shipment lines (2006-2015), reduced by the rule "
    "above. The app uses them for the SHAPE of delivery lateness only, scaled to plant ticks by a declared teaching parameter; "
    "no warehouse, carrier or customer is measured here, and no row of the dataset is shipped."
)
LICENCE_NOTE = (
    "The dataset page (data.usaid.gov / datahub.usaid.gov) did not resolve from the machine that ran the reduction (2026-09-23). "
    "The USAID Development Data Library issues either a US Government Work licence (no copyright) or a Partner licence under "
    "CC BY-ND 4.0, per dataset; whichever applies, only these aggregates are committed, with the attribution the DDL asks for."
)


def parse_date(s):
    """'2-Jun-06' or '8/27/14' -> date; anything else ('Date Not Captured', 'N/A - From RDC', blank) -> None."""
    text = str(s).strip() if s is not None else ""
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def nearest_rank(sorted_values, p):
    """The nearest-rank quantile of an ascending list: rank = ceil(p x n), 1-based (p = 0 -> the minimum)."""
    n = len(sorted_values)
    if not n:
        return None
    rank = max(1, min(n, math.ceil(p * n)))
    return sorted_values[rank - 1]


def summarise(values):
    """min / p10 / median / p90 / max of a list of integers (None when empty)."""
    if not values:
        return None
    v = sorted(values)
    return {name: nearest_rank(v, p) for name, p in QUANTILES}


def shares(values):
    n = len(values)
    if not n:
        return None
    late = sum(1 for x in values if x > 0)
    early = sum(1 for x in values if x < 0)
    return {"late": round(late / n, 4), "early": round(early / n, 4), "on_time": round((n - late - early) / n, 4)}


def reduce_rows(rows):
    """The per-mode and overall aggregates of an iterable of CSV row dicts (the rule, step by step)."""
    per = {}
    unusable = {"scheduled_delivery_date": 0, "delivered_to_client_date": 0, "po_sent_to_vendor_date": 0, "values_seen": {}}
    total = 0
    for r in rows:
        total += 1
        mode = (r.get(COL_MODE) or "").strip()
        if not mode or mode.upper() == "N/A":
            mode = NOT_CAPTURED
        rec = per.setdefault(mode, {"n": 0, "lateness": [], "po": []})
        rec["n"] += 1
        sched, deliv, po = parse_date(r.get(COL_SCHED)), parse_date(r.get(COL_DELIV)), parse_date(r.get(COL_PO))
        for col, val, key in ((COL_SCHED, sched, "scheduled_delivery_date"), (COL_DELIV, deliv, "delivered_to_client_date"), (COL_PO, po, "po_sent_to_vendor_date")):
            if val is None:
                unusable[key] += 1
                seen = str(r.get(col) or "").strip() or "(blank)"
                unusable["values_seen"][seen] = unusable["values_seen"].get(seen, 0) + 1
        if sched and deliv:
            rec["lateness"].append((deliv - sched).days)
        if po and deliv:
            rec["po"].append((deliv - po).days)
    modes = sorted(m for m in per if m != NOT_CAPTURED) + ([NOT_CAPTURED] if NOT_CAPTURED in per else [])

    def block(rec):
        return {
            "n": rec["n"], "usable": len(rec["lateness"]),
            "lateness_days": summarise(rec["lateness"]), "share": shares(rec["lateness"]),
            "po_to_delivery_days": dict(summarise(rec["po"]) or {}, usable=len(rec["po"])) if rec["po"] else {"usable": 0},
        }

    overall = {"n": total, "lateness": [x for m in per.values() for x in m["lateness"]], "po": [x for m in per.values() for x in m["po"]]}
    return {"modes": modes, "by_mode": {m: block(per[m]) for m in modes}, "overall": block(overall), "unusable": unusable, "rows": total}


def read_csv_text(text):
    return list(csv.DictReader(io.StringIO(text, newline="")))


def _get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "logistics-flow-studio/scms_delivery.py"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch(cache=CACHE, log=print):
    """Download the mirror CSV into the cache; record its size and SHA-256 (no date: the reduction must be reproducible byte for byte)."""
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    raw = _get(MIRROR)
    (cache / CSV_NAME).write_bytes(raw)
    meta = {"mirror": MIRROR, "file": CSV_NAME, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    (cache / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    log(f"fetched {CSV_NAME}: {len(raw)} bytes, sha256 {meta['sha256'][:16]}... into {cache}")
    return meta


def build(cache=CACHE):
    cache = Path(cache)
    raw = (cache / CSV_NAME).read_bytes()
    text = raw.decode("utf-8-sig")
    rows = read_csv_text(text)
    columns = list(rows[0].keys()) if rows else []
    red = reduce_rows(rows)
    return {
        "schema": SCHEMA, "id": DATASET_ID,
        "source": {
            "name": "USAID Supply Chain Shipment Pricing Data (SCMS delivery history, 2006-2015)",
            "publisher": ATTRIBUTION, "attribution": ATTRIBUTION,
            "mirror": MIRROR, "file": CSV_NAME, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "rows": red["rows"], "columns": len(columns),
            "columns_used": [COL_MODE, COL_SCHED, COL_DELIV, COL_PO],
            "licence": {"status": "unresolved", "note": LICENCE_NOTE},
        },
        "rule": RULE, "honesty": HONESTY, "date_format": DATE_FORMAT,
        "modes": red["modes"], "by_mode": red["by_mode"], "overall": red["overall"], "unusable": red["unusable"],
    }


def render_json(data):
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_js(data):
    return (
        "/* data/scms-delivery.js - GENERATED by tools/scms_delivery.py; do not edit.\n"
        " * The JSON twin of data/scms-delivery.json for the browser (no fetch, offline-safe).\n"
        " * Aggregates only of the USAID SCMS delivery history (USAID Development Data Library); the shape of\n"
        " * delivery lateness by shipment mode, licence as recorded inside; no row of the dataset is shipped. */\n"
        "window.WT = window.WT || {};\n"
        "WT.datasets = WT.datasets || {};\n"
        "WT.datasets.scmsDelivery = " + render_json(data).rstrip("\n") + ";\n"
    )


def _fmt(v):
    if v is None:
        return "-"
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def render_md(data):
    src = data["source"]
    lines = [
        "# SCMS delivery history - the shape of delivery lateness by shipment mode",
        "",
        f"*Generated by `tools/scms_delivery.py` from the {src['name']}, published by the {src['publisher']} and read from the public mirror "
        f"`{src['mirror']}` ({src['bytes']} bytes, SHA-256 `{src['sha256']}`, {src['rows']} rows, {src['columns']} columns). "
        f"Licence: **{src['licence']['status']}** - {src['licence']['note']} Attribution: {src['attribution']}.*",
        "",
        "## The rule",
        "",
        data["rule"],
        "",
        "## Lateness in days (delivered to client minus scheduled delivery; negative = early)",
        "",
        "| Shipment mode | rows | usable | min | p10 | median | p90 | max | late | early | on time |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for m in data["modes"] + ["overall"]:
        b = data["overall"] if m == "overall" else data["by_mode"][m]
        q, s = b["lateness_days"] or {}, b["share"] or {}
        lines.append(f"| {'**all modes**' if m == 'overall' else m} | {b['n']} | {b['usable']} | {_fmt(q.get('min'))} | {_fmt(q.get('p10'))} | {_fmt(q.get('median'))} | "
                     f"{_fmt(q.get('p90'))} | {_fmt(q.get('max'))} | {_fmt(s.get('late'))} | {_fmt(s.get('early'))} | {_fmt(s.get('on_time'))} |")
    lines += [
        "",
        "## Purchase order to delivery in days (delivered to client minus PO sent to vendor)",
        "",
        "| Shipment mode | usable | min | p10 | median | p90 | max |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for m in data["modes"] + ["overall"]:
        b = data["overall"] if m == "overall" else data["by_mode"][m]
        q = b["po_to_delivery_days"] or {}
        lines.append(f"| {'**all modes**' if m == 'overall' else m} | {q.get('usable', 0)} | {_fmt(q.get('min'))} | {_fmt(q.get('p10'))} | {_fmt(q.get('median'))} | {_fmt(q.get('p90'))} | {_fmt(q.get('max'))} |")
    u = data["unusable"]
    seen = ", ".join(f"`{k}` x{v}" for k, v in sorted(u.get("values_seen", {}).items(), key=lambda kv: (-kv[1], kv[0]))[:6])
    lines += [
        "",
        "## Unusable dates (counted, never filled in)",
        "",
        f"Scheduled delivery date: {u['scheduled_delivery_date']} rows; delivered-to-client date: {u['delivered_to_client_date']} rows; "
        f"PO sent to vendor date: {u['po_sent_to_vendor_date']} rows. Values seen: {seen}.",
        "",
        "## What this is and what it is not",
        "",
        data["honesty"],
        "",
        "In the app (v3.55) the lateness quantiles of the chosen mode form a piecewise-linear inverse distribution through (0, min), (0.1, p10), "
        "(0.5, median), (0.9, p90), (1, max); a Weyl sequence u_j = frac(j x 0.6180339887) - evenly spread, deterministic, not a random draw - "
        "is pushed through it and scaled by the knowledge base's ticks-per-day teaching parameter to give each inbound trailer its lateness and "
        "each outbound unit the lateness of its transit. The scale is a teaching choice, said so wherever it shows.",
        "",
    ]
    return "\n".join(lines)


def write_outputs(data, json_path=DATA_JSON, js_path=DATA_JS, md_path=DOC_MD):
    for p, text in ((json_path, render_json(data)), (js_path, render_js(data)), (md_path, render_md(data))):
        Path(p).parent.mkdir(parents=True, exist_ok=True)
        Path(p).write_text(text, encoding="utf-8", newline="\n")


def load_committed(json_path=DATA_JSON):
    return json.loads(Path(json_path).read_text(encoding="utf-8"))


def schema_problems(data):
    """Plain sanity: schema id, the rule and honesty kept, every quantile block ordered, usable <= n, shares summing to one."""
    out = []
    if data.get("schema") != SCHEMA or data.get("id") != DATASET_ID:
        out.append("schema / id")
    if data.get("rule") != RULE:
        out.append("the rule text differs from the tool's")
    if data.get("honesty") != HONESTY:
        out.append("the honesty text differs from the tool's")
    if (data.get("source") or {}).get("attribution") != ATTRIBUTION or (data.get("source") or {}).get("licence", {}).get("status") not in ("unresolved", "government-work", "cc-by-nd-4.0"):
        out.append("attribution / licence status")
    blocks = [(m, data.get("by_mode", {}).get(m)) for m in data.get("modes", [])] + [("overall", data.get("overall"))]
    for name, b in blocks:
        if not b:
            out.append(f"{name}: missing block")
            continue
        if b["usable"] > b["n"] or b["usable"] < 0:
            out.append(f"{name}: usable > n")
        q = b.get("lateness_days")
        if b["usable"] and not q:
            out.append(f"{name}: usable rows but no quantiles")
        if q and not (q["min"] <= q["p10"] <= q["median"] <= q["p90"] <= q["max"]):
            out.append(f"{name}: quantiles not ordered")
        s = b.get("share")
        if s and abs(s["late"] + s["early"] + s["on_time"] - 1) > 1e-3:
            out.append(f"{name}: shares do not sum to one")
        p = b.get("po_to_delivery_days") or {}
        if p.get("usable") and not (p["min"] <= p["p10"] <= p["median"] <= p["p90"] <= p["max"]):
            out.append(f"{name}: PO quantiles not ordered")
    return out


def offline_check(json_path=DATA_JSON, js_path=DATA_JS, md_path=DOC_MD, log=print):
    """The committed JS twin and Markdown are the renders of the committed JSON, and the JSON is sane. -> 0 | 1."""
    problems = []
    try:
        data = load_committed(json_path)
    except (OSError, ValueError) as e:
        log(f"offline-check: cannot read {json_path}: {e}")
        return 1
    if Path(json_path).read_text(encoding="utf-8").replace("\r\n", "\n") != render_json(data):
        problems.append("JSON is not in canonical form (sort_keys, 2-space indent)")
    if Path(js_path).read_text(encoding="utf-8").replace("\r\n", "\n") != render_js(data):
        problems.append("JS twin differs from the JSON")
    if Path(md_path).read_text(encoding="utf-8").replace("\r\n", "\n") != render_md(data):
        problems.append("Markdown differs from the render")
    problems += schema_problems(data)
    for p in problems:
        log("offline-check: " + p)
    log("offline-check: " + ("OK" if not problems else f"{len(problems)} problem(s)"))
    return 0 if not problems else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("command", nargs="?", choices=("fetch", "reduce"), help="fetch the CSV into the cache; reduce the cache into the committed files")
    ap.add_argument("--cache", default=str(CACHE))
    ap.add_argument("--check", action="store_true", help="fetch + reduce into a temp dir and compare with the committed files (network)")
    ap.add_argument("--offline-check", action="store_true", help="the committed JS twin and Markdown agree with the JSON (no network)")
    a = ap.parse_args(argv)
    if a.offline_check:
        return offline_check()
    if a.check:
        with tempfile.TemporaryDirectory() as td:
            cache = Path(a.cache)
            if not (cache / CSV_NAME).exists():
                fetch(cache)
            data = build(cache)
            tmp_json, tmp_js, tmp_md = Path(td) / "d.json", Path(td) / "d.js", Path(td) / "d.md"
            write_outputs(data, tmp_json, tmp_js, tmp_md)
            same = all(Path(p).read_text(encoding="utf-8").replace("\r\n", "\n") == Path(q).read_text(encoding="utf-8")
                       for p, q in ((DATA_JSON, tmp_json), (DATA_JS, tmp_js), (DOC_MD, tmp_md)))
            print("check: " + ("the committed files are what the cache reduces to" if same else "STALE - run reduce"))
            return 0 if same else 1
    if a.command == "fetch":
        fetch(Path(a.cache))
        return 0
    if a.command == "reduce":
        cache = Path(a.cache)
        if not (cache / CSV_NAME).exists():
            print("reduce: the cache is empty - run fetch first", file=sys.stderr)
            return 1
        data = build(cache)
        write_outputs(data)
        print(f"wrote {DATA_JSON.relative_to(ROOT)}, {DATA_JS.relative_to(ROOT)}, {DOC_MD.relative_to(ROOT)}")
        for m in data["modes"] + ["overall"]:
            b = data["overall"] if m == "overall" else data["by_mode"][m]
            q = b["lateness_days"] or {}
            print(f"  {m:<16} n {b['n']:5d} usable {b['usable']:5d}  lateness min {_fmt(q.get('min'))} p10 {_fmt(q.get('p10'))} median {_fmt(q.get('median'))} p90 {_fmt(q.get('p90'))} max {_fmt(q.get('max'))}")
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())

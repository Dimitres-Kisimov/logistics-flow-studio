"""tools/online_retail.py - a real order book behind the demo (v3.69).

Everything the flow simulation consumed until now was DECLARED: an order mix with
illustrative shares, a synthetic article list, quantities drawn from a teaching
distribution. This tool replaces the demand side of the demo with a public record of
real transactions, and reduces it to four small committed files.

THE DATASET
  Online Retail II - "all the transactions occurring for a UK-based and registered,
  non-store online retail between 01/12/2009 and 09/12/2011" (UCI Machine Learning
  Repository, dataset 502). 1,067,371 rows, eight columns: Invoice, StockCode,
  Description, Quantity, InvoiceDate, Price, Customer ID, Country.
  Licence: Creative Commons Attribution 4.0 International (CC BY 4.0) - derived data
  may be redistributed with attribution, which is why a real SKU master and a real
  trading day's order lines can be committed here at all.
  Cite as: Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning
  Repository. https://doi.org/10.24432/C5CG6D

  IT IS A UK ONLINE GIFT RETAILER, NOT A GERMAN DISTRIBUTION CENTRE. What transfers is
  the SHAPE of demand - how many lines an order has, how concentrated the picks are,
  what time of day orders arrive. Nothing about this retailer's building, staffing or
  rates is used or implied.

THE REDUCTION RULE (stated once, applied everywhere, recorded in the JSON):
  1. A row is USABLE when Invoice and StockCode are non-empty and Quantity and
     InvoiceDate parse. Anything else is counted by reason and never filled in.
  2. An invoice whose number starts with "C" is a CANCELLATION - the dataset's own
     documentation says so ("codes starting with 'c' indicate cancellations"). Its
     lines are counted and then excluded from every demand statistic. A cancellation
     is NOT a customer return: this dataset contains no return, so the app's returns
     share stays a teaching value and the cancellation rate is reported as what it is.
  3. A non-positive Quantity outside a cancellation is counted and excluded.
  4. A StockCode is a PHYSICAL ARTICLE only if it matches five digits with an optional
     letter suffix, which is the form the dataset documents. Everything else is an
     administrative code (postage, bank charges, manual adjustments, samples) that no
     warehouse picks; each such code is listed with its line count and excluded.
  5. Quantiles are NEAREST-RANK on the sorted usable values (the same rule as
     tools/scms_delivery.py), never interpolated.
  6. ABC classes are cut on the measured cumulative share of UNITS: A up to 80 %,
     B up to 95 %, C the rest. The cut points are recorded as SKU counts and shares,
     so the reader can see how far the real curve is from the textbook 80/20.
  7. `weekly_picks` for the article master is LINES per week, not units per week: a
     line is one pick at a face. It is the SKU's total usable lines divided by the
     number of whole weeks the dataset spans.
  8. The article master is the top N SKUs by units (N = 2000, the app's article cap).
     The demo day's lines are then restricted to that master; the lines dropped by the
     restriction are counted and reported, never silently discarded.

OUTPUT (four small files, all reviewable)
  data/online-retail.json   the reduction: scale, rejects, five distributions, the
                            hour-of-day and weekday shape, the ABC curve, the
                            cancellation rate, the per-day table and the chosen day
  data/online-retail.js     the JS twin (WT.datasets.onlineRetail)
  data/demo-skus.csv        sku,description,weekly_picks,class  - the real article master
  data/demo-orders.csv      order_id,sku,qty                    - one real trading day
  docs/ONLINE_RETAIL.md     generated: the source, the licence, the rule, the tables

    python tools/online_retail.py fetch            # download the workbook (~45 MB) into .cache/online-retail/ (git-ignored)
    python tools/online_retail.py reduce           # cache -> the four files + the docs page
    python tools/online_retail.py reduce --day 2010-12-01
    python tools/online_retail.py days             # print the per-day table from the cache and stop
    python tools/online_retail.py --check          # fetch + reduce into a temp dir, compare with the committed files (network)
    python tools/online_retail.py --offline-check  # the JS twin, the CSVs and the docs page agree with the JSON (no network)
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "online-retail"
URL = "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip"
ZIP_NAME = "online+retail+ii.zip"
INNER = "online_retail_II.xlsx"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EPOCH = dt.datetime(1899, 12, 30)  # Excel 1900 date system, as written by the workbook
COL_RE = re.compile(r"([A-Z]+)")
PHYSICAL_RE = re.compile(r"^\d{5}[A-Za-z]?$")
MAX_ARTICLES = 2000  # the app's article-CSV cap (data.js LIMITS.maxArticles)
# A busy mid-week trading day in the record, chosen deliberately: a planner sizes a floor for a
# peak, not for an average, and the single busiest days in this dataset are pre-Christmas outliers.
DEFAULT_DAY = "2011-11-16"

SCHEMA = "wt-online-retail/v1"
LICENCE = "Creative Commons Attribution 4.0 International (CC BY 4.0)"
CITATION = "Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D"
CAVEAT = (
    "A UK-based, non-store online gift retailer, 2009-12-01 to 2011-12-09. What is used here is the SHAPE of demand - "
    "lines per order, the concentration of picks across articles, the time of day orders arrive. Nothing about this "
    "retailer's building, staffing, rates or geography is used or implied, and no claim is made that a German "
    "distribution centre would see this demand. An invoice beginning with C is a CANCELLATION, which is not a customer "
    "return: this dataset contains no returns, so the app's returns share remains a teaching value."
)


# ---- fetch ---------------------------------------------------------------------------
def fetch(cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    out = cache / ZIP_NAME
    if out.exists() and out.stat().st_size > 1_000_000:
        print(f"cached {out.name} ({out.stat().st_size:,} bytes)")
        return out
    print(f"downloading {URL}")
    req = urllib.request.Request(URL, headers={"User-Agent": "warehousetwin-dataset-tool"})
    with urllib.request.urlopen(req, timeout=300) as r:
        blob = r.read()
    out.write_bytes(blob)
    print(f"wrote {out.name} ({len(blob):,} bytes)")
    return out


def workbook(zip_path: Path) -> zipfile.ZipFile:
    outer = zipfile.ZipFile(zip_path)
    names = [n for n in outer.namelist() if n.lower().endswith(".xlsx")]
    if not names:
        raise SystemExit(f"no .xlsx inside {zip_path.name}")
    return zipfile.ZipFile(io.BytesIO(outer.open(names[0]).read()))


# ---- the streaming spreadsheet reader (standard library only) ---------------------------
def shared_strings(x: zipfile.ZipFile):
    out = []
    with x.open("xl/sharedStrings.xml") as f:
        for _, el in ET.iterparse(f, ("end",)):
            if el.tag == NS + "si":
                out.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    return out


def sheet_rows(x: zipfile.ZipFile, sheet: str, sst):
    """Yield {column letter: text} per row, clearing as we go: the sheets are ~150 MB of XML each."""
    with x.open(sheet) as f:
        for _, el in ET.iterparse(f, ("end",)):
            if el.tag != NS + "row":
                continue
            cells = {}
            for c in el.findall(NS + "c"):
                m = COL_RE.match(c.get("r") or "")
                if not m:
                    continue
                t, v = c.get("t"), c.find(NS + "v")
                if t == "inlineStr":
                    isel = c.find(NS + "is")
                    val = "".join(tt.text or "" for tt in isel.iter(NS + "t")) if isel is not None else ""
                elif v is None or v.text is None:
                    val = ""
                elif t == "s":
                    val = sst[int(v.text)]
                else:
                    val = v.text
                cells[m.group(1)] = val
            el.clear()
            yield cells


def sheet_names(x: zipfile.ZipFile):
    return sorted(n for n in x.namelist() if n.startswith("xl/worksheets/sheet"))


# ---- statistics ------------------------------------------------------------------------
def nearest_rank(sorted_vals, q):
    """The q-quantile by nearest rank - no interpolation, so every value is one that occurs."""
    if not sorted_vals:
        return None
    k = max(1, math.ceil(q * len(sorted_vals)))
    return sorted_vals[min(k, len(sorted_vals)) - 1]


def spread(vals):
    s = sorted(vals)
    if not s:
        return None
    return {"n": len(s), "min": s[0], "p10": nearest_rank(s, 0.10), "median": nearest_rank(s, 0.50),
            "p90": nearest_rank(s, 0.90), "max": s[-1], "mean": round(sum(s) / len(s), 2)}


# ---- the reduction ---------------------------------------------------------------------
def build(cache: Path, day: str):
    zip_path = cache / ZIP_NAME
    if not zip_path.exists():
        raise SystemExit(f"{zip_path} is missing - run: python tools/online_retail.py fetch")
    blob = zip_path.read_bytes()
    src = {"url": URL, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
           "licence": LICENCE, "citation": CITATION, "caveat": CAVEAT}
    x = workbook(zip_path)
    sst = shared_strings(x)

    rows_total = 0
    rejected = Counter()
    admin_codes = Counter()
    inv_lines, inv_units, inv_when = Counter(), Counter(), {}
    cancel_invoices = set()
    sku_units, sku_lines, sku_desc = Counter(), Counter(), {}
    qty_per_line = []
    hours, weekdays = Counter(), Counter()
    by_day = defaultdict(lambda: {"invoices": set(), "lines": 0, "units": 0})
    day_lines = []  # (invoice, sku, qty) for the chosen day
    first_dt = last_dt = None
    want = dt.date.fromisoformat(day)

    for sheet in sheet_names(x):
        for i, cells in enumerate(sheet_rows(x, sheet, sst)):
            if i == 0:
                continue  # the header row of each sheet
            rows_total += 1
            inv = (cells.get("A") or "").strip()
            code = (cells.get("B") or "").strip()
            desc = (cells.get("C") or "").strip()
            if not inv or not code:
                rejected["missing invoice or stock code"] += 1
                continue
            try:
                qty = int(float(cells.get("D") or ""))
            except ValueError:
                rejected["quantity is not a number"] += 1
                continue
            try:
                when = EPOCH + dt.timedelta(days=float(cells.get("E") or ""))
            except ValueError:
                rejected["invoice date is not a number"] += 1
                continue
            if first_dt is None or when < first_dt:
                first_dt = when
            if last_dt is None or when > last_dt:
                last_dt = when
            if inv[:1].upper() == "C":
                cancel_invoices.add(inv)
                rejected["cancellation line (invoice begins with C)"] += 1
                continue
            if qty <= 0:
                rejected["non-positive quantity outside a cancellation"] += 1
                continue
            if not PHYSICAL_RE.match(code):
                admin_codes[code] += 1
                rejected["administrative stock code, not a picked article"] += 1
                continue
            inv_lines[inv] += 1
            inv_units[inv] += qty
            if inv not in inv_when:
                inv_when[inv] = when
                hours[when.hour] += 1
                weekdays[when.weekday()] += 1
            sku_units[code] += qty
            sku_lines[code] += 1
            if desc and code not in sku_desc:
                sku_desc[code] = desc
            qty_per_line.append(qty)
            d = by_day[when.date()]
            d["invoices"].add(inv)
            d["lines"] += 1
            d["units"] += qty
            if when.date() == want:
                day_lines.append((inv, code, qty))

    weeks = max(1, round((last_dt - first_dt).days / 7))
    ranked = sku_units.most_common()
    total_units = sum(n for _, n in ranked)

    # the measured ABC curve and its cut points
    curve, cuts, cum = [], {}, 0
    marks = [0.01, 0.05, 0.10, 0.20, 0.50]
    mi = 0
    cls_of = {}
    for i, (code, n) in enumerate(ranked, 1):
        cum += n
        share = cum / total_units
        cls_of[code] = "A" if share <= 0.80 else ("B" if share <= 0.95 else "C")
        while mi < len(marks) and i >= marks[mi] * len(ranked):
            curve.append({"top_share_of_skus": marks[mi], "skus": i, "share_of_units": round(share, 4)})
            mi += 1
        for name, lim in (("A", 0.80), ("B", 0.95)):
            if name not in cuts and share > lim:
                cuts[name] = {"skus": i - 1, "share_of_skus": round((i - 1) / len(ranked), 4), "at_share_of_units": lim}
    cuts.setdefault("A", {"skus": len(ranked), "share_of_skus": 1.0, "at_share_of_units": 0.80})
    cuts.setdefault("B", {"skus": len(ranked), "share_of_skus": 1.0, "at_share_of_units": 0.95})

    # the article master: the top N by units, with real lines-per-week and the measured class
    master = []
    for code, units in ranked[:MAX_ARTICLES]:
        master.append({"sku": code, "description": sku_desc.get(code, code),
                       "weekly_picks": round(sku_lines[code] / weeks, 2), "cls": cls_of[code],
                       "units": units, "lines": sku_lines[code]})
    in_master = {m["sku"] for m in master}

    # the chosen day, restricted to the master - the drop counted, never hidden
    kept = [(inv, code, qty) for inv, code, qty in day_lines if code in in_master]
    dropped = len(day_lines) - len(kept)
    order_no = {}
    orders = []
    for inv, code, qty in kept:
        if inv not in order_no:
            order_no[inv] = f"ORD-{len(order_no) + 1:04d}"
        orders.append({"order_id": order_no[inv], "sku": code, "qty": qty})

    days_table = sorted(
        ({"date": d.isoformat(), "weekday": d.strftime("%a"), "invoices": len(v["invoices"]), "lines": v["lines"], "units": v["units"]}
         for d, v in by_day.items()), key=lambda r: -r["lines"])[:15]

    data = {
        "schema": SCHEMA,
        "id": "online-retail-ii",
        "title": "Online Retail II - a public record of real order lines",
        "source": src,
        "rule": [
            "a row is usable when Invoice and StockCode are non-empty and Quantity and InvoiceDate parse",
            "an invoice beginning with C is a CANCELLATION (the dataset's own documentation); its lines are counted and excluded, and a cancellation is not a customer return",
            "a non-positive quantity outside a cancellation is counted and excluded",
            "a stock code is a physical article only in the documented form of five digits with an optional letter; every other code is administrative, listed and excluded",
            "quantiles are nearest-rank on the sorted usable values, never interpolated",
            "ABC is cut on the measured cumulative share of units: A to 80 %, B to 95 %, C the rest",
            "weekly_picks is LINES per week (a line is one pick), the SKU's usable lines over the whole weeks the dataset spans",
            f"the article master is the top {MAX_ARTICLES} SKUs by units (the app's article cap); the demo day's lines are restricted to it and the drop is reported",
        ],
        "scale": {
            "rows": rows_total,
            "sales_invoices": len(inv_lines),
            "cancellation_invoices": len(cancel_invoices),
            "cancellation_share_of_invoices": round(len(cancel_invoices) / max(1, len(cancel_invoices) + len(inv_lines)), 4),
            "articles_picked": len(sku_units),
            "administrative_codes": len(admin_codes),
            "usable_lines": len(qty_per_line),
            "first": first_dt.isoformat(sep=" ") if first_dt else None,
            "last": last_dt.isoformat(sep=" ") if last_dt else None,
            "weeks": weeks,
        },
        "rejected": dict(rejected.most_common()),
        "administrative_codes": [{"code": c, "lines": n} for c, n in admin_codes.most_common(20)],
        "lines_per_order": spread(list(inv_lines.values())),
        "units_per_order": spread(list(inv_units.values())),
        "quantity_per_line": spread(qty_per_line),
        "single_line_order_share": round(sum(1 for v in inv_lines.values() if v == 1) / max(1, len(inv_lines)), 4),
        "orders_by_hour": [{"hour": h, "orders": hours[h], "share": round(hours[h] / max(1, len(inv_when)), 4)} for h in range(24) if hours[h]],
        "orders_by_weekday": [{"weekday": d, "name": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d],
                               "orders": weekdays[d], "share": round(weekdays[d] / max(1, len(inv_when)), 4)} for d in range(7)],
        "abc": {"curve": curve, "cuts": cuts, "total_units": total_units, "articles": len(ranked)},
        "busiest_days": days_table,
        "demo_day": {
            "date": day, "weekday": want.strftime("%a"),
            "orders": len(order_no), "lines": len(orders), "units": sum(o["qty"] for o in orders),
            "lines_before_master_restriction": len(day_lines), "lines_dropped_by_restriction": dropped,
        },
        "article_master": {"skus": len(master), "cap": MAX_ARTICLES,
                           "share_of_units": round(sum(m["units"] for m in master) / max(1, total_units), 4),
                           "by_class": dict(Counter(m["cls"] for m in master))},
        "honesty": CAVEAT,
    }
    return data, master, orders


# ---- writing -----------------------------------------------------------------------------
def write_json(data, root: Path):
    p = root / "data" / "online-retail.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return p


def write_js(data, root: Path):
    p = root / "data" / "online-retail.js"
    body = json.dumps(data, indent=1, sort_keys=True)
    text = ("/* data/online-retail.js - generated by tools/online_retail.py. Do not edit.\n"
            " * " + CITATION + "\n"
            " * Licence: " + LICENCE + "\n"
            " */\n"
            "(function () {\n"
            '  "use strict";\n'
            "  const WT = (window.WT = window.WT || {});\n"
            "  WT.datasets = WT.datasets || {};\n"
            "  WT.datasets.onlineRetail = " + body + ";\n"
            "})();\n")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")
    return p


def write_csvs(master, orders, root: Path):
    a = root / "data" / "demo-skus.csv"
    with a.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["sku", "description", "weekly_picks", "class"])
        for m in master:
            w.writerow([m["sku"], m["description"], m["weekly_picks"], m["cls"]])
    o = root / "data" / "demo-orders.csv"
    with o.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["order_id", "sku", "qty"])
        for r in orders:
            w.writerow([r["order_id"], r["sku"], r["qty"]])
    return a, o


def markdown(data):
    s, d = data["scale"], data["demo_day"]
    L = []
    L.append("# A real order book behind the demo (v3.69)")
    L.append("")
    L.append("*Generated by `python tools/online_retail.py reduce`. Do not edit by hand.*")
    L.append("")
    L.append("Everything the flow simulation consumed until now was declared: an order mix with illustrative shares, a synthetic article list, quantities from a teaching distribution. The demo's demand is now a public record of real transactions.")
    L.append("")
    L.append("## The source")
    L.append("")
    L.append(f"- **{data['title']}** — {CITATION}")
    L.append(f"- Licence: **{LICENCE}**. Derived data may be redistributed with attribution, which is why a real article master and a real trading day can be committed here.")
    L.append(f"- Downloaded from `{data['source']['url']}` — {data['source']['bytes']:,} bytes, SHA-256 `{data['source']['sha256'][:16]}…`")
    L.append("")
    L.append("> " + CAVEAT)
    L.append("")
    L.append("## The reduction rule")
    L.append("")
    for i, r in enumerate(data["rule"], 1):
        L.append(f"{i}. {r}")
    L.append("")
    L.append("## Scale")
    L.append("")
    L.append("| | |")
    L.append("|---|---|")
    L.append(f"| Rows in the workbook | {s['rows']:,} |")
    L.append(f"| Period | {s['first']} → {s['last']} ({s['weeks']} whole weeks) |")
    L.append(f"| Sales invoices | {s['sales_invoices']:,} |")
    L.append(f"| Cancellation invoices | {s['cancellation_invoices']:,} (**{s['cancellation_share_of_invoices']:.2%}** of all invoices) |")
    L.append(f"| Articles actually picked | {s['articles_picked']:,} |")
    L.append(f"| Administrative codes excluded | {s['administrative_codes']:,} |")
    L.append(f"| Usable order lines | {s['usable_lines']:,} |")
    L.append("")
    L.append("### What was rejected, and why")
    L.append("")
    L.append("| Reason | Lines |")
    L.append("|---|---|")
    for k, v in sorted(data["rejected"].items(), key=lambda kv: (-kv[1], kv[0])):
        L.append(f"| {k} | {v:,} |")
    L.append("")
    L.append("The largest administrative codes, excluded because no warehouse picks them: " +
             ", ".join(f"`{c['code']}` ({c['lines']:,})" for c in data["administrative_codes"][:8]) + ".")
    L.append("")
    L.append("## The shape of demand")
    L.append("")
    L.append("| | n | min | p10 | median | p90 | max | mean |")
    L.append("|---|---|---|---|---|---|---|---|")
    for key, label in (("lines_per_order", "Lines per order"), ("units_per_order", "Units per order"), ("quantity_per_line", "Quantity per line")):
        v = data[key]
        L.append(f"| {label} | {v['n']:,} | {v['min']} | {v['p10']} | **{v['median']}** | {v['p90']} | {v['max']:,} | {v['mean']} |")
    L.append("")
    L.append(f"{data['single_line_order_share']:.2%} of orders are a single line. The maxima are real and extreme — one order line of {data['quantity_per_line']['max']:,} units exists in the record — which is exactly why the app uses nearest-rank quantiles rather than a mean.")
    L.append("")
    L.append("### When orders arrive")
    L.append("")
    L.append("| Hour | Orders | Share |")
    L.append("|---|---|---|")
    for h in data["orders_by_hour"]:
        L.append(f"| {h['hour']:02d}:00 | {h['orders']:,} | {h['share']:.2%} |")
    L.append("")
    L.append("| Weekday | Orders | Share |")
    L.append("|---|---|---|")
    for w in data["orders_by_weekday"]:
        L.append(f"| {w['name']} | {w['orders']:,} | {w['share']:.2%} |")
    L.append("")
    L.append("Two things a declared arrival curve would not have told you: this retailer barely trades on Saturday, and it trades on Sunday. Both are in the record.")
    L.append("")
    L.append("### How concentrated the picking is")
    L.append("")
    L.append("| Top share of articles | Articles | Share of units |")
    L.append("|---|---|---|")
    for c in data["abc"]["curve"]:
        L.append(f"| {c['top_share_of_skus']:.0%} | {c['skus']:,} | **{c['share_of_units']:.2%}** |")
    L.append("")
    a, b = data["abc"]["cuts"]["A"], data["abc"]["cuts"]["B"]
    L.append(f"Cut on units, class **A** is the first {a['skus']:,} articles ({a['share_of_skus']:.2%} of the range) and class **B** reaches {b['skus']:,} ({b['share_of_skus']:.2%}). The textbook says 20 % of articles carry 80 % of the volume; the measured curve says {data['abc']['curve'][3]['top_share_of_skus']:.0%} carry {data['abc']['curve'][3]['share_of_units']:.2%}. Close, and now it is a measurement rather than a slogan.")
    L.append("")
    L.append("## The two committed files")
    L.append("")
    am = data["article_master"]
    L.append(f"- **`data/demo-skus.csv`** — the top {am['skus']:,} articles by units ({am['share_of_units']:.2%} of all units), with real lines-per-week and the measured ABC class. Classes: " +
             ", ".join(f"{k} {v:,}" for k, v in sorted(am["by_class"].items())) + ".")
    L.append(f"  There is no class **C** in the master, and that is arithmetic rather than an omission: class B reaches article {b['skus']:,} in the ranking and the master stops at {am['skus']:,}, so every article slow enough to be a C falls outside it. A floor built from this master is therefore a floor for the fast and medium movers only.")
    L.append(f"- **`data/demo-orders.csv`** — one real trading day, **{d['date']} ({d['weekday']})**: {d['orders']:,} orders, {d['lines']:,} lines, {d['units']:,} units. "
             f"{d['lines_before_master_restriction']:,} lines were recorded that day; {d['lines_dropped_by_restriction']:,} fell outside the article master and are reported here rather than dropped quietly.")
    L.append("")
    L.append("Order ids are renumbered `ORD-0001…` in file order. The real invoice numbers and every customer id are left behind: the app has no use for them and no business holding them.")
    L.append("")
    L.append("### The busiest days in the record")
    L.append("")
    L.append("| Date | Day | Orders | Lines | Units |")
    L.append("|---|---|---|---|---|")
    for r in data["busiest_days"][:10]:
        mark = " ← chosen" if r["date"] == d["date"] else ""
        L.append(f"| {r['date']}{mark} | {r['weekday']} | {r['invoices']:,} | {r['lines']:,} | {r['units']:,} |")
    L.append("")
    L.append("## Reproduce")
    L.append("")
    L.append("```sh")
    L.append("python tools/online_retail.py fetch")
    L.append("python tools/online_retail.py reduce")
    L.append("python tools/online_retail.py --offline-check")
    L.append("```")
    return "\n".join(L) + "\n"


def write_md(data, root: Path):
    p = root / "docs" / "ONLINE_RETAIL.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(markdown(data), encoding="utf-8", newline="\n")
    return p


def write_all(data, master, orders, root: Path):
    out = [write_json(data, root), write_js(data, root)]
    out += list(write_csvs(master, orders, root))
    out.append(write_md(data, root))
    for p in out:
        print(f"wrote {p.relative_to(root)} ({p.stat().st_size:,} bytes)")
    return out


# ---- checks ------------------------------------------------------------------------------
def offline_check(root: Path):
    j = json.loads((root / "data" / "online-retail.json").read_text(encoding="utf-8"))
    js = (root / "data" / "online-retail.js").read_text(encoding="utf-8")
    start, end = js.index("WT.datasets.onlineRetail = ") + len("WT.datasets.onlineRetail = "), js.rindex(";\n})();")
    twin = json.loads(js[start:end])
    problems = []
    if twin != j:
        problems.append("data/online-retail.js does not carry the same object as the JSON")
    if j["schema"] != SCHEMA:
        problems.append(f"schema is {j['schema']}, expected {SCHEMA}")
    md = (root / "docs" / "ONLINE_RETAIL.md").read_text(encoding="utf-8")
    if md != markdown(j):
        problems.append("docs/ONLINE_RETAIL.md is stale against the JSON")
    for token in (LICENCE, "10.24432/C5CG6D", "cancellation"):
        if token.lower() not in md.lower():
            problems.append(f"the docs page does not carry {token!r}")
    with (root / "data" / "demo-skus.csv").open(encoding="utf-8") as f:
        skus = list(csv.DictReader(f))
    with (root / "data" / "demo-orders.csv").open(encoding="utf-8") as f:
        orders = list(csv.DictReader(f))
    if list(skus[0].keys()) != ["sku", "description", "weekly_picks", "class"]:
        problems.append("demo-skus.csv header is not sku,description,weekly_picks,class")
    if list(orders[0].keys()) != ["order_id", "sku", "qty"]:
        problems.append("demo-orders.csv header is not order_id,sku,qty")
    if len(skus) != j["article_master"]["skus"]:
        problems.append(f"demo-skus.csv has {len(skus)} rows, the JSON says {j['article_master']['skus']}")
    if len(orders) != j["demo_day"]["lines"]:
        problems.append(f"demo-orders.csv has {len(orders)} rows, the JSON says {j['demo_day']['lines']}")
    if len(skus) > MAX_ARTICLES:
        problems.append(f"demo-skus.csv exceeds the app's article cap of {MAX_ARTICLES}")
    known = {r["sku"] for r in skus}
    unknown = {r["sku"] for r in orders} - known
    if unknown:
        problems.append(f"{len(unknown)} order skus are not in the article master")
    if sum(int(r["qty"]) for r in orders) != j["demo_day"]["units"]:
        problems.append("the order file's units do not sum to the JSON's demo_day units")
    if len({r["order_id"] for r in orders}) != j["demo_day"]["orders"]:
        problems.append("the order file's distinct order ids do not match the JSON's demo_day orders")
    if any(int(r["qty"]) <= 0 for r in orders):
        problems.append("an order line has a non-positive quantity")
    if not all(PHYSICAL_RE.match(r["sku"]) for r in skus):
        problems.append("an article in the master is not in the documented five-digit form")
    for p in problems:
        print("FAIL " + p)
    if problems:
        return 1
    print(f"offline check OK: {len(skus):,} articles, {len(orders):,} order lines on {j['demo_day']['date']}, "
          f"{j['scale']['rows']:,} rows reduced, licence {LICENCE}")
    return 0


def network_check(root: Path, day: str):
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        fetch(tmp)
        data, master, orders = build(tmp, day)
        out = Path(td) / "out"
        (out / "data").mkdir(parents=True)
        (out / "docs").mkdir(parents=True)
        write_all(data, master, orders, out)
        bad = []
        for rel in ("data/online-retail.json", "data/online-retail.js", "data/demo-skus.csv", "data/demo-orders.csv", "docs/ONLINE_RETAIL.md"):
            a = (out / rel).read_text(encoding="utf-8")
            b = (root / rel).read_text(encoding="utf-8") if (root / rel).exists() else ""
            if a.replace("\r\n", "\n") != b.replace("\r\n", "\n"):
                bad.append(rel)
        if bad:
            print("FAIL the committed files differ from a fresh reduction: " + ", ".join(bad))
            return 1
        print("network check OK: a fresh download and reduction reproduces every committed file")
        return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", nargs="?", choices=("fetch", "reduce", "days"))
    ap.add_argument("--cache", default=str(CACHE))
    ap.add_argument("--day", default=DEFAULT_DAY, help="the real trading day to commit as the demo order file")
    ap.add_argument("--check", action="store_true", help="fetch + reduce into a temp dir and compare with the committed files (network)")
    ap.add_argument("--offline-check", action="store_true", help="the JS twin, the CSVs and the docs page agree with the JSON (no network)")
    a = ap.parse_args(argv)
    if a.offline_check:
        return offline_check(ROOT)
    if a.check:
        return network_check(ROOT, a.day)
    if a.command == "fetch":
        fetch(Path(a.cache))
        return 0
    if a.command == "days":
        data, _, _ = build(Path(a.cache), a.day)
        print(f"{'date':12s} {'day':4s} {'orders':>7s} {'lines':>7s} {'units':>9s}")
        for r in data["busiest_days"]:
            print(f"{r['date']:12s} {r['weekday']:4s} {r['invoices']:>7,} {r['lines']:>7,} {r['units']:>9,}")
        return 0
    if a.command == "reduce":
        data, master, orders = build(Path(a.cache), a.day)
        write_all(data, master, orders, ROOT)
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())

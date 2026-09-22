"""tools/make_sample_data.py - a synthetic, seeded SKU master and order file (v3.44).

Writes docs/examples/skus.csv and docs/examples/orders.csv in exactly the two headers
wmsdata.js imports -

    sku,description,abc_class,velocity,weight_kg,storage_type
    order_id,sku,qty

- plus docs/examples/README.md that says what they are. SYNTHETIC: no real inventory,
no real orders, no personal data; a teaching file to try the planner, the flow and the
run ledger on "your own data" before you bring yours. Deterministic: the same seed writes
the same bytes (LF line ends), and `--check` exits 1 when the committed files are stale.

    python tools/make_sample_data.py            # (re)write the three files
    python tools/make_sample_data.py --check    # are the committed files what this script writes?
"""
import argparse
import csv
import io
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "examples"
SEED = 20260922
N_SKUS = 120
N_ORDERS = 300
LINES = (1, 6)  # lines per order, inclusive
QTY = (1, 12)  # eaches per line, inclusive
FAMILIES = ("bracket", "hinge", "gasket", "valve", "filter", "cable", "sensor", "bearing", "clamp", "housing", "spring", "nozzle")
VARIANTS = ("M6", "M8", "M10", "DN15", "DN25", "type 2", "type 3", "long", "short")
SKU_HEADER = ("sku", "description", "abc_class", "velocity", "weight_kg", "storage_type")
ORDER_HEADER = ("order_id", "sku", "qty")


def sku_rows(rng: random.Random) -> list[dict]:
    """120 articles: a rank-based velocity (a Pareto-like tail), ABC by rank 20 / 30 / 50, a weight."""
    rows = []
    for i in range(N_SKUS):
        velocity = max(1, round(2000 * (i + 1) ** -0.9))
        cls = "A" if i < N_SKUS * 0.2 else ("B" if i < N_SKUS * 0.5 else "C")
        rows.append({
            "sku": f"SKU-{i + 1:04d}",
            "description": f"{FAMILIES[i % len(FAMILIES)]} {rng.choice(VARIANTS)}",
            "abc_class": cls,
            "velocity": velocity,
            "weight_kg": f"{rng.uniform(0.1, 12.0):.1f}",
            "storage_type": "",  # left blank on purpose: the importer derives it from class and weight
        })
    return rows


def order_rows(rng: random.Random, skus: list[dict]) -> list[dict]:
    """300 orders of 1-6 distinct lines, articles drawn by velocity, 1-12 eaches per line."""
    weights = [int(s["velocity"]) for s in skus]
    rows = []
    for o in range(N_ORDERS):
        n = rng.randint(*LINES)
        picked: list[str] = []
        while len(picked) < n:
            s = rng.choices(skus, weights=weights)[0]["sku"]
            if s not in picked:
                picked.append(s)
        for s in picked:
            rows.append({"order_id": f"ORD-{o + 1:04d}", "sku": s, "qty": rng.randint(*QTY)})
    return rows


def to_csv(rows: list[dict], header: tuple) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(header), lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def readme(skus: list[dict], orders: list[dict]) -> str:
    n_orders = len({r["order_id"] for r in orders})
    return (
        "# Sample data (synthetic)\n\n"
        f"`skus.csv` ({len(skus)} articles) and `orders.csv` ({n_orders} orders, {len(orders)} lines) are a **synthetic, seeded**\n"
        "SKU master and order file written by `tools/make_sample_data.py` (seed 20260922). No real inventory,\n"
        "no real orders, no personal data - a teaching file to try the planner, the live flow and the run ledger on\n"
        "\"your own data\" before you bring yours. `python tools/make_sample_data.py --check` proves the committed\n"
        "files are what the script writes.\n\n"
        "**Headers** (exactly what `wmsdata.js` imports; the importer also accepts common aliases):\n\n"
        "```\n"
        "sku,description,abc_class,velocity,weight_kg,storage_type\n"
        "order_id,sku,qty\n"
        "```\n\n"
        "`velocity` is picks per week (a rank-based tail: the first article moves most); `abc_class` is by rank\n"
        "(20 / 30 / 50 %); `storage_type` is left blank so the importer derives it from class and weight; every\n"
        "order has 1-6 distinct lines of 1-12 eaches, articles drawn in proportion to their velocity.\n\n"
        "**Use them:** in the planner, *Data & storage* -> import the SKU master, then the order pool; play the\n"
        "live flow and open the run in the run-ledger viewer (or `run-ledger.html?example=d`, the recorded run of\n"
        "the e-commerce floor fed with this file). `node tools/make_run_ledger_fixture.mjs d` records that run\n"
        "through the same importer. See README \"Run it on your own data\".\n"
    )


def render() -> dict:
    rng = random.Random(SEED)
    skus = sku_rows(rng)
    orders = order_rows(rng, skus)
    return {"skus.csv": to_csv(skus, SKU_HEADER), "orders.csv": to_csv(orders, ORDER_HEADER), "README.md": readme(skus, orders)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 when the committed files differ from what this script writes")
    a = ap.parse_args(argv)
    files = render()
    if a.check:
        stale = [n for n, text in files.items() if not (OUT / n).exists() or (OUT / n).read_text(encoding="utf-8").replace("\r\n", "\n") != text]
        print("docs/examples sample data is " + ("fresh" if not stale else "STALE: " + ", ".join(stale)))
        return 1 if stale else 0
    OUT.mkdir(parents=True, exist_ok=True)
    for n, text in files.items():
        with open(OUT / n, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"wrote {OUT / n} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

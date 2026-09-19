"""Auditable resource screening, not a scheduler or electrical/gas design tool.

Python standard library only. Run --help for profile selection and JSON/CSV/HTML export.
All inputs describe ONE common planning window; energy rows are non-overlapping
interval totals at the same boundary, not cumulative meter-register readings.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import re
from pathlib import Path

PROFILES = ("assembly-warehouse", "process-manufacturing")
ROOT = Path(__file__).resolve().parents[1]


def number(row, key, *, positive=False, signed=False):
    value = row[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{key} must be a number")
    if not math.isfinite(value) or (not signed and value < 0) or (positive and value <= 0):
        raise ValueError(f"{key} is outside its allowed range")
    return value


def unique(rows, key):
    seen = set()
    for row in rows:
        value = row[key]
        if not isinstance(value, str) or not value.strip() or value in seen:
            raise ValueError(f"{key} must be a unique non-empty string")
        seen.add(value)


def evaluate(data):
    if type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1 or data["profile"] not in PROFILES:
        raise ValueError("Unsupported schema or profile")
    if data["dataStatus"] not in ("synthetic", "user-supplied"):
        raise ValueError("Declare synthetic or user-supplied dataStatus")
    if not isinstance(data["source"], str) or not data["source"].strip():
        raise ValueError("A source description is required")
    shift = data["shift"]
    paid = number(shift, "paidMinutes", positive=True)
    available = paid - number(shift, "breakMinutes") - number(shift, "otherUnavailableMinutes")
    if available <= 0:
        raise ValueError("No productive time remains")
    demand, skill_totals = [], {}
    unique(data["orders"], "id")
    for order in data["orders"]:
        qty = number(order, "quantity", positive=True)
        if not order["unit"] or not order["skill"]:
            raise ValueError("Order unit and skill are required")
        labour = qty * number(order, "labourMinutesPerUnit") + number(order, "setupLabourMinutes")
        skill_totals[order["skill"]] = skill_totals.get(order["skill"], 0) + labour
        demand.append({"order": order["id"], "quantity": qty, "unit": order["unit"],
                       "skill": order["skill"], "labourMinutes": labour})
    staffing = [{"skill": skill, "labourMinutes": minutes,
                 "productiveMinutesPerWorker": available,
                 "workerLowerBound": math.ceil(minutes / available)}
                for skill, minutes in sorted(skill_totals.items())]
    stock = []
    unique(data["inventory"], "sku")
    for row in data["inventory"]:
        if not row["unit"]:
            raise ValueError("Inventory unit is required")
        opening = number(row, "opening")
        incoming = sum(number(row, key) for key in ("receipts", "produced", "returns"))
        outgoing = sum(number(row, key) for key in ("issues", "dispatch", "scrap"))
        closing = opening + incoming - outgoing + number(row, "adjustment", signed=True)
        reserved = number(row, "reservedAtClose")
        stock.append({"sku": row["sku"], "unit": row["unit"], "closing": closing,
                      "availableAtClose": closing - reserved,
                      "status": "shortage" if closing < reserved else "closing-balance-only"})
    energy, previous_end = [], None
    unique(data["electricity"], "id")
    for row in data["electricity"]:
        start = number(row, "startMinute")
        duration = number(row, "durationMinutes", positive=True)
        if start + duration > paid or (previous_end is not None and start < previous_end):
            raise ValueError("Electricity intervals must be ordered, non-overlapping and inside shift")
        previous_end = start + duration
        values = {key: number(row, key) for key in (
            "importKWh", "exportKWh", "generationKWh", "batteryDischargeKWh",
            "batteryChargeKWh", "loadKWh", "lossKWh")}
        supply = values["importKWh"] + values["generationKWh"] + values["batteryDischargeKWh"]
        use = values["exportKWh"] + values["loadKWh"] + values["batteryChargeKWh"] + values["lossKWh"]
        residual = supply - use
        energy.append({"interval": row["id"], "durationMinutes": duration,
                       "importKWh": values["importKWh"], "exportKWh": values["exportKWh"],
                       "netImportKWh": values["importKWh"] - values["exportKWh"],
                       "intervalAverageImportKW": values["importKWh"] * 60 / duration,
                       "residualKWh": residual,
                       "status": "balanced" if abs(residual) <= 1e-6 else "unreconciled"})
    picks = data.get("picking")
    picking = None
    if picks is not None:
        count = number(picks, "completedPicks")
        productive = number(picks, "productiveLabourHours", positive=True)
        paid_hours = number(picks, "paidLabourHours", positive=True)
        if productive > paid_hours or not picks["definition"]:
            raise ValueError("Picking needs a definition and productive hours <= paid hours")
        picking = {"definition": picks["definition"],
                   "picksPerProductiveLabourHour": count / productive,
                   "picksPerPaidLabourHour": count / paid_hours}
    canonical = json.dumps(data, sort_keys=True, allow_nan=False).encode()
    return {"modelVersion": "resource-screening-1", "profile": data["profile"],
            "dataStatus": data["dataStatus"], "source": data["source"],
            "inputSha256": hashlib.sha256(canonical).hexdigest(),
            "orders": demand, "staffing": staffing, "inventory": stock,
            "electricity": energy, "picking": picking,
            "electricityTotals": {"status": "supplied" if energy else "not-assessed",
                                  "importKWh": sum(r["importKWh"] for r in energy),
                                  "exportKWh": sum(r["exportKWh"] for r in energy),
                                  "netImportKWh": sum(r["netImportKWh"] for r in energy),
                                  "coverageFraction": sum(r["durationMinutes"] for r in energy) / paid},
            "limitations": [
                "Screening estimates, not a feasible schedule or ideal headcount.",
                "Skill bounds are independent; multi-skilled workers, concurrency, travel and precedence are not scheduled.",
                "Labour times are person-minutes, not unattended machine cycle times.",
                "Inventory checks closing balances only; intermediate shortages, BOM and event order are not evaluated.",
                "Energy is boundary interval accounting, not circuit, gas, protection or safety design.",
                "Input provenance is declared, not independently verified; no compliance certification.",
                "Process mode accepts material units but does not model reaction, batch or thermodynamic behaviour.",
            ]}


def csv_value(value):
    # Protect spreadsheet users from input-controlled formulas without altering JSON.
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def export(report, target):
    target.mkdir(parents=True, exist_ok=True)
    (target / "resource-plan.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    sections = []
    columns = {
        "orders": ["order", "quantity", "unit", "skill", "labourMinutes"],
        "staffing": ["skill", "labourMinutes", "productiveMinutesPerWorker", "workerLowerBound"],
        "inventory": ["sku", "unit", "closing", "availableAtClose", "status"],
        "electricity": ["interval", "durationMinutes", "importKWh", "exportKWh", "netImportKWh",
                        "intervalAverageImportKW", "residualKWh", "status"],
    }
    for name in ("orders", "staffing", "inventory", "electricity"):
        rows = report[name]
        with (target / f"{name}.csv").open("w", newline="", encoding="utf-8-sig") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns[name])
            writer.writeheader()
            writer.writerows({k: csv_value(v) for k, v in row.items()} for row in rows)
        if not rows:
            sections.append(f"<h2>{name.title()}</h2><p>No data supplied; not assessed.</p>")
            continue
        cells = "".join("<tr>" + "".join(f"<td>{html.escape(str(v))}</td>" for v in row.values())
                        + "</tr>" for row in rows)
        labels = {"labourMinutes": "Labour (person-min)", "productiveMinutesPerWorker": "Available min / worker",
                  "workerLowerBound": "Workers: workload bound", "availableAtClose": "Available at close",
                  "durationMinutes": "Interval (min)", "importKWh": "Import (kWh)", "exportKWh": "Export (kWh)",
                  "netImportKWh": "Net import (kWh)", "intervalAverageImportKW": "Average import (kW)",
                  "residualKWh": "Unexplained (kWh)"}
        heads = "".join(f"<th>{html.escape(labels.get(k, re.sub(r'(?<!^)(?=[A-Z])', ' ', k).title()))}</th>" for k in rows[0])
        sections.append(f"<h2>{name.title()}</h2><div class='table'><table><thead><tr>{heads}</tr>"
                        f"</thead><tbody>{cells}</tbody></table></div>")
    notes = "".join(f"<li>{html.escape(note)}</li>" for note in report["limitations"])
    totals = report["electricityTotals"]
    energy_summary = ("Electricity not assessed: no intervals supplied." if not report["electricity"]
                      else f"Electricity over supplied intervals: {totals['importKWh']:g} kWh imported / "
                      f"{totals['exportKWh']:g} kWh exported / {totals['netImportKWh']:g} kWh net import. "
                      f"Shift coverage: {totals['coverageFraction']:.0%}.")
    title = html.escape(report["profile"].replace("-", " ").title())
    pick = report["picking"]
    picking = ("Not supplied; not assessed." if pick is None else
               f"{pick['picksPerProductiveLabourHour']:g} picks / productive labour hour; "
               f"{pick['picksPerPaidLabourHour']:g} picks / paid labour hour. "
               + html.escape(pick["definition"]))
    page = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} | Resource review</title>
<style>body{{margin:0;background:#ece9e2;color:#232827;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:1120px;margin:auto;padding:40px 24px}}header{{border-top:5px solid #8b472d}}
h1{{font-size:clamp(28px,5vw,46px);line-height:1.15}}h2{{margin-top:36px;font-size:22px}}
.eyebrow{{letter-spacing:.13em;text-transform:uppercase;font-size:12px;font-weight:700}}
.summary{{padding:20px;background:#fff;border-left:4px solid #8b472d}}.table{{overflow-x:auto}}
table{{border-collapse:collapse;width:100%;background:#fff;font-size:14px}}td,th{{padding:12px;text-align:left;border-bottom:1px solid #ccc}}
th{{background:#dce1dc}}code{{overflow-wrap:anywhere}}li{{margin:8px 0}}@media print{{main{{padding:0}}table{{font-size:10px}}}}</style>
<main><header><p class="eyebrow">Factory operations / Resource screening</p><h1>{title}</h1>
<p>{html.escape(report['dataStatus'])} inputs · Modelled, not measured</p></header>
<div class="summary"><strong>Review workload, stock and electricity before scheduling.</strong>
<p>{energy_summary}</p>
<p>Staffing figures are workload lower bounds. They do not prove an order can finish on time.</p></div>
<p>Export: <a href="resource-plan.json" download>Complete JSON</a> · <a href="orders.csv" download>Orders CSV</a> ·
<a href="staffing.csv" download>Staffing CSV</a> · <a href="inventory.csv" download>Inventory CSV</a> ·
<a href="electricity.csv" download>Electricity CSV</a></p>
{''.join(sections)}<h2>Picking productivity</h2><p>{picking}</p>
<h2>What this review cannot establish</h2><ul>{notes}</ul>
<p>Source: {html.escape(report['source'])}</p><p>Input SHA256: <code>{report['inputSha256']}</code></p></main></html>"""
    (target / "resource-plan.html").write_text(page, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--profile", choices=PROFILES, help="Select a synthetic demonstration")
    source.add_argument("--input", type=Path, help="Use your versioned JSON scenario")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    path = args.input or ROOT / "examples" / f"resource-{args.profile}.json"
    try:
        report = evaluate(json.loads(path.read_text(encoding="utf-8")))
        export(report, args.out)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"Resource plan rejected: {error}\n")
    print(f"Wrote resource screening for {report['profile']} to {args.out}")


if __name__ == "__main__":
    main()

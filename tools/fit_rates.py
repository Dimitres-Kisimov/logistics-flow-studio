"""tools/fit_rates.py - the plant's own rates (v3.59): a site profile fitted from recorded events.

Replaces the teaching anchors of the error what-if (HEART / SPAR-H) and the delivery what-if (the USAID
SCMS lateness shape) with values measured on the plant's own records - aggregates per business step and
per trailer, never per person - and writes them as a SITE PROFILE the knowledge base loads as an
override (Settings & data -> Knowledge base -> Import KB, or WT.kb.importJson / applyProfile), each value
labelled `measured on <source>, n = ...` instead of `teaching value`.

    python tools/fit_rates.py fit --document <epcis.json> [--document ...] [--deliveries <trailers.csv>] --out <site-profile.json> [--site "<name>"]
    python tools/fit_rates.py fit --database <run.sqlite> [--run EPCIS-...] [--deliveries ...] --out <site-profile.json>
    python tools/fit_rates.py check <site-profile.json>

THE RULE (stated once; verify_fit_rates.js and test/test_fit_rates.py pin it by hand):
  - the event set is RECORDED: EPCIS 2.0 documents mapped by tools/epcis_import.py, or the tracking_event
    rows with source = 'imported' of a run-ledger database. Derived twins (the simulation's own) are
    refused - a fit on them would launder a teaching value into a "measurement";
  - per business step: events, objects, the events whose disposition is not in_progress and the share,
    the dispositions counted (descriptive; every step in the record);
  - the error shares, each the app's own error kind at its own step (routing.js ERROR_KINDS):
        hf.error.mis-pick      = mismatch_class events at picking            / picking events
        hf.error.wrong-putaway = sellable_not_accessible events at storing   / storing events
        hf.error.damage        = damaged events at unpacking + packing       / unpacking + packing events
    a value is fitted only when the step has at least one event (n >= 1); otherwise it is listed under
    not_fitted with the reason and the teaching value stays. The performance-shaping multipliers are NOT
    fitted: a measured share already contains whatever pressure, lighting and training the plant had;
    the multipliers stay levers for what-ifs on top of it;
  - the trailer log (CSV: trailer, scheduled, arrived - ISO 8601 with a zone): lateness in whole minutes
    (floor(x + 0.5)), the nearest-rank quantiles min / p10 / median / p90 / max - the SAME rule as
    tools/scms_delivery.py - and the shares late / early / on time. They land in delivery.site.* (ticks:
    the simulation's tick is one minute at 60 ticks per hour, so a measured minute is a tick; the day
    scale of the dataset shape does not apply). With delivery.site.n > 0 the app's delivery what-if uses
    the site quantiles instead of the SCMS mode;
  - deterministic: no dates, no hashes of the wall clock; the same inputs write the same bytes.

Honesty: the values are what the record says for the period it covers - not a validated error model,
not a forecast; a plant that records nothing at a step measures nothing there. Aggregates only, per
step and per trailer; nothing is keyed to a person (BetrVG 87(1)6, GDPR Art. 88). Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import epcis_import as EI  # noqa: E402
import run_ledger as RL  # noqa: E402
from scms_delivery import nearest_rank  # noqa: E402

SCHEMA_ID = "wt-site-profile/v1"
TOOL = "tools/fit_rates.py (v3.59)"
HONESTY = ("A site profile fitted from the plant's own records: aggregates per business step and per trailer, never per person "
           "(BetrVG 87(1)6, GDPR Art. 88). The values are what the record says for the period it covers - not a validated error model, "
           "not a forecast; a step that recorded nothing measures nothing and keeps its teaching value. The performance-shaping "
           "multipliers are not fitted (a measured share already contains the plant's conditions). Loaded into the knowledge base, each "
           "value is labelled 'measured on <source>, n = ...' instead of 'teaching value'.")
# the error kinds at their steps: knowledge-base id -> (the disposition that is the error, the business steps, the label of the event)
ERROR_FITS = {
    "hf.error.mis-pick": ("mismatch_class", ("picking",), "picking events"),
    "hf.error.wrong-putaway": ("sellable_not_accessible", ("storing",), "storing events"),
    "hf.error.damage": ("damaged", ("unpacking", "packing"), "unpacking + packing events"),
}
SITE_IDS = ("delivery.site.n", "delivery.site.latenessMin", "delivery.site.latenessP10", "delivery.site.latenessMedian", "delivery.site.latenessP90", "delivery.site.latenessMax")
QUANTILES = (("latenessMin", 0.0), ("latenessP10", 0.1), ("latenessMedian", 0.5), ("latenessP90", 0.9), ("latenessMax", 1.0))


def _r6(x: float) -> float:
    return round(x, 6)


# the dispositions that are an error in the app's own vocabulary (routing.js ERROR_KINDS; a stated subset of CBV 2.0)
ERROR_DISPOSITIONS = ("mismatch_class", "sellable_not_accessible", "damaged")


def steps_of(events: list[dict]) -> list[dict]:
    """Per business step: events, objects, the non-in_progress events and share (descriptive - at storing every event is
    sellable_*), the error-disposition events and share, the dispositions counted. Sorted by step."""
    agg: dict[str, dict] = {}
    for ev in events:
        a = agg.setdefault(ev["bizStep"], {"biz_step": ev["bizStep"], "events": 0, "objects": set(), "non_in_progress": 0, "errors": 0, "dispositions": {}})
        a["events"] += 1
        a["objects"].add(ev["wt:hu_id"])
        if ev["disposition"] != "in_progress":
            a["non_in_progress"] += 1
        if ev["disposition"] in ERROR_DISPOSITIONS:
            a["errors"] += 1
        a["dispositions"][ev["disposition"]] = a["dispositions"].get(ev["disposition"], 0) + 1
    out = []
    for k in sorted(agg):
        a = agg[k]
        out.append({"biz_step": k, "events": a["events"], "objects": len(a["objects"]), "non_in_progress": a["non_in_progress"],
                    "non_in_progress_share": _r6(a["non_in_progress"] / a["events"]), "errors": a["errors"], "error_share": _r6(a["errors"] / a["events"]),
                    "dispositions": {d: a["dispositions"][d] for d in sorted(a["dispositions"])}})
    return out


def fit_errors(events: list[dict], source: str) -> tuple[dict, dict]:
    """The three error shares at their steps -> (values, not_fitted)."""
    values, not_fitted = {}, {}
    for kb_id, (disp, steps, what) in ERROR_FITS.items():
        n = sum(1 for ev in events if ev["bizStep"] in steps)
        k = sum(1 for ev in events if ev["bizStep"] in steps and ev["disposition"] == disp)
        if n == 0:
            not_fitted[kb_id] = f"no {what} in the record - the teaching value stays"
            continue
        values[kb_id] = {"value": _r6(k / n), "n": n, "numerator": k, "disposition": disp, "steps": list(steps),
                         "label": f"measured on {source}, n = {n} {what} ({k} {disp}); {TOOL}"}
    return values, not_fitted


def read_deliveries(text: str) -> tuple[list[dict], list[str]]:
    """The trailer log CSV -> rows {trailer, scheduled, arrived, late_minutes}; the problems named."""
    rows, problems = [], []
    reader = csv.DictReader(io.StringIO(text, newline=""))
    need = {"trailer", "scheduled", "arrived"}
    if not reader.fieldnames or not need <= {f.strip() for f in reader.fieldnames}:
        return [], [f"the trailer log needs the columns trailer, scheduled, arrived (found {reader.fieldnames})"]
    for i, r in enumerate(reader, start=2):
        s, a = EI.parse_iso_ms(r.get("scheduled")), EI.parse_iso_ms(r.get("arrived"))
        if s is None or a is None:
            problems.append(f"line {i}: scheduled / arrived must be ISO 8601 with a zone")
            continue
        rows.append({"trailer": str(r.get("trailer") or "").strip(), "scheduled": r["scheduled"], "arrived": r["arrived"], "late_minutes": int(((a - s) / 60000 + 0.5) // 1)})
    return rows, problems


def fit_deliveries(rows: list[dict], source: str) -> dict:
    """Nearest-rank quantiles of the lateness (the SCMS rule) and the shares -> the delivery.site.* values."""
    late = sorted(r["late_minutes"] for r in rows)
    n = len(late)
    q = {name: nearest_rank(late, p) for name, p in QUANTILES}
    values = {"delivery.site.n": {"value": n, "n": n, "label": f"measured on {source}, n = {n} trailers; {TOOL}"}}
    for name, _p in QUANTILES:
        values["delivery.site." + name] = {"value": q[name], "n": n, "label": f"measured on {source}, n = {n} trailers (lateness in minutes, nearest rank); {TOOL}"}
    return {"values": values, "summary": {"n": n, "lateness_minutes": q, "share_late": _r6(sum(1 for v in late if v > 0) / n), "share_early": _r6(sum(1 for v in late if v < 0) / n),
                                         "share_on_time": _r6(sum(1 for v in late if v == 0) / n)}}


def fit(events: list[dict], source: str, site: str | None = None, fitted_from: dict | None = None, deliveries: list[dict] | None = None, deliveries_source: str | None = None) -> dict:
    """The site profile from a recorded event set (mapped events) and an optional trailer log."""
    values, not_fitted = fit_errors(events, source)
    if not events:
        for kb_id in ERROR_FITS:
            not_fitted[kb_id] = "no recorded events - the teaching value stays"
    profile = {"schema": SCHEMA_ID, "tool": TOOL, "site": site or None, "honesty": HONESTY,
               "fitted_from": dict(fitted_from or {}, events=len(events), objects=len({ev["wt:hu_id"] for ev in events})),
               "values": values, "not_fitted": not_fitted, "steps": steps_of(events), "deliveries": None}
    if deliveries:
        d = fit_deliveries(deliveries, deliveries_source or source)
        profile["values"].update(d["values"])
        profile["deliveries"] = dict(d["summary"], source=deliveries_source or source)
    return profile


def events_from_documents(paths: list[Path]) -> tuple[list[dict], dict, str]:
    events, ids = [], []
    for p in paths:
        doc = json.loads(p.read_text(encoding="utf-8"))
        mapped, errors, _summary = EI.from_epcis(doc)
        if mapped is None:
            raise ValueError(f"{p.name}: refused: " + "; ".join(errors))
        events.extend(mapped["events"])
        ids.append(mapped["run"]["source"]["document_id"] or p.name)
    times = sorted(e["eventTime"] for e in events)
    return events, {"documents": ids, "earliest": times[0] if times else None, "latest": times[-1] if times else None}, ", ".join(ids)


def events_from_database(db: sqlite3.Connection, run_id: str | None) -> tuple[list[dict], dict, str]:
    """The imported rows (source = 'imported') of one run or of every imported run; derived twins are never read."""
    where, params = "WHERE source = 'imported'", ()
    if run_id:
        where, params = "WHERE source = 'imported' AND run_id = ?", (run_id,)
    rows = RL.rows(db, f"SELECT run_id, hu_id, biz_step, disposition, tick FROM tracking_event {where} ORDER BY run_id, tick, version", params)
    if not rows:
        derived = RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event WHERE source = 'derived'")[0]["n"]
        raise ValueError(f"no imported events in the database{' for ' + run_id if run_id else ''} ({derived} derived twins present - a fit on the simulation's own twins is refused)")
    events = [{"bizStep": r["biz_step"], "disposition": r["disposition"], "wt:hu_id": r["hu_id"], "eventTime": None} for r in rows]
    runs = sorted({r["run_id"] for r in rows})
    return events, {"documents": runs, "earliest": None, "latest": None}, ", ".join(runs)


def check(profile: dict) -> list[str]:
    problems = []
    if profile.get("schema") != SCHEMA_ID:
        problems.append(f"schema is {profile.get('schema')!r}, expected {SCHEMA_ID}")
    if not isinstance(profile.get("values"), dict):
        problems.append("values missing")
        return problems
    for kb_id, v in profile["values"].items():
        if not isinstance(v, dict) or not isinstance(v.get("value"), (int, float)) or not isinstance(v.get("n"), int) or v["n"] < 1:
            problems.append(f"{kb_id}: needs a numeric value and n >= 1")
        elif not str(v.get("label", "")).startswith("measured on "):
            problems.append(f"{kb_id}: the label must start with 'measured on '")
        elif not (kb_id.startswith("hf.error.") or kb_id.startswith("delivery.site.")):
            problems.append(f"{kb_id}: not a human-factors or delivery.site entry")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("fit", "check"))
    ap.add_argument("arg", nargs="?", help="check: the site profile JSON")
    ap.add_argument("--document", action="append", help="fit: an EPCIS 2.0 document (repeatable)")
    ap.add_argument("--database", help="fit: a run-ledger database with imported events")
    ap.add_argument("--run", help="fit: one imported run id (default: every imported run)")
    ap.add_argument("--deliveries", help="fit: a trailer log CSV (trailer, scheduled, arrived)")
    ap.add_argument("--site", help="fit: the site's name for the profile")
    ap.add_argument("--out", help="fit: write the site profile here (default: stdout)")
    a = ap.parse_args(argv)
    if a.command == "check":
        if not a.arg:
            ap.error("check needs the profile path")
        problems = check(json.loads(Path(a.arg).read_text(encoding="utf-8")))
        if problems:
            print("problems: " + "; ".join(problems))
            return 1
        prof = json.loads(Path(a.arg).read_text(encoding="utf-8"))
        for kb_id, v in prof["values"].items():
            print(f"{kb_id} = {v['value']}  ({v['label']})")
        for kb_id, why in (prof.get("not_fitted") or {}).items():
            print(f"{kb_id}: not fitted - {why}")
        return 0
    if not a.document and not a.database:
        ap.error("fit needs --document ... or --database")
    try:
        if a.document:
            events, fitted_from, source = events_from_documents([Path(p) for p in a.document])
        else:
            db = RL.connect(a.database)
            RL.initialize(db)
            events, fitted_from, source = events_from_database(db, a.run)
        deliveries, dsource = None, None
        if a.deliveries:
            deliveries, problems = read_deliveries(Path(a.deliveries).read_text(encoding="utf-8"))
            if problems:
                raise ValueError("trailer log: " + "; ".join(problems))
            dsource = Path(a.deliveries).name
            fitted_from["deliveries"] = dsource
    except ValueError as e:
        print("refused: " + str(e))
        return 2
    profile = fit(events, source, a.site, fitted_from, deliveries, dsource)
    text = json.dumps(profile, indent=1, ensure_ascii=False) + "\n"
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8", newline="\n")
        print(f"site profile: {len(profile['values'])} values fitted, {len(profile['not_fitted'])} not fitted, {profile['fitted_from']['events']} events -> {a.out}")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

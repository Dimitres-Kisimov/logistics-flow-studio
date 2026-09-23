"""tools/epcis_import.py - the return path (v3.58): a recorded EPCIS 2.0 capture document into the run-ledger database.

The Python twin of tracking.js fromEpcis(): the same document (JSON / JSON-LD, `type: "EPCISDocument"`,
`epcisBody.eventList`) mapped onto the same shape the derived twins use (factory-tracking-events/v1),
so recorded events can be asked the questions the twins answer - dwell per business step
(v_bizstep_dwell), a unit's history (v_unit_history) - in the same database, with `source = 'imported'`
on every row (a derived twin carries 'derived'). test/test_epcis_import.py pins this mapping equal to
the committed JavaScript twin event by event.

    python tools/epcis_import.py check  <document.json>                         validate and summarise, no database
    python tools/epcis_import.py twin   <document.json> --out <mapped.json>      write the mapped document
    python tools/epcis_import.py import <document.json> --database <run.sqlite>  one run row + tracking_event rows
    python tools/epcis_import.py dwell  --database <run.sqlite> [--run EPCIS-...] dwell per business step (minutes)

THE RULE (stated once, identical in tracking.js):
  - only ObjectEvent and AggregationEvent; only the business steps and dispositions this app knows
    (tools/run_ledger.py BIZ_STEPS / DISPOSITIONS); the refusal names the identifier and says whether it
    is CBV 2.0 at all (the 41 steps, 33 dispositions and 13 transaction types of the ratified JSON-LD
    context, ref.gs1.org/standards/epcis/epcis-context.jsonld, read 2026-09-23);
  - the three CBV forms are read: bare (`receiving`), URN (`urn:epcglobal:cbv:bizstep:receiving`),
    web URI (`https://ref.gs1.org/cbv/BizStep-receiving`);
  - every event needs an ISO 8601 eventTime with a zone and an object (epcList, quantityList or parentID);
  - an ObjectEvent naming several objects becomes one mapped event per object (eventID suffixed #2, #3,
    ...), so a unit's history is complete; the summary reports both counts;
  - events are ordered by time (ties by document order); wt:tick = whole minutes from the earliest event
    (floor(x + 0.5), the same in both languages); wt:minute exact; wt:version counts per object;
  - the run id is EPCIS-<fnv1a of the mapped events' signature>; re-importing replaces the run.

Honesty: a file is the physical-to-digital direction by hand - a shadow only in the manual sense of
Kritzinger's ladder. Nothing is streamed, nothing is sent back, nothing here acts. The identifiers,
times and places are the document's own. An event names an object, a place and a step - never a
person (BetrVG 87(1)6, GDPR Art. 88). Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_ledger as RL  # noqa: E402

EPCIS_TYPES = ("EPCISDocument",)
EVENT_TYPES = ("ObjectEvent", "AggregationEvent")
ACTIONS = ("ADD", "OBSERVE", "DELETE")
BIZ_STEPS = RL.BIZ_STEPS
DISPOSITIONS = RL.DISPOSITIONS
CBV_BIZ_STEPS = ("accepting", "arriving", "assembling", "collecting", "commissioning", "consigning", "creating_class_instance", "cycle_counting",
                 "decommissioning", "departing", "destroying", "disassembling", "dispensing", "encoding", "entering_exiting", "holding", "inspecting",
                 "installing", "killing", "loading", "other", "packing", "picking", "receiving", "removing", "repackaging", "repairing", "replacing",
                 "reserving", "retail_selling", "sampling", "sensor_reporting", "shipping", "staging_outbound", "stock_taking", "stocking", "storing",
                 "transporting", "unloading", "unpacking", "void_shipping")
CBV_DISPOSITIONS = ("active", "available", "completeness_inferred", "completeness_verified", "conformant", "container_closed", "container_open",
                    "damaged", "destroyed", "dispensed", "disposed", "encoded", "expired", "in_progress", "in_transit", "inactive", "mismatch_class",
                    "mismatch_instance", "mismatch_quantity", "needs_replacement", "no_pedigree_match", "non_conformant", "non_sellable_other",
                    "partially_dispensed", "recalled", "reserved", "retail_sold", "returned", "sellable_accessible", "sellable_not_accessible",
                    "stolen", "unavailable", "unknown")
CBV_BTT = ("bol", "cert", "desadv", "inv", "pedigree", "po", "poc", "prodorder", "recadv", "rma", "testprd", "testres", "upevt")
IMPORT_SOURCE = "imported"
IMPORT_HONESTY = (
    "Recorded events imported from an EPCIS 2.0 document - the physical-to-digital direction, by hand (a file), so a "
    "shadow only in the manual sense of Kritzinger's ladder: nothing is streamed, nothing is sent back, the app reads "
    "the events, aggregates them per business step and never acts on them. The identifiers, times and places are the "
    "document's own (nothing here says they are registered or true); wt:tick counts whole minutes from the document's "
    "earliest event and the wall clock stays in eventTime. An event names an object, a place and a step - never a "
    "person (BetrVG 87(1)6, GDPR Art. 88)."
)
_URN = {"bizStep": "urn:epcglobal:cbv:bizstep:", "disposition": "urn:epcglobal:cbv:disp:", "btt": "urn:epcglobal:cbv:btt:"}
_WEB = {"bizStep": "https://ref.gs1.org/cbv/BizStep-", "disposition": "https://ref.gs1.org/cbv/Disp-", "btt": "https://ref.gs1.org/cbv/BTT-"}
_LIST = {"bizStep": CBV_BIZ_STEPS, "disposition": CBV_DISPOSITIONS, "btt": CBV_BTT}
EPCIS_FIELDS = ("eventID", "type", "@type", "isA", "action", "eventTime", "eventTimeZoneOffset", "bizStep", "disposition", "epcList",
                "quantityList", "parentID", "childEPCs", "childQuantityList", "readPoint", "bizLocation", "bizTransactionList")
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$")
_BARE = re.compile(r"^[a-z][a-z0-9_]*$")


def cbv_id(value, kind: str):
    """A CBV identifier in any of its three forms -> {id, form, cbv}; None when absent."""
    if not isinstance(value, str) or not value:
        return None
    if value.startswith(_URN[kind]):
        ident, form = value[len(_URN[kind]):], "urn"
    elif value.startswith(_WEB[kind]):
        ident, form = value[len(_WEB[kind]):], "web"
    elif _BARE.match(value):
        ident, form = value, "bare"
    else:
        return {"id": value, "form": "other", "cbv": False}
    return {"id": ident, "form": form, "cbv": ident in _LIST[kind]}


def days_from_civil(y: int, m: int, d: int) -> int:
    """Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's days_from_civil)."""
    y -= 1 if m <= 2 else 0
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def parse_iso_ms(s):
    """An ISO 8601 date-time with a zone -> milliseconds since the epoch; None when it is not one."""
    m = _ISO.match("" if s is None else str(s))
    if not m:
        return None
    mo, d, hh, mi, ss = int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6))
    if mo < 1 or mo > 12 or d < 1 or d > 31 or hh > 23 or mi > 59 or ss > 60:
        return None
    frac = int((m.group(7) + "00")[:3]) if m.group(7) else 0
    ms = (days_from_civil(int(m.group(1)), mo, d) * 86400 + hh * 3600 + mi * 60 + ss) * 1000 + frac
    if m.group(8) != "Z":
        sign = -1 if m.group(8)[0] == "-" else 1
        ms -= sign * (int(m.group(8)[1:3]) * 3600 + int(m.group(8)[4:6]) * 60) * 1000
    return ms


def unit_keys(ev: dict, etype: str) -> list[str]:
    if etype == "AggregationEvent":
        return [ev["parentID"]] if isinstance(ev.get("parentID"), str) and ev["parentID"] else []
    epcs = [x for x in (ev.get("epcList") if isinstance(ev.get("epcList"), list) else []) if isinstance(x, str) and x]
    if epcs:
        return epcs
    q = [x for x in (ev.get("quantityList") if isinstance(ev.get("quantityList"), list) else []) if isinstance(x, dict) and isinstance(x.get("epcClass"), str) and x["epcClass"]]
    return [q[0]["epcClass"]] if q else []


def _num(x):
    return int(x) if isinstance(x, float) and x.is_integer() else x


def _quantities(lst) -> list[dict]:
    out = []
    for x in lst if isinstance(lst, list) else []:
        if isinstance(x, dict) and isinstance(x.get("epcClass"), str) and isinstance(x.get("quantity"), (int, float)) and not isinstance(x.get("quantity"), bool):
            out.append({"epcClass": x["epcClass"], "quantity": _num(x["quantity"]), "uom": x["uom"] if isinstance(x.get("uom"), str) and x["uom"] else "EA"})
    return out


def _etype(o: dict):
    return o.get("type") or o.get("@type") or o.get("isA")


def from_epcis(doc, budget_minutes=None) -> tuple:
    """(mapped document, errors, summary): the document on the twins' shape, or the reasons it was refused."""
    errors: list[str] = []

    def err(m):
        if len(errors) < 8:
            errors.append(m)

    if not isinstance(doc, dict):
        err("not an object")
        return None, errors, None
    dtype = _etype(doc)
    if dtype not in EPCIS_TYPES:
        err(f"not an EPCIS 2.0 capture document (type {json.dumps(dtype)}, expected EPCISDocument)")
        return None, errors, None
    if doc.get("schemaVersion") is not None and not re.match(r"^2(\.\d+)*$", str(doc["schemaVersion"])):
        err(f"schemaVersion {json.dumps(str(doc['schemaVersion']))}: only EPCIS 2.0 JSON is read")
        return None, errors, None
    body = doc.get("epcisBody")
    lst = body.get("eventList") if isinstance(body, dict) and isinstance(body.get("eventList"), list) else None
    if lst is None:
        err("epcisBody.eventList missing")
        return None, errors, None
    if not lst:
        err("epcisBody.eventList is empty")
        return None, errors, None
    ignored: dict[str, int] = {}
    ids: set[str] = set()
    mapped: list[tuple] = []
    for i, ev in enumerate(lst):
        where = f"event {i + 1}"
        if not isinstance(ev, dict):
            err(f"{where}: not an object")
            continue
        etype = _etype(ev)
        if etype not in EVENT_TYPES:
            err(f"{where}: {'no event type' if etype is None else str(etype) + ' is not mapped'} (only ObjectEvent and AggregationEvent are)")
            continue
        if ev.get("action") not in ACTIONS:
            err(f"{where}: action {json.dumps(ev.get('action'))} (ADD, OBSERVE or DELETE)")
            continue
        ms = parse_iso_ms(ev.get("eventTime"))
        if ms is None:
            err(f"{where}: eventTime {json.dumps(ev.get('eventTime'))} is not an ISO 8601 date-time with a zone")
            continue
        step, disp = cbv_id(ev.get("bizStep"), "bizStep"), cbv_id(ev.get("disposition"), "disposition")
        if not step:
            err(f"{where}: no bizStep (known: {', '.join(BIZ_STEPS)})")
            continue
        if step["id"] not in BIZ_STEPS:
            err(f"{where}: business step {json.dumps(step['id'])}{' is CBV 2.0 but not one this app maps' if step['cbv'] else ' is not a CBV 2.0 business step'} (known: {', '.join(BIZ_STEPS)})")
            continue
        if not disp:
            err(f"{where}: no disposition (known: {', '.join(DISPOSITIONS)})")
            continue
        if disp["id"] not in DISPOSITIONS:
            err(f"{where}: disposition {json.dumps(disp['id'])}{' is CBV 2.0 but not one this app maps' if disp['cbv'] else ' is not a CBV 2.0 disposition'} (known: {', '.join(DISPOSITIONS)})")
            continue
        keys = unit_keys(ev, etype)
        if not keys:
            err(f"{where}: names no object (no {'parentID' if etype == 'AggregationEvent' else 'epcList or quantityList'})")
            continue
        for k in ev:
            if k not in EPCIS_FIELDS:
                ignored[k] = ignored.get(k, 0) + 1
        base = ev["eventID"] if isinstance(ev.get("eventID"), str) and ev["eventID"] else f"urn:wt:evt:import-{i + 1}"
        epcs = [x for x in (ev.get("epcList") if isinstance(ev.get("epcList"), list) else []) if isinstance(x, str) and x]
        for n, key in enumerate(keys):
            ident = base if n == 0 else f"{base}#{n + 1}"
            if ident in ids:
                err(f"{where}: duplicate eventID {ident}")
                continue
            ids.add(ident)
            out: dict = {"eventID": ident, "type": etype, "action": ev["action"], "eventTime": str(ev["eventTime"]),
                         "eventTimeZoneOffset": ev["eventTimeZoneOffset"] if isinstance(ev.get("eventTimeZoneOffset"), str) else None,
                         "wt:tick": 0, "wt:minute": 0, "wt:kind": "recorded", "wt:op": None, "wt:hu_id": key, "wt:version": 0,
                         "wt:source": IMPORT_SOURCE, "wt:document_event": i + 1}
            if etype == "AggregationEvent":
                out["parentID"] = key
                out["childEPCs"] = [x for x in (ev.get("childEPCs") if isinstance(ev.get("childEPCs"), list) else []) if isinstance(x, str) and x]
                out["childQuantityList"] = _quantities(ev.get("childQuantityList"))
            else:
                out["epcList"] = [key] if epcs else []
                out["quantityList"] = _quantities(ev.get("quantityList"))
            out["bizStep"] = step["id"]
            out["disposition"] = disp["id"]
            out["wt:vocabulary"] = {"bizStep": step["form"], "disposition": disp["form"]}
            rp = ev.get("readPoint")
            out["readPoint"] = {"id": rp["id"] if isinstance(rp, dict) and isinstance(rp.get("id"), str) else None}
            bl = ev.get("bizLocation")
            out["bizLocation"] = {"id": bl["id"]} if isinstance(bl, dict) and isinstance(bl.get("id"), str) else None
            bts = []
            for b in ev.get("bizTransactionList") if isinstance(ev.get("bizTransactionList"), list) else []:
                if isinstance(b, dict) and isinstance(b.get("bizTransaction"), str):
                    t = cbv_id(b.get("type"), "btt")
                    bts.append({"type": t["id"] if t else None, "bizTransaction": b["bizTransaction"]})
            out["bizTransactionList"] = bts
            out["wt:error"] = None
            out["wt:delivery"] = None
            mapped.append((ms, i, n, out))
    if errors:
        return None, errors, None
    mapped.sort(key=lambda t: (t[0], t[1], t[2]))
    t0 = mapped[0][0]
    versions: dict[str, int] = {}
    max_tick = 0
    for ms, _i, _n, out in mapped:
        minutes = (ms - t0) / 60000
        out["wt:minute"] = _num(minutes)
        out["wt:tick"] = int((minutes + 0.5) // 1)
        key = out["wt:hu_id"]
        out["wt:version"] = versions.get(key, 0)
        versions[key] = out["wt:version"] + 1
        max_tick = max(max_tick, out["wt:tick"])
    events = [t[3] for t in mapped]
    sig = "\n".join("|".join(str(v) for v in (e["eventID"], e["wt:hu_id"], e["wt:tick"], e["bizStep"], e["disposition"], e["type"], e["action"])) for e in events)
    digest = f"{RL.fnv1a(sig):08x}"
    source = {"kind": "epcis-2.0-document", "document_id": doc["id"] if isinstance(doc.get("id"), str) else None,
              "schemaVersion": None if doc.get("schemaVersion") is None else str(doc["schemaVersion"]),
              "creationDate": doc["creationDate"] if isinstance(doc.get("creationDate"), str) else None,
              "document_events": len(lst), "mapped_events": len(events), "units": len(versions),
              "earliest": events[0]["eventTime"], "latest": events[-1]["eventTime"], "ignored_fields": sorted(ignored)}
    run = {"id": f"EPCIS-{digest}", "scenario": "epcis-import", "seed": 0, "hash": digest, "ticks": max_tick, "minutes_per_tick": 1, "source": source,
           "sync": sync_contract(budget_minutes, "manual file import (an EPCIS 2.0 capture document)")}  # v3.64
    out_doc = {"schema": RL.TRACKING_SCHEMA_ID, "honesty": IMPORT_HONESTY,
               "vocabulary": {"bizSteps": list(BIZ_STEPS), "dispositions": list(DISPOSITIONS)}, "run": run, "events": events}
    summary = {"run_id": run["id"], "ticks": max_tick, **source}
    return out_doc, errors, summary


# ---- v3.64 the synchronisation contract (ISO 23247-1; the deep dive's gap 9) ------------------
# The twin of tracking.js syncContract / freshness. ISO 23247-1 defines a digital twin as a
# representation WITH SYNCHRONISATION between the element and the representation; until a record
# could be imported there was nothing to be stale against. An imported record carries the contract -
# direction, mode, staleness budget, who wins on conflict - and freshness() measures it against an
# instant the caller names (no clock of its own, so the answer is reproducible).
SYNC_DEFAULTS = {"budget_minutes": 1440, "direction": "physical-to-digital", "mode": "manual file import",
                 "conflict": "the record wins; this app never writes to the plant", "refreshed_by": "a person importing a document"}
SYNC_HONESTY = (
    "A synchronisation contract in the sense of ISO 23247-1, DECLARED - not negotiated with any plant and not a "
    "conformance claim: the data flows one way, a person carries it (a file, not a stream), the record may be as old "
    "as the budget says before it is called stale, and on a conflict the record wins because this app never writes to "
    "a plant. A stale record is not an error: it is the app saying it does not know what has happened since. The "
    "budget is a declared teaching default until a plant sets its own."
)


def sync_contract(budget_minutes=None, mode: str | None = None, refreshed_by: str | None = None) -> dict:
    b = None
    try:
        b = float(budget_minutes) if budget_minutes is not None else None
    except (TypeError, ValueError):
        b = None
    return {"kind": "wt-sync-contract/v1", "direction": SYNC_DEFAULTS["direction"],
            "mode": str(mode) if mode else SYNC_DEFAULTS["mode"],
            "budget_minutes": int(b + 0.5) if b is not None and b > 0 else SYNC_DEFAULTS["budget_minutes"],
            "conflict": SYNC_DEFAULTS["conflict"],
            "refreshed_by": str(refreshed_by) if refreshed_by else SYNC_DEFAULTS["refreshed_by"],
            "honesty": SYNC_HONESTY}


def _r2(v: float):
    """Math.round(v * 100) / 100 - the JavaScript rule (half up, towards +inf), so both sides agree."""
    import math
    return _num(math.floor(v * 100 + 0.5) / 100)


def _as_ms(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    return parse_iso_ms(v) if isinstance(v, str) else None


def freshness(doc: dict, as_of=None, budget_minutes=None) -> dict:
    """The twin of tracking.js freshness(): how fresh a record is against its contract, as of an instant."""
    events = (doc or {}).get("events") or []
    contract = ((doc or {}).get("run") or {}).get("sync")
    budget = None
    try:
        budget = int(float(budget_minutes) + 0.5) if budget_minutes is not None and float(budget_minutes) > 0 else None
    except (TypeError, ValueError):
        budget = None
    if budget is None:
        budget = contract["budget_minutes"] if contract and contract.get("budget_minutes", 0) > 0 else SYNC_DEFAULTS["budget_minutes"]
    stamped = []
    for e in events:
        ms = parse_iso_ms(e.get("eventTime")) if isinstance(e.get("eventTime"), str) else None
        if ms is not None:
            stamped.append((ms, e["eventTime"], e.get("bizStep")))
    out = {"recorded": bool(stamped), "events": len(events), "recorded_events": len(stamped), "contract": contract,
           "budget_minutes": budget, "newest": None, "oldest": None, "span_minutes": None, "as_of": None,
           "age_minutes": None, "stale": None, "per_step": []}
    if not stamped:
        out["reason"] = "no event carries a wall clock: a derived twin of a simulation has nothing to be stale against"
        return out
    lo, hi = min(stamped, key=lambda s: s[0]), max(stamped, key=lambda s: s[0])
    by_step: dict = {}
    for ms, at, step in stamped:
        b = by_step.setdefault(step, {"events": 0, "ms": ms, "at": at})
        b["events"] += 1
        if ms > b["ms"]:
            b["ms"], b["at"] = ms, at
    out["newest"], out["oldest"], out["span_minutes"] = hi[1], lo[1], _r2((hi[0] - lo[0]) / 60000)
    now_ms = _as_ms(as_of)
    if now_ms is not None:
        out["as_of"] = as_of if isinstance(as_of, str) else now_ms
        out["age_minutes"] = _r2((now_ms - hi[0]) / 60000)
        out["stale"] = out["age_minutes"] > budget
    for k in sorted(by_step):
        b = by_step[k]
        age = None if now_ms is None else _r2((now_ms - b["ms"]) / 60000)
        out["per_step"].append({"biz_step": k, "events": b["events"], "newest": b["at"], "age_minutes": age,
                                "stale": None if age is None else age > budget})
    return out


def measure(stored: dict, as_of=None, budget_minutes=None) -> dict:
    """Re-measure a stored freshness block (the run row's `sync`) against another instant - the record's own
    times are in it, so no document is needed."""
    out = dict(stored)
    if budget_minutes is not None and float(budget_minutes) > 0:
        out["budget_minutes"] = int(float(budget_minutes) + 0.5)
    now_ms = _as_ms(as_of if as_of else out.get("newest"))
    newest_ms = _as_ms(out.get("newest"))
    if now_ms is None or newest_ms is None:
        return out
    out["as_of"] = as_of if isinstance(as_of, str) else out.get("newest")
    out["age_minutes"] = _r2((now_ms - newest_ms) / 60000)
    out["stale"] = out["age_minutes"] > out["budget_minutes"]
    out["per_step"] = [dict(s, age_minutes=_r2((now_ms - _as_ms(s["newest"])) / 60000),
                            stale=_r2((now_ms - _as_ms(s["newest"])) / 60000) > out["budget_minutes"]) for s in out.get("per_step") or []]
    return out


def render_freshness(f: dict) -> str:
    """The freshness of a record as a short report (the same numbers the app shows)."""
    if not f.get("recorded"):
        return "not a recorded document: " + str(f.get("reason", "no wall clock"))
    head = (f"records {f['recorded_events']} events from {f['oldest']} to {f['newest']} ({f['span_minutes']} minutes)\n"
            f"as of {f['as_of']}: {f['age_minutes']} minutes old, budget {f['budget_minutes']} -> "
            + ("STALE: the record does not say what has happened since" if f.get("stale") else "fresh"))
    rows = [{"biz_step": s["biz_step"], "events": s["events"], "newest": s["newest"], "age_minutes": s["age_minutes"], "stale": s["stale"]} for s in f.get("per_step") or []]
    contract = f.get("contract") or {}
    tail = ("contract: " + str(contract.get("direction")) + ", " + str(contract.get("mode")) + "; on a conflict " + str(contract.get("conflict"))) if contract else "no contract recorded"
    return head + "\n" + RL.render(rows) + "\n" + tail


def import_document(db: sqlite3.Connection, doc, source_name: str | None = None, budget_minutes=None) -> str:
    """One run row (scenario epcis-import) and one tracking_event row per mapped event, source 'imported'. Re-import replaces."""
    mapped, errors, _summary = from_epcis(doc, budget_minutes)
    if mapped is None:
        raise ValueError("refused: " + "; ".join(errors))
    run = mapped["run"]
    with db:
        db.execute("DELETE FROM run WHERE id = ?", (run["id"],))
        db.execute("INSERT INTO run(id, scenario, seed, hash, mix, profile, ticks_per_hour, minutes_per_tick, ticks, honesty, dataset_source, sync) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                   (run["id"], run["scenario"], 0, run["hash"], None, None, 60, 1.0, int(run["ticks"]), IMPORT_HONESTY,
                    "EPCIS 2.0 document" + (f" {source_name}" if source_name else "") + (f" ({run['source']['document_id']})" if run["source"]["document_id"] else ""),
                    json.dumps(freshness(mapped), sort_keys=True)))  # v3.64: the contract and the record's own span, so a later question can measure the age
        db.executemany(RL.TRACKING_INSERT, [imported_row(run["id"], ev) for ev in mapped["events"]])
    return run["id"]


def imported_row(run_id: str, ev: dict) -> tuple:
    """One tracking_event row (the columns in table order) for a mapped recorded event."""
    agg = ev["type"] == "AggregationEvent"
    qs = ev["childQuantityList"] if agg else ev["quantityList"]
    q = qs[0] if qs else None
    bt = ev["bizTransactionList"][0] if ev["bizTransactionList"] else None
    return (ev["eventID"], run_id, None, ev["wt:hu_id"], int(ev["wt:version"]), int(ev["wt:tick"]), float(ev["wt:minute"]),
            ev["type"], ev["action"], ev["bizStep"], ev["disposition"], ev["readPoint"]["id"], None,
            ev["bizLocation"]["id"] if ev.get("bizLocation") else None, bt["type"] if bt else None, bt["bizTransaction"] if bt else None,
            None if agg else (ev["epcList"][0] if ev["epcList"] else None), ev.get("parentID") if agg else None,
            q["epcClass"] if q else None, q["quantity"] if q else None, q["uom"] if q else "EA",
            ev["wt:kind"], None, None, None, None, None, IMPORT_SOURCE)


def dwell(db: sqlite3.Connection, run_id: str | None = None) -> list[dict]:
    if run_id is None:
        r = db.execute("SELECT id FROM run WHERE scenario = 'epcis-import' ORDER BY rowid DESC LIMIT 1").fetchone()
        if r is None:
            return []
        run_id = r[0]
    return RL.rows(db, "SELECT * FROM v_bizstep_dwell WHERE run_id = ? ORDER BY biz_step", (run_id,))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("check", "twin", "import", "dwell", "sync"))
    ap.add_argument("arg", nargs="?", help="the EPCIS 2.0 document (check, twin, import)")
    ap.add_argument("--database", help="the SQLite file (import, dwell)")
    ap.add_argument("--out", help="twin: write the mapped document here (default: stdout)")
    ap.add_argument("--run", help="dwell / sync: the run id (default: the last imported document)")
    ap.add_argument("--as-of", dest="as_of", help="sync: the instant to measure the age from (ISO 8601 with a zone; default: the record's own newest event, so the age is 0)")
    ap.add_argument("--budget-minutes", dest="budget_minutes", type=float, help="import / sync: how old the record may be before it is called stale (default 1440)")
    a = ap.parse_args(argv)
    if a.command in ("check", "twin", "import") or (a.command == "sync" and a.arg):
        if not a.arg:
            ap.error(f"{a.command} needs the document path")
        doc = json.loads(Path(a.arg).read_text(encoding="utf-8"))
        mapped, errors, summary = from_epcis(doc, a.budget_minutes)
        if mapped is None:
            print("refused: " + "; ".join(errors))
            return 1
        if a.command == "check":
            print(json.dumps(summary, indent=1))
            return 0
        if a.command == "sync":
            f = freshness(mapped, a.as_of or mapped["run"]["source"]["latest"], a.budget_minutes)
            print(render_freshness(f))
            return 0
        if a.command == "twin":
            text = json.dumps(mapped, indent=1, ensure_ascii=False) + "\n"
            if a.out:
                Path(a.out).write_text(text, encoding="utf-8", newline="\n")
            else:
                sys.stdout.write(text)
            return 0
    if not a.database:
        ap.error("--database is required")
    db = RL.connect(a.database)
    RL.initialize(db)
    if a.command == "sync":
        row = RL.rows(db, "SELECT id, sync FROM run WHERE id = ?", (a.run,)) if a.run else RL.rows(db, "SELECT id, sync FROM run WHERE scenario = 'epcis-import' ORDER BY rowid DESC LIMIT 1")
        if not row or not row[0]["sync"]:
            print("no imported record in the database" + (f" for {a.run}" if a.run else "") + " (import a document first)")
            return 1
        stored = json.loads(row[0]["sync"])
        print(f"{row[0]['id']}:")
        print(render_freshness(measure(stored, a.as_of, a.budget_minutes)))
        return 0
    if a.command == "import":
        rid = import_document(db, doc, Path(a.arg).name, a.budget_minutes)
        n = RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event WHERE run_id = ?", (rid,))[0]["n"]
        print(f"imported {rid}: {n} recorded events (source imported) from {Path(a.arg).name}")
        return 0
    print(RL.render(dwell(db, a.run)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

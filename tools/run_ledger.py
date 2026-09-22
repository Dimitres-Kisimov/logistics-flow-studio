"""The run ledger in SQL (v3.32).

Imports a `factory-run-ledger/v1` export from the browser (Simulate -> Live material
flow -> Export run ledger) into SQLite and answers the questions a planner asks with
plain SQL views: cycle time and touches per order type, waiting at each bench, WIP
over time, quantities per operation (pallets / cases / eaches / parcels), the dispatch
manifest (pallets, parcels, trailers), what a handling unit costs (v3.35: spans between
events charged at the rates the run was recorded under), and the invariants that must hold -
conservation of eaches, cross-dock never in storage, consecutive versions. Standard library only.

    python tools/run_ledger.py import run-ledger.json --database work/run.sqlite
    python tools/run_ledger.py views  --database work/run.sqlite [--run RUN-...]
    python tools/run_ledger.py summary --database work/run.sqlite [--run RUN-...] [--out summary.json]
    python tools/run_ledger.py query  --database work/run.sqlite "SELECT ..."   (read-only, bounded)

Honesty: the events are synthetic (a teaching simulation, not telemetry, not a WMS);
the quantities are the synthetic order-line quantities of the scenario's packaging
profile. The numbers are exact for that simulation and mean nothing about any real site.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

SCHEMA_ID = "factory-run-ledger/v1"
KINDS = ("created", "queued", "served", "passed", "delivered", "restocked", "scrapped", "retired")
TRAILER_SLOTS = {"eur": 33, "ind": 26, "half": 66, "drum": 22, "cage": 26}

DDL = """
CREATE TABLE IF NOT EXISTS run(
  id TEXT PRIMARY KEY NOT NULL, scenario TEXT NOT NULL, seed INTEGER NOT NULL, hash TEXT, mix TEXT,
  profile TEXT, ticks_per_hour INTEGER NOT NULL, minutes_per_tick REAL NOT NULL, ticks INTEGER NOT NULL, honesty TEXT);
CREATE TABLE IF NOT EXISTS packaging_profile(
  run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE, id TEXT NOT NULL, label TEXT, box TEXT, pallet TEXT,
  eaches_per_case INTEGER, case_kg REAL, max_stack_mm INTEGER, eaches_per_parcel INTEGER, PRIMARY KEY(run_id, id));
CREATE TABLE IF NOT EXISTS pallet_type(id TEXT PRIMARY KEY NOT NULL, trailer_slots INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS location(
  run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE, id TEXT NOT NULL, type TEXT, category TEXT,
  service_ticks REAL, PRIMARY KEY(run_id, id));
CREATE TABLE IF NOT EXISTS hu(
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL, seq INTEGER NOT NULL, archetype TEXT NOT NULL, outcome TEXT, route_id TEXT NOT NULL,
  sscc TEXT NOT NULL, gtin13 TEXT NOT NULL, gtin14 TEXT NOT NULL, pallet TEXT, box TEXT,
  eaches_per_case INTEGER, cases_per_pallet INTEGER, received_eaches INTEGER NOT NULL CHECK(received_eaches >= 0),
  spawned_tick INTEGER NOT NULL, retired_tick INTEGER, final_kind TEXT,
  final_pallets INTEGER, final_cases INTEGER, final_eaches INTEGER, final_parcels INTEGER, final_form TEXT,
  final_retained INTEGER, final_scrapped INTEGER,
  CHECK(retired_tick IS NULL OR retired_tick >= spawned_tick), UNIQUE(run_id, sscc));
CREATE TABLE IF NOT EXISTS handling_event(
  id TEXT PRIMARY KEY NOT NULL, hu_id TEXT NOT NULL REFERENCES hu(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 0), kind TEXT NOT NULL CHECK(kind IN ('created','queued','served','passed','delivered','restocked','scrapped','retired')),
  op TEXT NOT NULL, anchor TEXT, location TEXT NOT NULL, tick INTEGER NOT NULL, minute REAL NOT NULL, stage TEXT, form TEXT,
  pallets INTEGER NOT NULL, cases INTEGER NOT NULL, eaches INTEGER NOT NULL, parcels INTEGER NOT NULL,
  retained INTEGER NOT NULL, scrapped INTEGER NOT NULL, UNIQUE(hu_id, version));
CREATE INDEX IF NOT EXISTS ix_event_hu ON handling_event(hu_id, tick);
CREATE INDEX IF NOT EXISTS ix_hu_run ON hu(run_id, archetype);
-- v3.35 the rates a run was recorded under (illustrative; see the export's rates.honesty)
CREATE TABLE IF NOT EXISTS rate(
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES run(id) ON DELETE CASCADE, currency TEXT NOT NULL DEFAULT 'EUR',
  labour_per_hour REAL NOT NULL CHECK(labour_per_hour >= 0), energy_price_per_kwh REAL NOT NULL CHECK(energy_price_per_kwh >= 0),
  hours_per_year REAL NOT NULL CHECK(hours_per_year > 0), co2_per_kwh REAL,
  transport_class TEXT, transport_labour INTEGER NOT NULL DEFAULT 0 CHECK(transport_labour IN (0, 1)), source TEXT, honesty TEXT);
CREATE TABLE IF NOT EXISTS equipment_rate(
  run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE, class TEXT NOT NULL,
  capex REAL NOT NULL CHECK(capex >= 0), amort_years REAL NOT NULL CHECK(amort_years > 0), power_kw REAL NOT NULL CHECK(power_kw >= 0),
  labour INTEGER NOT NULL DEFAULT 0 CHECK(labour IN (0, 1)), PRIMARY KEY(run_id, class));
CREATE TABLE IF NOT EXISTS location_class(
  run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE, type TEXT NOT NULL, class TEXT,
  labour INTEGER NOT NULL DEFAULT 0 CHECK(labour IN (0, 1)), PRIMARY KEY(run_id, type));
"""

VIEWS = {
    # ---- what the planner asks -------------------------------------------------
    "v_cycle_time_by_type": """
CREATE VIEW IF NOT EXISTS v_cycle_time_by_type AS
SELECT h.run_id, h.archetype,
       COUNT(*) AS units,
       SUM(CASE WHEN h.retired_tick IS NOT NULL THEN 1 ELSE 0 END) AS retired,
       ROUND(AVG(CASE WHEN h.retired_tick IS NOT NULL THEN h.retired_tick - h.spawned_tick END), 2) AS avg_cycle_ticks,
       ROUND(AVG(CASE WHEN h.retired_tick IS NOT NULL THEN (h.retired_tick - h.spawned_tick) * r.minutes_per_tick END), 2) AS avg_cycle_minutes,
       MIN(CASE WHEN h.retired_tick IS NOT NULL THEN h.retired_tick - h.spawned_tick END) AS min_cycle_ticks,
       MAX(CASE WHEN h.retired_tick IS NOT NULL THEN h.retired_tick - h.spawned_tick END) AS max_cycle_ticks
FROM hu h JOIN run r ON r.id = h.run_id
GROUP BY h.run_id, h.archetype;""",
    "v_touches_by_type": """
CREATE VIEW IF NOT EXISTS v_touches_by_type AS
SELECT h.run_id, h.archetype, COUNT(DISTINCT h.id) AS units, COUNT(e.id) AS events,
       ROUND(CAST(COUNT(e.id) AS REAL) / COUNT(DISTINCT h.id), 2) AS touches,
       ROUND(CAST(SUM(CASE WHEN e.kind = 'served' THEN 1 ELSE 0 END) AS REAL) / COUNT(DISTINCT h.id), 2) AS served_per_unit
FROM hu h LEFT JOIN handling_event e ON e.hu_id = h.id
GROUP BY h.run_id, h.archetype;""",
    "v_station_wait": """
CREATE VIEW IF NOT EXISTS v_station_wait AS
SELECT q.run_id, q.location, q.op, COUNT(*) AS waits,
       ROUND(AVG(s.tick - q.tick), 2) AS avg_wait_ticks, MAX(s.tick - q.tick) AS max_wait_ticks,
       SUM(CASE WHEN s.tick IS NULL THEN 1 ELSE 0 END) AS still_waiting
FROM (SELECT h.run_id, e.hu_id, e.op, e.location, e.tick, e.version FROM handling_event e JOIN hu h ON h.id = e.hu_id WHERE e.kind = 'queued') q
LEFT JOIN handling_event s ON s.hu_id = q.hu_id AND s.kind = 'served' AND s.op = q.op AND s.version > q.version
GROUP BY q.run_id, q.location, q.op;""",
    "v_wip_by_tick": """
CREATE VIEW IF NOT EXISTS v_wip_by_tick AS
WITH RECURSIVE t(run_id, tick) AS (
  SELECT id, 0 FROM run
  UNION ALL SELECT t.run_id, t.tick + 1 FROM t JOIN run r ON r.id = t.run_id WHERE t.tick < r.ticks)
SELECT t.run_id, t.tick,
       (SELECT COUNT(*) FROM hu h WHERE h.run_id = t.run_id AND h.spawned_tick <= t.tick AND (h.retired_tick IS NULL OR h.retired_tick > t.tick)) AS in_flight,
       (SELECT COUNT(*) FROM hu h WHERE h.run_id = t.run_id AND h.retired_tick IS NOT NULL AND h.retired_tick <= t.tick) AS retired
FROM t;""",
    "v_quantities_by_op": """
CREATE VIEW IF NOT EXISTS v_quantities_by_op AS
SELECT h.run_id, e.op, e.kind, COUNT(*) AS events,
       SUM(e.pallets) AS pallets, SUM(e.cases) AS cases, SUM(e.eaches) AS eaches, SUM(e.parcels) AS parcels,
       SUM(e.retained) AS retained, SUM(e.scrapped) AS scrapped
FROM handling_event e JOIN hu h ON h.id = e.hu_id
GROUP BY h.run_id, e.op, e.kind;""",
    "v_dispatch": """
CREATE VIEW IF NOT EXISTS v_dispatch AS
SELECT h.run_id, COUNT(*) AS delivered_units,
       SUM(h.final_pallets) AS pallets, SUM(h.final_cases) AS cases, SUM(h.final_eaches) AS eaches, SUM(h.final_parcels) AS parcels,
       MAX(p.trailer_slots) AS trailer_slots,
       CAST((SUM(h.final_pallets) + MAX(p.trailer_slots) - 1) / MAX(p.trailer_slots) AS INTEGER) AS trailers
FROM hu h JOIN pallet_type p ON p.id = COALESCE(h.pallet, 'eur')
WHERE h.final_kind = 'delivered'
GROUP BY h.run_id;""",
    "v_run_summary": """
CREATE VIEW IF NOT EXISTS v_run_summary AS
SELECT r.id AS run_id, r.scenario, r.seed, r.profile, r.ticks,
       (SELECT COUNT(*) FROM hu h WHERE h.run_id = r.id) AS units,
       (SELECT COUNT(*) FROM handling_event e JOIN hu h ON h.id = e.hu_id WHERE h.run_id = r.id) AS events,
       (SELECT COUNT(*) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered,
       (SELECT COALESCE(SUM(h.final_eaches), 0) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered_eaches,
       (SELECT COALESCE(SUM(h.final_pallets), 0) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered_pallets,
       (SELECT COALESCE(SUM(h.final_parcels), 0) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered_parcels
FROM run r;""",
    # ---- v3.35 what a handling unit costs ---------------------------------------
    # A span is the time between two consecutive events of a unit: WAITING when the
    # first is `queued` (queue + service, inseparable), MOVING otherwise.
    "v_spans": """
CREATE VIEW IF NOT EXISTS v_spans AS
WITH s AS (
  SELECT e.hu_id, e.version, e.kind, e.op, e.location, e.tick,
         LEAD(e.tick)     OVER (PARTITION BY e.hu_id ORDER BY e.version) AS to_tick,
         LEAD(e.kind)     OVER (PARTITION BY e.hu_id ORDER BY e.version) AS to_kind,
         LEAD(e.op)       OVER (PARTITION BY e.hu_id ORDER BY e.version) AS to_op,
         LEAD(e.location) OVER (PARTITION BY e.hu_id ORDER BY e.version) AS to_location
  FROM handling_event e)
SELECT h.run_id, s.hu_id, s.version, s.kind AS from_kind, s.op, s.location, s.tick AS from_tick,
       s.to_kind, s.to_op, s.to_location, s.to_tick, s.to_tick - s.tick AS ticks,
       CASE WHEN s.kind = 'queued' THEN 'waiting' ELSE 'moving' END AS state
FROM s JOIN hu h ON h.id = s.hu_id
WHERE s.to_tick IS NOT NULL;""",
    # A waiting span is charged the station's service time (1 / its rate), whatever
    # it waited; a moving span is charged in full at the floor's mover class.
    "v_span_cost": """
CREATE VIEW IF NOT EXISTS v_span_cost AS
WITH c AS (
  SELECT s.run_id, s.hu_id, s.version, s.state, s.op, s.location, s.ticks,
         CASE WHEN s.state = 'waiting' THEN COALESCE(l.service_ticks, 0) ELSE s.ticks END AS charged_ticks,
         CASE WHEN s.state = 'waiting' THEN lc.class ELSE r.transport_class END AS class,
         CASE WHEN s.state = 'waiting' THEN COALESCE(lc.labour, 0) ELSE r.transport_labour END AS labour,
         (CASE WHEN s.state = 'waiting' THEN COALESCE(l.service_ticks, 0) ELSE s.ticks END) * ru.minutes_per_tick / 60.0 AS hours,
         r.labour_per_hour, r.energy_price_per_kwh, r.hours_per_year
  FROM v_spans s
  JOIN run ru ON ru.id = s.run_id
  JOIN rate r ON r.run_id = s.run_id
  LEFT JOIN location l ON l.run_id = s.run_id AND l.id = s.location
  LEFT JOIN location_class lc ON lc.run_id = s.run_id AND lc.type = l.type)
SELECT c.run_id, c.hu_id, c.version, c.state, c.op, c.location, c.ticks, c.charged_ticks, c.class, c.labour, c.hours,
       c.hours * c.labour * c.labour_per_hour                              AS labour_eur,
       c.hours * COALESCE(er.capex / er.amort_years / c.hours_per_year, 0) AS equipment_eur,
       c.hours * COALESCE(er.power_kw, 0) * c.energy_price_per_kwh         AS energy_eur
FROM c LEFT JOIN equipment_rate er ON er.run_id = c.run_id AND er.class = c.class;""",
    "v_cost_by_hu": """
CREATE VIEW IF NOT EXISTS v_cost_by_hu AS
SELECT run_id, hu_id, SUM(ticks) AS ticks,
       SUM(CASE WHEN state = 'waiting' THEN ticks ELSE 0 END) AS waiting_ticks,
       SUM(CASE WHEN state = 'moving' THEN ticks ELSE 0 END) AS moving_ticks,
       SUM(charged_ticks) AS charged_ticks,
       ROUND(SUM(labour_eur), 4) AS labour_eur, ROUND(SUM(equipment_eur), 4) AS equipment_eur, ROUND(SUM(energy_eur), 4) AS energy_eur,
       ROUND(SUM(labour_eur + equipment_eur + energy_eur), 4) AS total_eur
FROM v_span_cost GROUP BY run_id, hu_id;""",
    "v_cost_by_type": """
CREATE VIEW IF NOT EXISTS v_cost_by_type AS
WITH c AS (SELECT hu_id, SUM(labour_eur) AS l, SUM(equipment_eur) AS q, SUM(energy_eur) AS n FROM v_span_cost GROUP BY hu_id)
SELECT h.run_id, h.archetype, COUNT(*) AS units,
       SUM(CASE WHEN h.retired_tick IS NOT NULL THEN 1 ELSE 0 END) AS retired,
       COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0) AS eaches_out,
       ROUND(COALESCE(SUM(c.l), 0), 4) AS labour_eur, ROUND(COALESCE(SUM(c.q), 0), 4) AS equipment_eur, ROUND(COALESCE(SUM(c.n), 0), 4) AS energy_eur,
       ROUND(COALESCE(SUM(c.l + c.q + c.n), 0), 4) AS total_eur,
       ROUND(COALESCE(SUM(c.l + c.q + c.n), 0) / COUNT(*), 4) AS eur_per_unit,
       ROUND(COALESCE(SUM(c.l + c.q + c.n), 0) / NULLIF(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0), 4) AS eur_per_each
FROM hu h JOIN rate r ON r.run_id = h.run_id
LEFT JOIN c ON c.hu_id = h.id
GROUP BY h.run_id, h.archetype;""",
    "v_cost_by_location": """
CREATE VIEW IF NOT EXISTS v_cost_by_location AS
SELECT run_id, location, MAX(class) AS class, COUNT(*) AS spans, SUM(ticks) AS ticks, SUM(charged_ticks) AS charged_ticks,
       ROUND(SUM(labour_eur), 4) AS labour_eur, ROUND(SUM(equipment_eur), 4) AS equipment_eur, ROUND(SUM(energy_eur), 4) AS energy_eur,
       ROUND(SUM(labour_eur + equipment_eur + energy_eur), 4) AS total_eur
FROM v_span_cost WHERE state = 'waiting' GROUP BY run_id, location
UNION ALL
SELECT run_id, 'transport' AS location, MAX(class), COUNT(*), SUM(ticks), SUM(charged_ticks),
       ROUND(SUM(labour_eur), 4), ROUND(SUM(equipment_eur), 4), ROUND(SUM(energy_eur), 4), ROUND(SUM(labour_eur + equipment_eur + energy_eur), 4)
FROM v_span_cost WHERE state = 'moving' GROUP BY run_id;""",
    # ---- the invariants: every one of these must return ZERO rows --------------
    "v_conservation_violations": """
CREATE VIEW IF NOT EXISTS v_conservation_violations AS
SELECT h.run_id, e.id AS event_id, e.hu_id, e.version, e.eaches + e.retained + e.scrapped AS accounted, h.received_eaches
FROM handling_event e JOIN hu h ON h.id = e.hu_id
WHERE e.eaches + e.retained + e.scrapped <> h.received_eaches;""",
    "v_cross_dock_violations": """
CREATE VIEW IF NOT EXISTS v_cross_dock_violations AS
SELECT h.run_id, e.id AS event_id, e.hu_id, e.op, e.location, l.type
FROM handling_event e JOIN hu h ON h.id = e.hu_id
JOIN location l ON l.run_id = h.run_id AND l.id = e.location
WHERE h.archetype = 'cross-dock' AND (l.category = 'storage' OR e.op IN ('putaway', 'replen', 'pick', 'piece-pick', 'case-pick', 'pallet-pick'));""",
    "v_version_gaps": """
CREATE VIEW IF NOT EXISTS v_version_gaps AS
SELECT h.run_id, h.id AS hu_id, COUNT(e.id) AS events, MIN(e.version) AS first_version, MAX(e.version) AS last_version
FROM hu h JOIN handling_event e ON e.hu_id = h.id
GROUP BY h.run_id, h.id
HAVING MIN(e.version) <> 0 OR MAX(e.version) + 1 <> COUNT(e.id);""",
    "v_terminal_violations": """
CREATE VIEW IF NOT EXISTS v_terminal_violations AS
SELECT h.run_id, h.id AS hu_id, h.final_kind, h.retired_tick
FROM hu h
WHERE (h.retired_tick IS NOT NULL AND h.final_kind NOT IN ('delivered', 'restocked', 'scrapped'))
   OR (h.retired_tick IS NULL AND h.final_kind IS NOT NULL);""",
}
INVARIANT_VIEWS = ("v_conservation_violations", "v_cross_dock_violations", "v_version_gaps", "v_terminal_violations")
PLANNER_VIEWS = ("v_run_summary", "v_cycle_time_by_type", "v_touches_by_type", "v_station_wait", "v_quantities_by_op", "v_dispatch",
                 "v_cost_by_type", "v_cost_by_location")
COST_VIEWS = ("v_spans", "v_span_cost", "v_cost_by_hu", "v_cost_by_type", "v_cost_by_location")


def connect(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize(db: sqlite3.Connection) -> None:
    db.executescript(DDL)
    try:  # a database created before v3.35 has no service_ticks column yet
        db.execute("ALTER TABLE location ADD COLUMN service_ticks REAL")
    except sqlite3.OperationalError:
        pass
    for ddl in VIEWS.values():
        db.executescript(ddl)
    for pid, slots in TRAILER_SLOTS.items():
        db.execute("INSERT OR IGNORE INTO pallet_type VALUES(?, ?)", (pid, slots))
    db.commit()


def import_ledger(db: sqlite3.Connection, data: dict) -> str:
    """Import one export. Re-importing the same run replaces it (idempotent)."""
    if data.get("schema") != SCHEMA_ID:
        raise ValueError(f"expected schema {SCHEMA_ID}, got {data.get('schema')!r}")
    run = data["run"]
    for key in ("id", "scenario", "seed", "ticks_per_hour", "minutes_per_tick", "ticks"):
        if key not in run:
            raise ValueError(f"run is missing {key!r}")
    hus = data.get("hus") or []
    events = data.get("events") or []
    seen_hu = set()
    for h in hus:
        if h["id"] in seen_hu:
            raise ValueError(f"duplicate hu id {h['id']!r}")
        seen_hu.add(h["id"])
    for e in events:
        if e["hu_id"] not in seen_hu:
            raise ValueError(f"event {e['id']!r} references unknown hu {e['hu_id']!r}")
        if e["kind"] not in KINDS:
            raise ValueError(f"event {e['id']!r} has unknown kind {e['kind']!r}")
    with db:
        db.execute("DELETE FROM run WHERE id = ?", (run["id"],))
        db.execute("INSERT INTO run VALUES(?,?,?,?,?,?,?,?,?,?)", (
            run["id"], run["scenario"], int(run["seed"]), run.get("hash"),
            json.dumps(run.get("mix"), sort_keys=True) if run.get("mix") is not None else None,
            run.get("profile"), int(run["ticks_per_hour"]), float(run["minutes_per_tick"]), int(run["ticks"]), run.get("honesty")))
        prof = data.get("profile")
        if prof:
            db.execute("INSERT INTO packaging_profile VALUES(?,?,?,?,?,?,?,?,?)", (
                run["id"], prof["id"], prof.get("label"), prof.get("box"), prof.get("pallet"), prof.get("eaches_per_case"),
                prof.get("case_kg"), prof.get("max_stack_mm"), prof.get("eaches_per_parcel")))
        for loc in data.get("locations") or []:
            db.execute("INSERT OR REPLACE INTO location VALUES(?,?,?,?,?)", (
                run["id"], loc["id"], loc.get("type"), loc.get("category"), loc.get("service_ticks")))
        rates = data.get("rates")
        if rates:
            tr = rates.get("transport") or {}
            db.execute("INSERT INTO rate VALUES(?,?,?,?,?,?,?,?,?,?)", (
                run["id"], rates.get("currency", "EUR"), float(rates["labour_per_hour"]), float(rates["energy_price_per_kwh"]),
                float(rates["hours_per_year"]), rates.get("co2_per_kwh"), tr.get("class"), 1 if tr.get("labour") else 0,
                rates.get("source"), rates.get("honesty")))
            for cls, e in sorted((rates.get("equipment") or {}).items()):
                db.execute("INSERT INTO equipment_rate VALUES(?,?,?,?,?,?)", (
                    run["id"], cls, float(e["capex"]), float(e["amort_years"]), float(e["power_kw"]), 1 if e.get("labour") else 0))
            for typ, c in sorted((rates.get("classes") or {}).items()):
                db.execute("INSERT INTO location_class VALUES(?,?,?,?)", (run["id"], typ, c.get("class"), 1 if c.get("labour") else 0))
        for h in hus:
            f = h.get("final") or {}
            db.execute("INSERT INTO hu VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                h["id"], run["id"], h["order_id"], int(h["seq"]), h["archetype"], h.get("outcome"), h["route_id"],
                h["sscc"], h["gtin13"], h["gtin14"], h.get("pallet"), h.get("box"), h.get("eaches_per_case"), h.get("cases_per_pallet"),
                int(h["received_eaches"]), int(h["spawned_tick"]), h.get("retired_tick"), h.get("final_kind"),
                f.get("pallets"), f.get("cases"), f.get("eaches"), f.get("parcels"), f.get("form"), f.get("retained"), f.get("scrapped")))
        db.executemany("INSERT INTO handling_event VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [(
            e["id"], e["hu_id"], int(e["version"]), e["kind"], e["op"], e.get("anchor"), e["location"], int(e["tick"]), float(e["minute"]),
            e.get("stage"), e.get("form"), int(e["pallets"]), int(e["cases"]), int(e["eaches"]), int(e["parcels"]), int(e["retained"]), int(e["scrapped"]))
            for e in events])
    return run["id"]


def rows(db: sqlite3.Connection, sql: str, params=()) -> list[dict]:
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def summary(db: sqlite3.Connection, run_id: str) -> dict:
    """The planner views for one run, as plain JSON (deterministic key order)."""
    out = {"run_id": run_id}
    for name in PLANNER_VIEWS:
        out[name] = rows(db, f"SELECT * FROM {name} WHERE run_id = ? ORDER BY 2, 3", (run_id,))
    out["invariants"] = {name: len(rows(db, f"SELECT * FROM {name} WHERE run_id = ?", (run_id,))) for name in INVARIANT_VIEWS}
    return out


def query(db: sqlite3.Connection, sql: str, limit: int = 500) -> list[dict]:
    """Bounded, read-only ad-hoc SQL: one SELECT / WITH statement, at most `limit` rows."""
    text = sql.strip().rstrip(";").strip()
    head = text.split(None, 1)[0].upper() if text else ""
    if head not in ("SELECT", "WITH") or ";" in text:
        raise ValueError("only a single SELECT / WITH statement is allowed")
    # wrapped as a sub-select: a statement that is not a query cannot parse here
    cur = db.execute(f"SELECT * FROM ({text}) LIMIT {int(limit) + 1}")
    data = [dict(zip([c[0] for c in cur.description], r)) for r in cur.fetchall()]
    if len(data) > limit:
        raise ValueError(f"more than {limit} rows; narrow the query")
    return data


def render(table: list[dict]) -> str:
    if not table:
        return "(no rows)"
    cols = list(table[0].keys())
    widths = [max(len(c), *(len(str(r.get(c, ""))) for r in table)) for c in cols]
    lines = [" | ".join(c.ljust(w) for c, w in zip(cols, widths)), "-+-".join("-" * w for w in widths)]
    for r in table:
        lines.append(" | ".join(str(r.get(c, "")).ljust(w) for c, w in zip(cols, widths)))
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("import", "views", "summary", "query"))
    ap.add_argument("arg", nargs="?", help="export JSON path (import) or SQL text (query)")
    ap.add_argument("--database", required=True)
    ap.add_argument("--run", help="run id (defaults to the only / latest imported run)")
    ap.add_argument("--out", help="write the summary JSON here")
    a = ap.parse_args(argv)
    db = connect(a.database)
    initialize(db)
    if a.command == "import":
        if not a.arg:
            ap.error("import needs the export JSON path")
        data = json.loads(Path(a.arg).read_text(encoding="utf-8"))
        rid = import_ledger(db, data)
        s = rows(db, "SELECT units, events, delivered FROM v_run_summary WHERE run_id = ?", (rid,))[0]
        print(f"imported {rid}: {s['units']} units, {s['events']} events, {s['delivered']} delivered")
        return 0
    run_id = a.run or (rows(db, "SELECT id FROM run ORDER BY rowid DESC LIMIT 1") or [{"id": None}])[0]["id"]
    if a.command == "query":
        if not a.arg:
            ap.error("query needs the SQL text")
        print(render(query(db, a.arg)))
        return 0
    if run_id is None:
        print("no run imported yet", file=sys.stderr)
        return 1
    if a.command == "views":
        for name in PLANNER_VIEWS + INVARIANT_VIEWS:
            print(f"== {name} ==")
            print(render(rows(db, f"SELECT * FROM {name} WHERE run_id = ? ORDER BY 2, 3", (run_id,))))
            print()
        return 0
    s = summary(db, run_id)
    text = json.dumps(s, indent=1, sort_keys=False)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")
        print(f"summary written to {a.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

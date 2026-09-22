"""The run ledger in SQL (v3.32).

Imports a `factory-run-ledger/v1` export from the browser (Simulate -> Live material
flow -> Export run ledger) into SQLite and answers the questions a planner asks with
plain SQL views: cycle time and touches per order type, waiting at each bench, WIP
over time, quantities per operation (pallets / cases / eaches / parcels), the dispatch
manifest (pallets, parcels, trailers), what a handling unit costs (v3.35: spans between
events charged at the rates the run was recorded under), and the invariants that must hold -
conservation of eaches, cross-dock never in storage, consecutive versions. Standard library only.

    python tools/run_ledger.py import run-ledger.json --database work/run.sqlite
    python tools/run_ledger.py views  --database work/run.sqlite [--run RUN-...] [--all]
    python tools/run_ledger.py summary --database work/run.sqlite [--run RUN-...] [--out summary.json]
    python tools/run_ledger.py query  --database work/run.sqlite "SELECT ..."   (read-only, bounded)
    python tools/run_ledger.py compare --database work/run.sqlite --runs RUN-a RUN-b [--out compare.json]   (v3.37: B - A)
    python tools/run_ledger.py report  --database work/run.sqlite [--run RUN-...] [--runs RUN-a RUN-b] [--out report.md]   (v3.41: Markdown)

Honesty: the events are synthetic (a teaching simulation, not telemetry, not a WMS);
the quantities are the synthetic order-line quantities of the scenario's packaging
profile. The numbers are exact for that simulation and mean nothing about any real site.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path

SCHEMA_ID = "factory-run-ledger/v1"
KINDS = ("created", "queued", "served", "passed", "delivered", "restocked", "scrapped", "retired")
TRAILER_SLOTS = {"eur": 33, "ind": 26, "half": 66, "drum": 22, "cage": 26}

DDL = """
CREATE TABLE IF NOT EXISTS run(
  id TEXT PRIMARY KEY NOT NULL, scenario TEXT NOT NULL, seed INTEGER NOT NULL, hash TEXT, mix TEXT,
  profile TEXT, ticks_per_hour INTEGER NOT NULL, minutes_per_tick REAL NOT NULL, ticks INTEGER NOT NULL, honesty TEXT,
  dataset_source TEXT, dataset_orders INTEGER, dataset_lines INTEGER, dataset_skus INTEGER,
  policy TEXT);
-- run.dataset_*: v3.44, the order pool's provenance (NULL for a synthetic stream);
-- run.policy: v3.45, the adaptive-staffing what-if as JSON (NULL when the run had none).
-- (No trailing comment before a closing parenthesis: ALTER TABLE ... DROP COLUMN rewrites that text.)
-- v3.45 the staffing changes the what-if made (one row per change at a bench)
CREATE TABLE IF NOT EXISTS staffing_event(
  run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE, tick INTEGER NOT NULL CHECK(tick >= 0),
  location_id TEXT NOT NULL, servers INTEGER NOT NULL CHECK(servers >= 1), PRIMARY KEY(run_id, tick, location_id));
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
  order_ref TEXT, sku TEXT, line_qty INTEGER,  -- v3.44: the order line as the file gave it, NULL for a synthetic stream
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
  transport_class TEXT, transport_labour INTEGER NOT NULL DEFAULT 0 CHECK(transport_labour IN (0, 1)), source TEXT, honesty TEXT,
  holding_per_unit_hour REAL NOT NULL DEFAULT 0 CHECK(holding_per_unit_hour >= 0));
CREATE TABLE IF NOT EXISTS equipment_rate(
  run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE, class TEXT NOT NULL,
  capex REAL NOT NULL CHECK(capex >= 0), amort_years REAL NOT NULL CHECK(amort_years > 0), power_kw REAL NOT NULL CHECK(power_kw >= 0),
  labour INTEGER NOT NULL DEFAULT 0 CHECK(labour IN (0, 1)), PRIMARY KEY(run_id, class));
-- v3.46 Student's t, two-sided 95 %, seeded on open (df 1..30; df > 30 uses 1.960 in the views)
CREATE TABLE IF NOT EXISTS t_critical(df INTEGER PRIMARY KEY NOT NULL, t975 REAL NOT NULL);
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
SELECT r.id AS run_id, r.scenario, r.seed, r.profile, r.ticks, r.dataset_source, r.dataset_orders, r.dataset_lines, r.policy,
       (SELECT COUNT(*) FROM hu h WHERE h.run_id = r.id) AS units,
       (SELECT COUNT(*) FROM handling_event e JOIN hu h ON h.id = e.hu_id WHERE h.run_id = r.id) AS events,
       (SELECT COUNT(*) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered,
       (SELECT COALESCE(SUM(h.final_eaches), 0) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered_eaches,
       (SELECT COALESCE(SUM(h.final_pallets), 0) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered_pallets,
       (SELECT COALESCE(SUM(h.final_parcels), 0) FROM hu h WHERE h.run_id = r.id AND h.final_kind = 'delivered') AS delivered_parcels
FROM run r;""",
    # ---- v3.36 the flow as recorded ---------------------------------------------
    # One link per unit that moved from one operation to the next: consecutive
    # non-queued events (a queued event is a wait, not a move) whose operation
    # changes (a unit's two events at its terminal operation collapse).
    "v_flow_links": """
CREATE VIEW IF NOT EXISTS v_flow_links AS
WITH s AS (
  SELECT h.run_id, e.hu_id, e.op, e.eaches, h.retired_tick,
         LEAD(e.op) OVER (PARTITION BY e.hu_id ORDER BY e.version) AS to_op
  FROM handling_event e JOIN hu h ON h.id = e.hu_id
  WHERE e.kind <> 'queued')
SELECT run_id, op AS from_op, to_op, COUNT(*) AS units,
       SUM(CASE WHEN retired_tick IS NOT NULL THEN 1 ELSE 0 END) AS retired_units, SUM(eaches) AS eaches
FROM s WHERE to_op IS NOT NULL AND to_op <> op
GROUP BY run_id, op, to_op;""",
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
         CASE WHEN s.state = 'waiting' THEN s.ticks * ru.minutes_per_tick / 60.0 ELSE 0 END AS held_hours,
         r.labour_per_hour, r.energy_price_per_kwh, r.hours_per_year, r.holding_per_unit_hour
  FROM v_spans s
  JOIN run ru ON ru.id = s.run_id
  JOIN rate r ON r.run_id = s.run_id
  LEFT JOIN location l ON l.run_id = s.run_id AND l.id = s.location
  LEFT JOIN location_class lc ON lc.run_id = s.run_id AND lc.type = l.type)
SELECT c.run_id, c.hu_id, c.version, c.state, c.op, c.location, c.ticks, c.charged_ticks, c.class, c.labour, c.hours, c.held_hours,
       c.hours * c.labour * c.labour_per_hour                              AS labour_eur,
       c.hours * COALESCE(er.capex / er.amort_years / c.hours_per_year, 0) AS equipment_eur,
       c.hours * COALESCE(er.power_kw, 0) * c.energy_price_per_kwh         AS energy_eur,
       c.held_hours * c.holding_per_unit_hour                              AS holding_eur
FROM c LEFT JOIN equipment_rate er ON er.run_id = c.run_id AND er.class = c.class;""",
    "v_cost_by_hu": """
CREATE VIEW IF NOT EXISTS v_cost_by_hu AS
SELECT run_id, hu_id, SUM(ticks) AS ticks,
       SUM(CASE WHEN state = 'waiting' THEN ticks ELSE 0 END) AS waiting_ticks,
       SUM(CASE WHEN state = 'moving' THEN ticks ELSE 0 END) AS moving_ticks,
       SUM(charged_ticks) AS charged_ticks, ROUND(SUM(hours), 4) AS hours,
       ROUND(SUM(labour_eur), 4) AS labour_eur, ROUND(SUM(equipment_eur), 4) AS equipment_eur, ROUND(SUM(energy_eur), 4) AS energy_eur,
       ROUND(SUM(holding_eur), 4) AS holding_eur,
       ROUND(SUM(labour_eur + equipment_eur + energy_eur + holding_eur), 4) AS total_eur
FROM v_span_cost GROUP BY run_id, hu_id;""",
    "v_cost_by_type": """
CREATE VIEW IF NOT EXISTS v_cost_by_type AS
WITH c AS (SELECT hu_id, SUM(hours) AS hr, SUM(labour_eur) AS l, SUM(equipment_eur) AS q, SUM(energy_eur) AS n, SUM(holding_eur) AS g FROM v_span_cost GROUP BY hu_id)
SELECT h.run_id, h.archetype, COUNT(*) AS units,
       SUM(CASE WHEN h.retired_tick IS NOT NULL THEN 1 ELSE 0 END) AS retired,
       SUM(h.received_eaches) AS eaches_in,
       COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0) AS eaches_out,
       ROUND(COALESCE(SUM(c.hr), 0), 4) AS hours,
       ROUND(COALESCE(SUM(c.l), 0), 4) AS labour_eur, ROUND(COALESCE(SUM(c.q), 0), 4) AS equipment_eur, ROUND(COALESCE(SUM(c.n), 0), 4) AS energy_eur,
       ROUND(COALESCE(SUM(c.g), 0), 4) AS holding_eur,
       ROUND(COALESCE(SUM(c.l + c.q + c.n + c.g), 0), 4) AS total_eur,
       ROUND(COALESCE(SUM(c.l + c.q + c.n + c.g), 0) / COUNT(*), 4) AS eur_per_unit,
       ROUND(COALESCE(SUM(c.l + c.q + c.n + c.g), 0) / NULLIF(SUM(h.received_eaches), 0), 4) AS eur_per_received_each,
       ROUND(COALESCE(SUM(c.l + c.q + c.n + c.g), 0) / NULLIF(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0), 4) AS eur_per_each
FROM hu h JOIN rate r ON r.run_id = h.run_id
LEFT JOIN c ON c.hu_id = h.id
GROUP BY h.run_id, h.archetype;""",
    "v_cost_by_location": """
CREATE VIEW IF NOT EXISTS v_cost_by_location AS
SELECT run_id, location, MAX(class) AS class, COUNT(*) AS spans, SUM(ticks) AS ticks, SUM(charged_ticks) AS charged_ticks, ROUND(SUM(hours), 4) AS hours,
       ROUND(SUM(labour_eur), 4) AS labour_eur, ROUND(SUM(equipment_eur), 4) AS equipment_eur, ROUND(SUM(energy_eur), 4) AS energy_eur, ROUND(SUM(holding_eur), 4) AS holding_eur,
       ROUND(SUM(labour_eur + equipment_eur + energy_eur + holding_eur), 4) AS total_eur
FROM v_span_cost WHERE state = 'waiting' GROUP BY run_id, location
UNION ALL
SELECT run_id, 'transport' AS location, MAX(class), COUNT(*), SUM(ticks), SUM(charged_ticks), ROUND(SUM(hours), 4),
       ROUND(SUM(labour_eur), 4), ROUND(SUM(equipment_eur), 4), ROUND(SUM(energy_eur), 4), ROUND(SUM(holding_eur), 4),
       ROUND(SUM(labour_eur + equipment_eur + energy_eur + holding_eur), 4)
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
    # ---- v3.37 compare two runs: one row per ordered pair (run_a, run_b) and key; deltas are B - A,
    # NULL whenever a side lacks the key (a type or bench seen in only one run still appears) ----
    "v_compare_summary": """
CREATE VIEW IF NOT EXISTS v_compare_summary AS
SELECT a.run_id AS run_a, b.run_id AS run_b,
       a.units AS units_a, b.units AS units_b, b.units - a.units AS delta_units,
       a.events AS events_a, b.events AS events_b, b.events - a.events AS delta_events,
       a.delivered AS delivered_a, b.delivered AS delivered_b, b.delivered - a.delivered AS delta_delivered,
       a.delivered_eaches AS delivered_eaches_a, b.delivered_eaches AS delivered_eaches_b, b.delivered_eaches - a.delivered_eaches AS delta_delivered_eaches
FROM v_run_summary a JOIN v_run_summary b ON b.run_id <> a.run_id;""",
    "v_compare_cycle": """
CREATE VIEW IF NOT EXISTS v_compare_cycle AS
WITH keys AS (SELECT DISTINCT ra.id AS run_a, rb.id AS run_b, h.archetype FROM run ra JOIN run rb ON rb.id <> ra.id JOIN hu h ON h.run_id IN (ra.id, rb.id))
SELECT k.run_a, k.run_b, k.archetype,
       a.units AS units_a, b.units AS units_b, b.units - a.units AS delta_units,
       a.retired AS retired_a, b.retired AS retired_b, b.retired - a.retired AS delta_retired,
       a.avg_cycle_ticks AS avg_cycle_ticks_a, b.avg_cycle_ticks AS avg_cycle_ticks_b, ROUND(b.avg_cycle_ticks - a.avg_cycle_ticks, 4) AS delta_avg_cycle_ticks
FROM keys k
LEFT JOIN v_cycle_time_by_type a ON a.run_id = k.run_a AND a.archetype = k.archetype
LEFT JOIN v_cycle_time_by_type b ON b.run_id = k.run_b AND b.archetype = k.archetype;""",
    "v_compare_touches": """
CREATE VIEW IF NOT EXISTS v_compare_touches AS
WITH keys AS (SELECT DISTINCT ra.id AS run_a, rb.id AS run_b, h.archetype FROM run ra JOIN run rb ON rb.id <> ra.id JOIN hu h ON h.run_id IN (ra.id, rb.id))
SELECT k.run_a, k.run_b, k.archetype,
       a.touches AS touches_a, b.touches AS touches_b, ROUND(b.touches - a.touches, 4) AS delta_touches,
       a.served_per_unit AS served_per_unit_a, b.served_per_unit AS served_per_unit_b, ROUND(b.served_per_unit - a.served_per_unit, 4) AS delta_served_per_unit
FROM keys k
LEFT JOIN v_touches_by_type a ON a.run_id = k.run_a AND a.archetype = k.archetype
LEFT JOIN v_touches_by_type b ON b.run_id = k.run_b AND b.archetype = k.archetype;""",
    "v_compare_wait": """
CREATE VIEW IF NOT EXISTS v_compare_wait AS
WITH keys AS (SELECT DISTINCT ra.id AS run_a, rb.id AS run_b, w.location, w.op FROM run ra JOIN run rb ON rb.id <> ra.id JOIN v_station_wait w ON w.run_id IN (ra.id, rb.id))
SELECT k.run_a, k.run_b, k.location, k.op,
       a.waits AS waits_a, b.waits AS waits_b, b.waits - a.waits AS delta_waits,
       a.avg_wait_ticks AS avg_wait_ticks_a, b.avg_wait_ticks AS avg_wait_ticks_b, ROUND(b.avg_wait_ticks - a.avg_wait_ticks, 4) AS delta_avg_wait_ticks,
       a.still_waiting AS still_waiting_a, b.still_waiting AS still_waiting_b, b.still_waiting - a.still_waiting AS delta_still_waiting
FROM keys k
LEFT JOIN v_station_wait a ON a.run_id = k.run_a AND a.location = k.location AND a.op = k.op
LEFT JOIN v_station_wait b ON b.run_id = k.run_b AND b.location = k.location AND b.op = k.op;""",
    "v_compare_dispatch": """
CREATE VIEW IF NOT EXISTS v_compare_dispatch AS
SELECT ra.id AS run_a, rb.id AS run_b,
       a.delivered_units AS delivered_units_a, b.delivered_units AS delivered_units_b, b.delivered_units - a.delivered_units AS delta_delivered_units,
       a.pallets AS pallets_a, b.pallets AS pallets_b, b.pallets - a.pallets AS delta_pallets,
       a.parcels AS parcels_a, b.parcels AS parcels_b, b.parcels - a.parcels AS delta_parcels,
       a.trailers AS trailers_a, b.trailers AS trailers_b, b.trailers - a.trailers AS delta_trailers
FROM run ra JOIN run rb ON rb.id <> ra.id
LEFT JOIN v_dispatch a ON a.run_id = ra.id
LEFT JOIN v_dispatch b ON b.run_id = rb.id;""",
    "v_compare_cost": """
CREATE VIEW IF NOT EXISTS v_compare_cost AS
WITH keys AS (SELECT DISTINCT ra.id AS run_a, rb.id AS run_b, h.archetype FROM run ra JOIN run rb ON rb.id <> ra.id JOIN hu h ON h.run_id IN (ra.id, rb.id))
SELECT k.run_a, k.run_b, k.archetype,
       a.total_eur AS total_eur_a, b.total_eur AS total_eur_b, ROUND(b.total_eur - a.total_eur, 4) AS delta_total_eur,
       a.eur_per_unit AS eur_per_unit_a, b.eur_per_unit AS eur_per_unit_b, ROUND(b.eur_per_unit - a.eur_per_unit, 4) AS delta_eur_per_unit,
       a.eur_per_each AS eur_per_each_a, b.eur_per_each AS eur_per_each_b, ROUND(b.eur_per_each - a.eur_per_each, 4) AS delta_eur_per_each
FROM keys k
LEFT JOIN v_cost_by_type a ON a.run_id = k.run_a AND a.archetype = k.archetype
LEFT JOIN v_cost_by_type b ON b.run_id = k.run_b AND b.archetype = k.archetype;""",
}
# ---- v3.44 your own orders: consolidation modelled AT DISPATCH, not in the flow --------
# Every order line moved through the building as its own unit; an order's pallets_needed is
# its delivered cases over the profile's cases per pallet (integer division rounds up) - the
# customer pallets the order's cases would fill if consolidated at dispatch; 0 when nothing
# was delivered. A mixed pallet's build sequence or stability is not modelled.
VIEWS["v_dispatch_by_order"] = """
CREATE VIEW IF NOT EXISTS v_dispatch_by_order AS
SELECT h.run_id, h.order_id, MAX(h.order_ref) AS order_ref, COUNT(*) AS lines,
       SUM(CASE WHEN h.final_kind = 'delivered' THEN 1 ELSE 0 END) AS delivered_lines,
       SUM(h.received_eaches) AS eaches_in,
       COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0) AS eaches_out,
       COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_cases END), 0) AS cases,
       COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_parcels END), 0) AS parcels,
       MAX(h.cases_per_pallet) AS cases_per_pallet,
       CASE WHEN MAX(h.cases_per_pallet) > 0
            THEN (COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_cases END), 0) + MAX(h.cases_per_pallet) - 1) / MAX(h.cases_per_pallet)
            ELSE 0 END AS pallets_needed
FROM hu h GROUP BY h.run_id, h.order_id;"""


# ---- v3.45 adaptive staffing: the what-if's change log, per bench ------------------------
# One row per bench that changed its staffing: how often, the most workers it had, when the
# first change came, and for how many ticks it ran with more than one worker (each change
# holds until the next one at that bench, or the end of the run).
VIEWS["v_staffing"] = """
CREATE VIEW IF NOT EXISTS v_staffing AS
WITH ev AS (
  SELECT s.run_id, s.location_id, s.tick, s.servers,
         LEAD(s.tick) OVER (PARTITION BY s.run_id, s.location_id ORDER BY s.tick) AS next_tick
  FROM staffing_event s)
SELECT ev.run_id, ev.location_id, COUNT(*) AS changes, MAX(ev.servers) AS max_servers, MIN(ev.tick) AS first_change_tick,
       SUM(CASE WHEN ev.servers > 1 THEN COALESCE(ev.next_tick, r.ticks) - ev.tick ELSE 0 END) AS ticks_with_extra_server
FROM ev JOIN run r ON r.id = ev.run_id
GROUP BY ev.run_id, ev.location_id;"""


# ---- v3.46 replications over seeds ---------------------------------------------------------
# Runs that share scenario, order mix, ticks and policy but differ in seed form a group; per
# group and order type: n, the mean, the SAMPLE standard deviation (two-pass, mean first),
# a Student-t two-sided 95 % half-width t(n-1) x s / sqrt(n), min and max. df > 30 uses
# 1.960. Not keyed by run_id (a group spans runs). Seeds only: no warm-up removal, no
# validation against a real plant.
VIEWS["v_replication_groups"] = """
CREATE VIEW IF NOT EXISTS v_replication_groups AS
SELECT scenario, COALESCE(mix, '') AS mix, ticks, COALESCE(policy, '') AS policy, COUNT(*) AS n, GROUP_CONCAT(seed, ',') AS seeds
FROM (SELECT scenario, mix, ticks, policy, seed FROM run ORDER BY scenario, seed)
GROUP BY scenario, COALESCE(mix, ''), ticks, COALESCE(policy, '');"""
VIEWS["v_replication_cycle_by_type"] = """
CREATE VIEW IF NOT EXISTS v_replication_cycle_by_type AS
WITH g AS (SELECT id AS run_id, scenario, COALESCE(mix, '') AS mix, ticks, COALESCE(policy, '') AS policy FROM run),
     x AS (SELECT g.scenario, g.mix, g.ticks, g.policy, c.archetype AS k, c.avg_cycle_ticks AS v
           FROM v_cycle_time_by_type c JOIN g ON g.run_id = c.run_id WHERE c.avg_cycle_ticks IS NOT NULL),
     m AS (SELECT scenario, mix, ticks, policy, k, COUNT(*) AS n, AVG(v) AS mean, MIN(v) AS min, MAX(v) AS max
           FROM x GROUP BY scenario, mix, ticks, policy, k),
     s AS (SELECT x.scenario, x.mix, x.ticks, x.policy, x.k, SUM((x.v - m.mean) * (x.v - m.mean)) AS ss
           FROM x JOIN m ON m.scenario = x.scenario AND m.mix = x.mix AND m.ticks = x.ticks AND m.policy = x.policy AND m.k = x.k
           GROUP BY x.scenario, x.mix, x.ticks, x.policy, x.k)
SELECT m.scenario, m.mix, m.ticks, m.policy, m.k AS archetype, m.n, ROUND(m.mean, 4) AS mean,
       CASE WHEN m.n > 1 THEN ROUND(sqrt(s.ss / (m.n - 1)), 4) END AS stdev,
       CASE WHEN m.n > 1 THEN ROUND(COALESCE(t.t975, 1.960) * sqrt(s.ss / (m.n - 1)) / sqrt(m.n), 4) END AS ci95_half,
       ROUND(m.min, 4) AS min, ROUND(m.max, 4) AS max
FROM m JOIN s ON s.scenario = m.scenario AND s.mix = m.mix AND s.ticks = m.ticks AND s.policy = m.policy AND s.k = m.k
LEFT JOIN t_critical t ON t.df = m.n - 1;"""
VIEWS["v_replication_cost_by_type"] = """
CREATE VIEW IF NOT EXISTS v_replication_cost_by_type AS
WITH g AS (SELECT id AS run_id, scenario, COALESCE(mix, '') AS mix, ticks, COALESCE(policy, '') AS policy FROM run),
     x AS (SELECT g.scenario, g.mix, g.ticks, g.policy, c.archetype AS k, c.total_eur AS v
           FROM v_cost_by_type c JOIN g ON g.run_id = c.run_id),
     m AS (SELECT scenario, mix, ticks, policy, k, COUNT(*) AS n, AVG(v) AS mean, MIN(v) AS min, MAX(v) AS max
           FROM x GROUP BY scenario, mix, ticks, policy, k),
     s AS (SELECT x.scenario, x.mix, x.ticks, x.policy, x.k, SUM((x.v - m.mean) * (x.v - m.mean)) AS ss
           FROM x JOIN m ON m.scenario = x.scenario AND m.mix = x.mix AND m.ticks = x.ticks AND m.policy = x.policy AND m.k = x.k
           GROUP BY x.scenario, x.mix, x.ticks, x.policy, x.k)
SELECT m.scenario, m.mix, m.ticks, m.policy, m.k AS archetype, m.n, ROUND(m.mean, 4) AS mean,
       CASE WHEN m.n > 1 THEN ROUND(sqrt(s.ss / (m.n - 1)), 4) END AS stdev,
       CASE WHEN m.n > 1 THEN ROUND(COALESCE(t.t975, 1.960) * sqrt(s.ss / (m.n - 1)) / sqrt(m.n), 4) END AS ci95_half,
       ROUND(m.min, 4) AS min, ROUND(m.max, 4) AS max
FROM m JOIN s ON s.scenario = m.scenario AND s.mix = m.mix AND s.ticks = m.ticks AND s.policy = m.policy AND s.k = m.k
LEFT JOIN t_critical t ON t.df = m.n - 1;"""
VIEWS["v_replication_summary"] = """
CREATE VIEW IF NOT EXISTS v_replication_summary AS
WITH g AS (SELECT id AS run_id, scenario, COALESCE(mix, '') AS mix, ticks, COALESCE(policy, '') AS policy FROM run),
     x AS (SELECT g.scenario, g.mix, g.ticks, g.policy, 'units' AS k, CAST(r.units AS REAL) AS v FROM v_run_summary r JOIN g ON g.run_id = r.run_id
           UNION ALL SELECT g.scenario, g.mix, g.ticks, g.policy, 'delivered', CAST(r.delivered AS REAL) FROM v_run_summary r JOIN g ON g.run_id = r.run_id
           UNION ALL SELECT g.scenario, g.mix, g.ticks, g.policy, 'total_eur', COALESCE((SELECT SUM(c.total_eur) FROM v_cost_by_type c WHERE c.run_id = g.run_id), 0) FROM g),
     m AS (SELECT scenario, mix, ticks, policy, k, COUNT(*) AS n, AVG(v) AS mean, MIN(v) AS min, MAX(v) AS max
           FROM x GROUP BY scenario, mix, ticks, policy, k),
     s AS (SELECT x.scenario, x.mix, x.ticks, x.policy, x.k, SUM((x.v - m.mean) * (x.v - m.mean)) AS ss
           FROM x JOIN m ON m.scenario = x.scenario AND m.mix = x.mix AND m.ticks = x.ticks AND m.policy = x.policy AND m.k = x.k
           GROUP BY x.scenario, x.mix, x.ticks, x.policy, x.k)
SELECT m.scenario, m.mix, m.ticks, m.policy, m.k AS metric, m.n, ROUND(m.mean, 4) AS mean,
       CASE WHEN m.n > 1 THEN ROUND(sqrt(s.ss / (m.n - 1)), 4) END AS stdev,
       CASE WHEN m.n > 1 THEN ROUND(COALESCE(t.t975, 1.960) * sqrt(s.ss / (m.n - 1)) / sqrt(m.n), 4) END AS ci95_half,
       ROUND(m.min, 4) AS min, ROUND(m.max, 4) AS max
FROM m JOIN s ON s.scenario = m.scenario AND s.mix = m.mix AND s.ticks = m.ticks AND s.policy = m.policy AND s.k = m.k
LEFT JOIN t_critical t ON t.df = m.n - 1;"""
REPLICATION_VIEWS = ("v_replication_groups", "v_replication_cycle_by_type", "v_replication_cost_by_type", "v_replication_summary")
# Student's t, two-sided 95 % (0.975 quantile) for df 1..30 - standard tables; df > 30 uses 1.960.
T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
        11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
        21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042}


INVARIANT_VIEWS = ("v_conservation_violations", "v_cross_dock_violations", "v_version_gaps", "v_terminal_violations")
PLANNER_VIEWS = ("v_run_summary", "v_cycle_time_by_type", "v_touches_by_type", "v_station_wait", "v_quantities_by_op", "v_dispatch",
                 "v_cost_by_type", "v_cost_by_location", "v_flow_links", "v_staffing")
DETAIL_VIEWS = ("v_wip_by_tick", "v_spans", "v_span_cost", "v_cost_by_hu", "v_dispatch_by_order")  # long or per-row views: `views --all`
COMPARE_VIEWS = ("v_compare_summary", "v_compare_cycle", "v_compare_touches", "v_compare_wait", "v_compare_dispatch", "v_compare_cost")


def connect(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:  # v3.46: sqrt() is built in when SQLite was compiled with the math functions; register it otherwise
        db.execute("SELECT sqrt(4)").fetchone()
    except sqlite3.OperationalError:
        db.create_function("sqrt", 1, math.sqrt, deterministic=True)
    return db


def initialize(db: sqlite3.Connection) -> None:
    db.executescript(DDL)
    try:  # a database created before v3.35 has no service_ticks column yet
        db.execute("ALTER TABLE location ADD COLUMN service_ticks REAL")
    except sqlite3.OperationalError:
        pass
    try:  # a database created before v3.40 has no holding rate yet
        db.execute("ALTER TABLE rate ADD COLUMN holding_per_unit_hour REAL NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    for table, column, typ in (  # a database created before v3.44 has no dataset / order-line columns yet
        ("run", "dataset_source", "TEXT"), ("run", "dataset_orders", "INTEGER"), ("run", "dataset_lines", "INTEGER"), ("run", "dataset_skus", "INTEGER"),
        ("hu", "order_ref", "TEXT"), ("hu", "sku", "TEXT"), ("hu", "line_qty", "INTEGER"),
        ("run", "policy", "TEXT"),  # v3.45
    ):
        try:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {typ}")
        except sqlite3.OperationalError:
            pass
    # views are dropped and recreated on every open, so a database created by an
    # older version always runs the current text (v3.39) - the text the viewer shows
    for name in VIEWS:
        db.execute(f"DROP VIEW IF EXISTS {name}")
    for ddl in VIEWS.values():
        db.executescript(ddl)
    for pid, slots in TRAILER_SLOTS.items():
        db.execute("INSERT OR IGNORE INTO pallet_type VALUES(?, ?)", (pid, slots))
    db.executemany("INSERT OR IGNORE INTO t_critical VALUES(?, ?)", list(T975.items()))  # v3.46
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
        ds = run.get("dataset") or {}
        db.execute(
            "INSERT INTO run(id, scenario, seed, hash, mix, profile, ticks_per_hour, minutes_per_tick, ticks, honesty, "
            "dataset_source, dataset_orders, dataset_lines, dataset_skus, policy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            run["id"], run["scenario"], int(run["seed"]), run.get("hash"),
            json.dumps(run.get("mix"), sort_keys=True) if run.get("mix") is not None else None,
            run.get("profile"), int(run["ticks_per_hour"]), float(run["minutes_per_tick"]), int(run["ticks"]), run.get("honesty"),
            ds.get("source"), ds.get("orders"), ds.get("lines"), ds.get("skus"),
            json.dumps(run.get("policy"), sort_keys=True) if run.get("policy") is not None else None))
        db.executemany("INSERT INTO staffing_event(run_id, tick, location_id, servers) VALUES(?,?,?,?)", [
            (run["id"], int(s["tick"]), str(s["location_id"]), int(s["servers"])) for s in data.get("staffing") or []])
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
            db.execute(
                "INSERT INTO rate(run_id, currency, labour_per_hour, energy_price_per_kwh, hours_per_year, co2_per_kwh, "
                "transport_class, transport_labour, source, honesty, holding_per_unit_hour) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                    run["id"], rates.get("currency", "EUR"), float(rates["labour_per_hour"]), float(rates["energy_price_per_kwh"]),
                    float(rates["hours_per_year"]), rates.get("co2_per_kwh"), tr.get("class"), 1 if tr.get("labour") else 0,
                    rates.get("source"), rates.get("honesty"), float(rates.get("holding_per_unit_hour") or 0)))
            for cls, e in sorted((rates.get("equipment") or {}).items()):
                db.execute("INSERT INTO equipment_rate VALUES(?,?,?,?,?,?)", (
                    run["id"], cls, float(e["capex"]), float(e["amort_years"]), float(e["power_kw"]), 1 if e.get("labour") else 0))
            for typ, c in sorted((rates.get("classes") or {}).items()):
                db.execute("INSERT INTO location_class VALUES(?,?,?,?)", (run["id"], typ, c.get("class"), 1 if c.get("labour") else 0))
        for h in hus:
            f = h.get("final") or {}
            db.execute(
                "INSERT INTO hu(id, run_id, order_id, seq, archetype, outcome, route_id, sscc, gtin13, gtin14, pallet, box, eaches_per_case, "
                "cases_per_pallet, received_eaches, spawned_tick, retired_tick, final_kind, final_pallets, final_cases, final_eaches, final_parcels, "
                "final_form, final_retained, final_scrapped, order_ref, sku, line_qty) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                h["id"], run["id"], h["order_id"], int(h["seq"]), h["archetype"], h.get("outcome"), h["route_id"],
                h["sscc"], h["gtin13"], h["gtin14"], h.get("pallet"), h.get("box"), h.get("eaches_per_case"), h.get("cases_per_pallet"),
                int(h["received_eaches"]), int(h["spawned_tick"]), h.get("retired_tick"), h.get("final_kind"),
                f.get("pallets"), f.get("cases"), f.get("eaches"), f.get("parcels"), f.get("form"), f.get("retained"), f.get("scrapped"),
                h.get("order_ref"), h.get("sku"), h.get("line_qty")))
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


def compare(db: sqlite3.Connection, run_a: str, run_b: str) -> dict:
    """The six compare views for one ordered pair of runs (deltas are B - A), as plain JSON."""
    out = {"run_a": run_a, "run_b": run_b}
    for name in COMPARE_VIEWS:
        out[name] = rows(db, f"SELECT * FROM {name} WHERE run_a = ? AND run_b = ? ORDER BY 3, 4", (run_a, run_b))
    return out


# ---- v3.41 the Markdown report ---------------------------------------------------
DROP_COLS = ("run_id", "run_a", "run_b")
DASH = "\u2014"


def md_cell(v) -> str:
    if v is None:
        return DASH
    return str(v).replace("|", "\\|").replace("\n", " ")


def md_table(rows: list[dict], cols: list[str] | None = None) -> str:
    """A GitHub-flavoured Markdown table; NULL as an em dash, pipes escaped; '(no rows)' when empty."""
    if not rows:
        return "(no rows)\n"
    cols = cols or [c for c in rows[0].keys() if c not in DROP_COLS]
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for r in rows:
        out.append("| " + " | ".join(md_cell(r.get(c)) for c in cols) + " |")
    return "\n".join(out) + "\n"


def mix_text(mix) -> str:
    if not mix:
        return "standard spine (no mix)"
    if isinstance(mix, list):
        return " · ".join(f"{m['id']} {round(m['share'] * 100)}%" for m in mix)
    return " · ".join(f"{k} {round(v * 100)}%" for k, v in mix.items())


def run_header(db: sqlite3.Connection, run_id: str) -> dict:
    r = rows(db, "SELECT * FROM run WHERE id = ?", (run_id,))
    if not r:
        raise ValueError(f"unknown run {run_id!r}")
    h = dict(r[0])
    h["mix"] = json.loads(h["mix"]) if h.get("mix") else None
    h["minutes"] = round(h["ticks"] * h["minutes_per_tick"], 2)
    return h


def report(db: sqlite3.Connection, run_id: str, runs: tuple[str, str] | None = None) -> str:
    """One run as a deterministic Markdown report - the same views the viewer shows - and, with
    `runs`, the six compare views for that ordered pair. No timestamps: the same database gives the same text."""
    h = run_header(db, run_id)
    s = summary(db, run_id)
    top = s["v_run_summary"][0] if s["v_run_summary"] else {}
    disp = s["v_dispatch"][0] if s["v_dispatch"] else {}
    rate = rows(db, "SELECT * FROM rate WHERE run_id = ?", (run_id,))
    rate = rate[0] if rate else None
    cost = rows(db, "SELECT ROUND(SUM(hours), 4) AS hours, ROUND(SUM(labour_eur), 4) AS labour_eur, ROUND(SUM(equipment_eur), 4) AS equipment_eur, "
                    "ROUND(SUM(energy_eur), 4) AS energy_eur, ROUND(SUM(holding_eur), 4) AS holding_eur, "
                    "ROUND(SUM(labour_eur + equipment_eur + energy_eur + holding_eur), 4) AS total_eur FROM v_span_cost WHERE run_id = ?", (run_id,))[0]
    received = rows(db, "SELECT COALESCE(SUM(received_eaches), 0) AS n, SUM(CASE WHEN retired_tick IS NULL THEN 1 ELSE 0 END) AS in_flight FROM hu WHERE run_id = ?", (run_id,))[0]
    stations = rows(db, "SELECT COUNT(*) AS n, SUM(CASE WHEN ABS(service_ticks - 50) < 1e-6 THEN 1 ELSE 0 END) AS floor FROM location WHERE run_id = ? AND service_ticks IS NOT NULL", (run_id,))[0]
    lines = [f"# Run report: {run_id}", "",
             f"Scenario `{h['scenario']}` · seed {h['seed']} · profile {h.get('profile') or DASH} · order mix: {mix_text(h['mix'])} · "
             f"{h['ticks']} ticks ({h['minutes']} min, {h['minutes_per_tick']} min per tick)", "",
             "## At a glance", ""]
    glance = {"units": top.get("units"), "events": top.get("events"), "delivered": top.get("delivered"), "delivered_eaches": top.get("delivered_eaches"),
              "pallets": disp.get("pallets"), "parcels": disp.get("parcels"), "trailers": disp.get("trailers"), "received_eaches": received["n"], "in_flight": received["in_flight"]}
    if rate and cost["total_eur"] is not None:
        units = top.get("units") or 0
        glance["total_eur"] = cost["total_eur"]
        glance["eur_per_unit"] = round(cost["total_eur"] / units, 4) if units else None
        glance["eur_per_received_each"] = round(cost["total_eur"] / received["n"], 4) if received["n"] else None
        glance["eur_per_delivered_each"] = round(cost["total_eur"] / top["delivered_eaches"], 4) if top.get("delivered_eaches") else None
    lines.append(md_table([glance]))
    flags = []
    if not rate:
        flags.append("no rates in this file: the cost views are empty")
    elif not rate["holding_per_unit_hour"]:
        flags.append("no holding cost is set (0 per unit-hour): waiting stock costs nothing")
    if stations["n"] and stations["floor"] == stations["n"]:
        flags.append(f"every station ({stations['n']}) serves at the simulator's floor rate of 50 ticks per unit (the floor declares no capacities)")
    elif stations["floor"]:
        flags.append(f"{stations['floor']} of {stations['n']} stations serve at the floor rate of 50 ticks per unit")
    if received["in_flight"]:
        flags.append(f"{received['in_flight']} of {top.get('units')} units were still in flight at tick {h['ticks']}: their cycle time and cost are open")
    lines.append("Data-quality flags: " + ("; ".join(flags) if flags else "none") + "\n")
    lines += ["## Planner views", ""]
    for name in PLANNER_VIEWS:
        lines += [f"### {name}", "", md_table(s[name])]
    lines += ["## Cost detail", ""]
    if rate:
        lines += [md_table([cost]),
                  f"Rates: labour {rate['labour_per_hour']} per hour · energy {rate['energy_price_per_kwh']} per kWh · {rate['hours_per_year']} operating hours per year · "
                  f"holding {rate['holding_per_unit_hour']} per unit-hour waiting · transport {rate['transport_class'] or 'none'}"
                  f"{' (manned)' if rate['transport_labour'] else ''}\n"]
    else:
        lines.append("(no rates)\n")
    lines += ["## Invariants", "", md_table([{"view": n, "rows": s["invariants"][n]} for n in INVARIANT_VIEWS]),
              f"Invariant violations: {sum(s['invariants'].values())}\n"]
    if runs:
        c = compare(db, runs[0], runs[1])
        lines += [f"## Compare {runs[0]} → {runs[1]} (deltas B − A)", ""]
        for name in COMPARE_VIEWS:
            lines += [f"### {name}", "", md_table(c[name])]
    lines += ["## Honesty", "", h.get("honesty") or "", ""]
    if rate and rate.get("honesty"):
        lines += [rate["honesty"], ""]
    lines.append("Generated by tools/run_ledger.py report from the views the viewer shows; no timestamp, so the same database gives the same text.\n")
    return "\n".join(lines)


# ----------------------------------------------------------------------------- reconcile (v3.43)
# The JavaScript side (tools/make_run_ledger_fixture.mjs reconcile) writes the rows of every
# view it can also compute; this measures how far SQLite's rows are from them, column by
# column. Both sides sum with compensated (Neumaier) arithmetic since v3.43, so the rounded
# aggregates agree to at most one step in the fourth decimal (tolerance 1e-4) and the raw
# per-span values to 1e-9. Missing rows fail; a column only one side has is listed, not failed.
RECONCILE_KEYS = {
    "v_run_summary": (), "v_cycle_time_by_type": ("archetype",), "v_touches_by_type": ("archetype",),
    "v_station_wait": ("location", "op"), "v_wip_by_tick": ("tick",), "v_quantities_by_op": ("op", "kind"),
    "v_dispatch": (), "v_flow_links": ("from_op", "to_op"), "v_spans": ("hu_id", "version"), "v_span_cost": ("hu_id", "version"),
    "v_cost_by_hu": ("hu_id",), "v_cost_by_type": ("archetype",), "v_cost_by_location": ("location",),
    "v_dispatch_by_order": ("order_id",), "v_staffing": ("location_id",),
}
RAW_VIEWS = ("v_spans", "v_span_cost")


def reconcile(db: sqlite3.Connection, run_id: str, js: dict, tolerance: float = 1e-4, tolerance_raw: float = 1e-9) -> tuple[bool, list[dict]]:
    """SQL rows of every view against the JavaScript rows -> (ok, [{view, column, rows, max_abs_delta, tolerance, ok, note}])."""
    out: list[dict] = []
    ok = True
    for view, keys in RECONCILE_KEYS.items():
        js_rows = (js.get("views") or {}).get(view)
        if js_rows is None:
            continue
        sql_rows = rows(db, f"SELECT * FROM {view} WHERE run_id = ?", (run_id,))
        tol = tolerance_raw if view in RAW_VIEWS else tolerance
        if keys:
            def key(r, cols=keys):
                return tuple(r.get(c) for c in cols)
            sm = {key(r): r for r in sql_rows}
            jm = {key(r): r for r in js_rows}
            missing = sorted(set(sm) ^ set(jm), key=str)
            pairs = [(sm[k], jm[k]) for k in sm if k in jm]
        else:
            missing = [] if len(sql_rows) == len(js_rows) else [("rows", len(sql_rows), len(js_rows))]
            pairs = list(zip(sql_rows, js_rows))
        if missing:
            ok = False
            out.append({"view": view, "column": "<rows>", "rows": len(pairs), "max_abs_delta": None, "tolerance": tol, "ok": False,
                        "note": f"{len(missing)} key(s) on one side only: {missing[:3]}"})
        if not pairs:
            out.append({"view": view, "column": "<rows>", "rows": 0, "max_abs_delta": 0.0, "tolerance": tol, "ok": not missing, "note": "no rows on either side" if not missing else ""})
            continue
        shared = [c for c in sql_rows[0] if c in js_rows[0] and c != "run_id"]
        only_sql = [c for c in sql_rows[0] if c not in js_rows[0] and c != "run_id"]
        only_js = [c for c in js_rows[0] if c not in sql_rows[0]]
        for c in shared:
            mx = 0.0
            mismatch = None
            for s, j in pairs:
                a, b = s.get(c), j.get(c)
                if a is None and b is None:
                    continue
                if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
                    mx = max(mx, abs(float(a) - float(b)))
                elif a != b:
                    mismatch = (a, b)
            col_ok = mismatch is None and mx <= tol
            ok = ok and col_ok
            out.append({"view": view, "column": c, "rows": len(pairs), "max_abs_delta": mx, "tolerance": tol, "ok": col_ok,
                        "note": "" if mismatch is None else f"value mismatch {mismatch}"})
        if only_sql or only_js:
            out.append({"view": view, "column": "<columns>", "rows": len(pairs), "max_abs_delta": None, "tolerance": tol, "ok": True,
                        "note": (f"only in SQL: {only_sql}; " if only_sql else "") + (f"only in JavaScript: {only_js}" if only_js else "")})
    return ok, out


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
    ap.add_argument("command", choices=("import", "views", "summary", "query", "compare", "report", "reconcile", "replications"))
    ap.add_argument("arg", nargs="?", help="export JSON path (import, reconcile) or SQL text (query)")
    ap.add_argument("--database", help="the SQLite file (every command but reconcile, which uses memory)")
    ap.add_argument("--js", help="reconcile: the JavaScript rows written by `node tools/make_run_ledger_fixture.mjs reconcile <dir>`")
    ap.add_argument("--tolerance", type=float, default=1e-4, help="reconcile: the largest |SQL - JavaScript| allowed on a rounded column (default 1e-4)")
    ap.add_argument("--tolerance-raw", type=float, default=1e-9, help="reconcile: the same for the unrounded span views (default 1e-9)")
    ap.add_argument("--run", help="run id (defaults to the only / latest imported run)")
    ap.add_argument("--out", help="write the summary / compare JSON or the report Markdown here")
    ap.add_argument("--runs", nargs=2, metavar=("RUN_A", "RUN_B"), help="compare: the two run ids (deltas are B - A)")
    ap.add_argument("--all", action="store_true", help="views: also print the detail views (WIP by tick, spans, span cost, cost by unit)")
    a = ap.parse_args(argv)
    if a.command == "reconcile":
        if not a.arg or not a.js:
            ap.error("reconcile needs the export JSON path and --js <rows.json>")
        db = connect(":memory:")
        initialize(db)
        rid = import_ledger(db, json.loads(Path(a.arg).read_text(encoding="utf-8")))
        js = json.loads(Path(a.js).read_text(encoding="utf-8"))
        if js.get("run") and js["run"] != rid:
            print(f"the JavaScript rows are for {js['run']}, the export is {rid}", file=sys.stderr)
            return 1
        ok, table = reconcile(db, rid, js, a.tolerance, a.tolerance_raw)
        print(f"sqlite {sqlite3.sqlite_version} - {rid}")
        print(render([{k: (f"{v:.3e}" if isinstance(v, float) and k == "max_abs_delta" else v) for k, v in r.items()} for r in table]))
        worst = max((r["max_abs_delta"] for r in table if r["max_abs_delta"] is not None), default=0.0)
        cols = sum(1 for r in table if not r["column"].startswith("<"))
        print(f"RECONCILE: {'OK' if ok else 'FAIL'} - {cols} columns over {len({r['view'] for r in table})} views, largest |SQL - JavaScript| {worst:.3e}")
        return 0 if ok else 1
    if not a.database:
        ap.error("--database is required")
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
    if a.command == "replications":
        for name in REPLICATION_VIEWS:
            print(f"== {name} ==")
            print(render(rows(db, f"SELECT * FROM {name} ORDER BY 1, 2, 3, 4, 5")))
            print()
        return 0
    if a.command == "compare":
        if not a.runs:
            ap.error("compare needs --runs RUN_A RUN_B")
        c = compare(db, a.runs[0], a.runs[1])
        if a.out:
            Path(a.out).write_text(json.dumps(c, indent=1) + "\n", encoding="utf-8")
            print(f"compare written to {a.out}")
        else:
            for name in COMPARE_VIEWS:
                print(f"== {name} (B - A) ==")
                print(render(c[name]))
                print()
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
    if a.command == "report":
        md = report(db, a.runs[0] if a.runs else run_id, (a.runs[0], a.runs[1]) if a.runs else None)
        if a.out:
            with open(a.out, "w", encoding="utf-8", newline="\n") as f:
                f.write(md)
            print(f"report written to {a.out}")
        else:
            print(md)
        return 0
    if a.command == "views":
        for name in PLANNER_VIEWS + INVARIANT_VIEWS + (DETAIL_VIEWS if a.all else ()):
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

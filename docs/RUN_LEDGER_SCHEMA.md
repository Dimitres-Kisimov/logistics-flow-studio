# The run ledger — schema, identities, SQL views

*The contract between the simulator, the SQLite tool and the viewer. Written 2026-09-22 for v3.32–v3.45.*

## 1. One stream, three consumers

The material-flow simulation is observed by `ledger.js` after every tick. It writes an append-only record (never touching the simulation — a run is byte-identical with or without it) that is exported as JSON with schema id **`factory-run-ledger/v1`**. That file is:

1. shown live in the planner's flow card (run id, per-type counts, a unit trace);
2. imported by `tools/run_ledger.py` into SQLite, where the planner's questions are **views**;
3. drawn by `run-ledger.html` from start to finish, by the same definitions.

`RunLedger.views()` in the viewer and the SQL views are proved equal on a hand-built ledger with hand-computed answers and on the recorded fixture (`verify_run_ledger_view.js`, `test/test_run_ledger.py`). Since v3.39 the SQL the viewer shows under each table is **generated from this tool** (`tools/export_viewer_sql.py` → `run-ledger-sql.js`): a test fails when the file is stale and another proves every shown text runs in SQLite as shown. The viewer computes everything once per file (`RunLedger.model`), opens with the run at a glance and its data-quality flags, and tests itself at `run-ledger.html?selftest=1`.

## 2. Identities

| Id | Shape | Meaning |
|---|---|---|
| Run | `RUN-<scenario>-s<seed>-h<hash8>` | `hash8` is FNV-1a over the layout's elements, its size, the seed and the order mix — and, since v3.44, the digest of the order pool when one was loaded — so the same inputs give the same id on every machine |
| Order | `ORD-<run>-<n:6>` | the synthetic stream: one one-line order per handling unit, numbered in spawn order; with an imported pool (v3.44): `n` is the order's number in the file (a re-released order counts on: cycle × orders + n) |
| Handling unit | `HU-<order>-<k>` | `k` is the line's number within its order when a pool was loaded (v3.44); 1 for the synthetic stream (one unit per line) |
| Event | `EVT-<hu>-<version>` | `version` counts the unit's events from 0, consecutive |
| SSCC | 18 digits | GS1 logistic-unit number: extension digit (3 = pallet unit, 0 = parcel; the app's convention), company prefix 4012345 (GS1's documentation prefix, **not registered**), serial, mod-10 check |
| GTIN-13 / GTIN-14 | 13 / 14 digits | the each / the case; GTIN-14 = indicator 1 + the GTIN-13 body + new check digit |
| Location | an element id, or `zone:<stage>` | the equipment the router bound the operation to; a zone only when the legacy spine fell back to a zone centre — never a guess |

Ids never encode a fact that can change: archetype, outcome and location are attributes.

## 3. The export

```
{
  "schema": "factory-run-ledger/v1",
  "run":       { id, scenario, seed, hash, mix, profile, ticks_per_hour, minutes_per_tick, ticks, honesty },
  "profile":   { id, label, box, pallet, eaches_per_case, case_kg, max_stack_mm, eaches_per_parcel,
                 board: { ectKNm, caliperMm, note } | { evaluated: false, note } },   // board: v3.38, synthetic
  "locations": [ { id, type, category, service_ticks } ],   // the floor's equipment; service_ticks = 1 / the station's service rate (v3.35; unrounded since v3.43: exactly 50 at the simulator's floor rate, the true service time on a floor with declared capacities), null off a station
  "hus":       [ { id, order_id, seq, archetype, outcome, route_id, sscc, gtin13, gtin14, pallet, box,
                   eaches_per_case, cases_per_pallet, received_eaches, spawned_tick, retired_tick,
                   final_kind, final: { pallets, cases, eaches, parcels, form, retained, scrapped } } ],
  "events":    [ { id, hu_id, version, kind, op, anchor, location, tick, minute, stage, form,
                   pallets, cases, eaches, parcels, retained, scrapped } ],
  "rates":     { source, currency, labour_per_hour, energy_price_per_kwh, hours_per_year, co2_per_kwh,   // v3.35, optional
                 holding_per_unit_hour,                                                             // v3.40: EUR per unit-hour waiting, 0 = not charged
                 transport: { class, labour }, equipment: { <class>: { capex, amort_years, power_kw, labour } },
                 classes: { <element type>: { class, labour } }, honesty }
}
```

**Event kinds.** `created` (the unit exists; its first operation is done at spawn) · `queued` (reached a station, waiting — quantities not yet changed) · `served` (the station served it — the operation's quantities apply) · `passed` (an operation without a station: dock, wrapper, staging, depalletiser…) · `delivered` / `restocked` / `scrapped` (terminal, by the route's final operation).

**Your own orders (v3.44).** When the flow was fed an order pool (`flowsim` `opts.pool`, the planner's imported file), `run.dataset = { source, orders, lines, skus }` records its provenance and every unit carries `order_ref` (the file's order id), `sku` and `line_qty`; the line's quantity is the entering quantity of a returns / vas / export-fragile line and the pick of a case-pick (cases rounded up) or piece-pick line, while a pallet archetype moves a whole pallet whatever the line says. Without a pool none of these keys exist and the export is byte-identical to earlier versions.

**Adaptive staffing (v3.45).** When the flow ran with the queue-staffing what-if (`flowsim` `opts.policy`, the planner's *Staffing → Adaptive*), `run.policy = { kind, threshold, maxServers, cooldownTicks, honesty }` and `staffing = [ { tick, location_id, servers } ]` record it - one entry per change at a bench (a second worker joins when the queue reaches the threshold, leaves after the cool-down with an empty queue). The policy joins the run id. The cost model is unchanged: a waiting span is still charged one worker's `service_ticks`; the second worker's idle time is not charged. Without a policy neither key exists.

**Time.** `tick` is the simulation tick; `minute = tick × 60 / ticks_per_hour` (unrounded since v3.43; an integer at 60 ticks per hour). There is no wall clock anywhere in the file.

**Spans and costs (v3.35).** A *span* is the time between two consecutive events of one unit: `waiting` when the first is `queued` (queue + service, inseparable in the simulation), `moving` otherwise; the last event of a live unit opens no span, and the spans of a retired unit add up to `retired_tick − spawned_tick`. A waiting span is charged the station's `service_ticks` (1 / its service rate) whatever the unit waited — queue time costs no labour; since v3.40 the *elapsed* wait is charged a holding cost per unit-hour when `rates.holding_per_unit_hour` is set (default 0); a moving span is charged in full at `rates.transport` (the first of AGV, forklift, conveyor present on the floor; none = free). Per span: `hours = charged_ticks × minutes_per_tick / 60`; `held_hours = ticks × minutes_per_tick / 60` for a waiting span; `labour = hours × labour × labour_per_hour`; `equipment = hours × capex / amort_years / hours_per_year`; `energy = hours × power_kw × energy_price_per_kwh`; `holding = held_hours × holding_per_unit_hour`. Per order type the cost is given per unit, per **received** each (every unit) and per **delivered** each (partial while units are in flight). Manned classes: racking (a picker at the face), workstation, forklift; `staging` has no class and is manned. The rates are the planner's Analyze-panel rates (illustrative teaching values); `ledger.js` `costs(exp)` and the SQL views below are the same arithmetic.

**Flow links (v3.36).** For each unit, consecutive *non-queued* events whose operation changes make one link from the first operation to the second (a queued event is a wait, not a move; the terminal operation's two events collapse). `v_flow_links` counts, per pair of operations, the units, the retired units and the eaches that left the from-operation. Over the retired units every interior operation conserves (in = out); over all units in ≥ out; and for every operation, units entering it = units recorded there − units that started there. `ledger.js` `flowLinks(exp)` is the same definition; `sankeyFromLedger` turns it into the model `analytics.js` draws as a layered Sankey.

**Quantities.** At every event `eaches + retained + scrapped = received_eaches` of its unit. A pallet unit arrives as `cases_per_pallet × eaches_per_case` eaches; a case pick carries the line's cases and books the rest as `retained` (still in stock); a piece pick does the same in eaches; `pack` books `parcels = ⌈eaches / eaches_per_parcel⌉`; `restock` moves everything to `retained`; `scrap` to `scrapped`.

## 4. The SQL

`python tools/run_ledger.py import <file> --database run.sqlite` creates the tables `run`, `packaging_profile`, `pallet_type`, `location`, `hu`, `handling_event` (with `UNIQUE(hu_id, version)`, a `CHECK` on the event kinds and on `retired_tick ≥ spawned_tick`), the rate tables `rate`, `equipment_rate`, `location_class` (v3.35) and the views below. Re-importing a run replaces it.

**Planner views** (`views` prints them; `summary --out x.json` writes them):

| View | Answers |
|---|---|
| `v_run_summary` | units, events, delivered units / eaches / pallets / parcels |
| `v_cycle_time_by_type` | per archetype: units, retired, average / min / max cycle in ticks and minutes |
| `v_touches_by_type` | events per unit and served events per unit, per archetype |
| `v_station_wait` | per bench and operation: waits, average and maximum wait, still waiting |
| `v_wip_by_tick` | in flight and retired at every tick (recursive CTE over the run's ticks) |
| `v_quantities_by_op` | per operation and event kind: events and the pallets / cases / eaches / parcels / retained / scrapped carried |
| `v_dispatch` | delivered units, pallets, cases, eaches, parcels, trailer slots and trailers (⌈pallets / slots⌉) |
| `v_cost_by_type` | per archetype: units, retired, eaches received and delivered, charged hours, labour / equipment / energy / holding / total €, € per unit, per received each, per delivered each (v3.35, v3.40) |
| `v_cost_by_location` | per station: waiting spans, ticks, charged ticks, hours and their € incl. holding — plus one `transport` row for every moving span (v3.35, v3.40) |
| `v_flow_links` | per pair of operations: units that moved from the one to the next, retired units, eaches that left (v3.36) |
| `v_staffing` | per bench the what-if changed: changes, most workers, first change tick, ticks with more than one worker (each change holds until the next at that bench or the end of the run; v3.45, a planner view, empty without a policy); `v_run_summary` carries `policy` |
| `v_dispatch_by_order` | per order: lines, delivered lines, eaches in and out, cases, parcels, cases per pallet and `pallets_needed` = delivered cases over cases per pallet, rounded up — consolidation modelled at dispatch, not in the flow (v3.44; a detail view); `v_run_summary` carries `dataset_source / dataset_orders / dataset_lines` |

**Cost views** (v3.35; empty when the run carries no `rates`): `v_spans` pairs each event with the next one of the same unit (`LEAD` over `version`) and names the state; `v_span_cost` charges each span by the rule in §3; `v_cost_by_hu` sums per unit. Rounding happens only at the aggregates (4 dp). Since v3.43 both sides sum with compensated arithmetic — SQLite's `SUM()` has used Kahan-Babuška-Neumaier since 3.43.0 and `ledger.js` sums the same way — so the rounded aggregates agree to at most one step in the fourth decimal. `python tools/run_ledger.py reconcile <export.json> --js <rows.json>` measures the drift column by column over 13 views (the rows come from `node tools/make_run_ledger_fixture.mjs reconcile <dir>`) and fails above 1e-4 (1e-9 on the unrounded span views); measured on the three fixtures: 5.6e-17 (A, B) and 1.1e-13 (C) over 111 columns. The tests use the same tolerance when SQLite is 3.44 or newer.

**Invariant views** — each must return **zero rows**; the tests corrupt one value and watch each fire:

| View | Violation it catches |
|---|---|
| `v_conservation_violations` | an event whose eaches + retained + scrapped ≠ the unit's received eaches |
| `v_cross_dock_violations` | a cross-dock unit at a storage-category location or in a storage operation |
| `v_version_gaps` | a unit whose versions do not run 0 … n−1 |
| `v_terminal_violations` | a retired unit without a terminal kind, or a live unit with one |

**Compare views** (v3.37): `v_compare_summary`, `v_compare_cycle`, `v_compare_touches`, `v_compare_wait`, `v_compare_dispatch`, `v_compare_cost` — one row per ordered pair of runs in the database and key, deltas B − A, NULL whenever a side lacks the key. `compare --database run.sqlite --runs A B [--out compare.json]` prints or writes them for one pair; the viewer's `RunLedger.compare(A, B)` is the same pairing and the tests equate the two on a hand pair with hand-computed deltas and on the recorded pair (`run-ledger.json` / `run-ledger-b.json`, the same floor and seed with a cross-dock-heavy mix).

**Detail views** (`views --all`): `v_wip_by_tick`, `v_spans`, `v_span_cost`, `v_cost_by_hu`. Views are dropped and recreated on every open, so a database created by an older version always runs the current text.

**The report** (v3.41): `report --database run.sqlite [--run R] [--runs A B] [--out report.md]` writes one run as deterministic Markdown — the header (id, scenario, seed, mix, profile, ticks), the at-a-glance row with the data-quality flags, every planner view as a table, the cost detail with the rates, the invariants with the line `Invariant violations: 0`, the six compare tables when `--runs` is given, and the honesty text. No timestamp, so the same database gives the same text; CI imports both recorded fixtures and writes one. The committed example is [docs/examples/run-report.md](examples/run-report.md) (A against B), with a test that fails when it is stale.

Ad-hoc SQL: `query "SELECT …"` accepts one `SELECT` / `WITH` statement and at most 500 rows.

## 7. The viewer, section by section

`run-ledger.html` is one report over one export (v3.39). Each section, what it shows, and what proves it:

| Section | Shows | Definition | Proved by |
|---|---|---|---|
| The run at a glance | identity, mix, totals, cost, the four invariants, the data-quality flags (no rates; stations at the floor rate; units in flight; no holding cost) | `RunLedger.glance`, `v_run_summary` | `verify_run_ledger_view.js` §5, the viewer self-test |
| Start to finish | the ribbon per order type; the flow as recorded (layered Sankey, units / retired only / eaches) | `RunLedger.ribbon`, `v_flow_links`, `sankeyLayoutLayered` | `verify_run_ledger_view.js`, `verify_ledger_flow.js` |
| What the planner asks | cycle time, touches, waiting at each bench (with derived minutes), WIP, quantities per operation | `v_cycle_time_by_type` … `v_quantities_by_op` | `verify_run_ledger_view.js`, `test_run_ledger.py` |
| What a handling unit costs | spans charged at the recorded rates: by order type (per unit, per received each, per delivered each), by location, the rates in the file | `v_spans`, `v_span_cost`, `v_cost_by_type`, `v_cost_by_location` | `verify_cost_ledger.js`, `test_run_ledger.py` |
| Dispatch manifest | delivered units, pallets, parcels, trailers slot by slot | `v_dispatch` | `verify_run_ledger_view.js` |
| Packaging | the hierarchy with the drawn pattern and the strength verdict; the ranked pallets with the what-if; a case of your own | `pack.js` `tiHi` / `optimizeProfile` / `fourBlock` / `safeLayers`, `RunLedger.whatIf` / `yourCase` | `verify_pack.js`, `verify_stacking.js` |
| Trace one unit | one unit's events, timeline (ticks and minutes) and cost so far | `RunLedger.trace`, `v_cost_by_hu` | `verify_run_ledger_view.js`, `verify_cost_ledger.js` |
| Compare two runs | every table paired key by key with deltas B − A | `RunLedger.compare`, `v_compare_*` | `verify_run_compare.js`, `test_run_ledger.py` |
| The invariants | the four views that must return zero rows | `v_conservation_violations` … `v_terminal_violations` | `test_run_ledger.py` (deliberate corruption) |
| Appendix | how to read the page; the reproduce commands filled in for the loaded run | — | the viewer self-test |

Every table carries a CSV button (raw values) and the SQL SQLite runs for it (generated, see §4); minutes beside ticks are display-only derived columns; *Print report* expands every SQL. `?example=a|b|c` loads an example (C is the library floor *ecommerce-multichannel-fc* recorded at declared capacities, v3.43); the planner hands a run over through *Open in the run-ledger viewer*. `run-ledger.html?selftest=1` drives the real buttons and reports `WT-SELFTEST: PASS n/n`.

## 5. What the ledger is not

Synthetic events from a synthetic teaching simulation — not telemetry, not a WMS, not a measurement of any site. The quantities are the packaging profile's synthetic teaching values ([PACKAGING_OPTIMISATION.md](PACKAGING_OPTIMISATION.md) §2). The identities are deterministic functions of the inputs, which is what makes them useful and also what makes them meaningless outside the simulation.

## 6. Reproduce

```sh
node tools/make_run_ledger_fixture.mjs       # regenerates test/fixtures/run-ledger.json, -b, -c and -d byte for byte ([a|b|c|d|all]; a and b are built before wms.js loads; d reads docs/examples through wmsdata.js)
python tools/make_sample_data.py --check     # the synthetic sample SKU master and order file are what the generator writes (v3.44)
node verify_ledger.js                        # the recorder: identities, exact route walks, conservation, byte-identical sim
python -m pytest test/test_run_ledger.py -q  # the SQL: hand-built ledger, corruption, SQL == JavaScript stats
node verify_run_ledger_view.js               # the viewer's model against the same hand ledger and fixture
node verify_cost_ledger.js                   # spans and money by hand; SQL == JavaScript on the fixture (v3.35)
node verify_ledger_flow.js                   # flow links, conservation, the layered Sankey geometry (v3.36)
node verify_run_compare.js                   # two runs paired key by key, deltas B - A (v3.37)
python tools/export_viewer_sql.py --check    # the SQL the viewer shows is the SQL in this tool (v3.39)
node verify_precision.js                     # A and B byte-identical under the compensated sums; C at declared capacities (v3.43)
node tools/make_run_ledger_fixture.mjs reconcile work/rec && python tools/run_ledger.py reconcile test/fixtures/run-ledger-c.json --js work/rec/run-ledger-c.reconcile.json   # SQLite against the JavaScript rows, column by column (v3.43)
python tools/run_ledger.py import test/fixtures/run-ledger.json --database work/run.sqlite && python tools/run_ledger.py import test/fixtures/run-ledger-b.json --database work/run.sqlite
python tools/run_ledger.py report --database work/run.sqlite --runs RUN-hand-built-s31-hc28a7688 RUN-hand-built-s31-hd35e45d4 --out docs/examples/run-report.md   # the committed example (v3.41)
```

The viewer's own self-test: serve the folder and open `run-ledger.html?selftest=1`; it drives the real buttons and prints `WT-SELFTEST: PASS n/n`.

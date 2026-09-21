# The run ledger — schema, identities, SQL views

*The contract between the simulator, the SQLite tool and the viewer. Written 2026-09-22 for v3.32–v3.34.*

## 1. One stream, three consumers

The material-flow simulation is observed by `ledger.js` after every tick. It writes an append-only record (never touching the simulation — a run is byte-identical with or without it) that is exported as JSON with schema id **`factory-run-ledger/v1`**. That file is:

1. shown live in the planner's flow card (run id, per-type counts, a unit trace);
2. imported by `tools/run_ledger.py` into SQLite, where the planner's questions are **views**;
3. drawn by `run-ledger.html` from start to finish, by the same definitions.

`RunLedger.views()` in the viewer and the SQL views are proved equal on a hand-built ledger with hand-computed answers and on the recorded fixture (`verify_run_ledger_view.js`, `test/test_run_ledger.py`).

## 2. Identities

| Id | Shape | Meaning |
|---|---|---|
| Run | `RUN-<scenario>-s<seed>-h<hash8>` | `hash8` is FNV-1a over the layout's elements, its size, the seed and the order mix, so the same inputs give the same id on every machine |
| Order | `ORD-<run>-<n:6>` | one order line per handling unit, numbered in spawn order |
| Handling unit | `HU-<order>-<k>` | `k` is 1 today (one unit per line) |
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
  "profile":   { id, label, box, pallet, eaches_per_case, case_kg, max_stack_mm, eaches_per_parcel },
  "locations": [ { id, type, category } ],            // the floor's equipment, so SQL can classify a location
  "hus":       [ { id, order_id, seq, archetype, outcome, route_id, sscc, gtin13, gtin14, pallet, box,
                   eaches_per_case, cases_per_pallet, received_eaches, spawned_tick, retired_tick,
                   final_kind, final: { pallets, cases, eaches, parcels, form, retained, scrapped } } ],
  "events":    [ { id, hu_id, version, kind, op, anchor, location, tick, minute, stage, form,
                   pallets, cases, eaches, parcels, retained, scrapped } ]
}
```

**Event kinds.** `created` (the unit exists; its first operation is done at spawn) · `queued` (reached a station, waiting — quantities not yet changed) · `served` (the station served it — the operation's quantities apply) · `passed` (an operation without a station: dock, wrapper, staging, depalletiser…) · `delivered` / `restocked` / `scrapped` (terminal, by the route's final operation).

**Time.** `tick` is the simulation tick; `minute = tick × 60 / ticks_per_hour`. There is no wall clock anywhere in the file.

**Quantities.** At every event `eaches + retained + scrapped = received_eaches` of its unit. A pallet unit arrives as `cases_per_pallet × eaches_per_case` eaches; a case pick carries the line's cases and books the rest as `retained` (still in stock); a piece pick does the same in eaches; `pack` books `parcels = ⌈eaches / eaches_per_parcel⌉`; `restock` moves everything to `retained`; `scrap` to `scrapped`.

## 4. The SQL

`python tools/run_ledger.py import <file> --database run.sqlite` creates the tables `run`, `packaging_profile`, `pallet_type`, `location`, `hu`, `handling_event` (with `UNIQUE(hu_id, version)`, a `CHECK` on the event kinds and on `retired_tick ≥ spawned_tick`) and the views below. Re-importing a run replaces it.

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

**Invariant views** — each must return **zero rows**; the tests corrupt one value and watch each fire:

| View | Violation it catches |
|---|---|
| `v_conservation_violations` | an event whose eaches + retained + scrapped ≠ the unit's received eaches |
| `v_cross_dock_violations` | a cross-dock unit at a storage-category location or in a storage operation |
| `v_version_gaps` | a unit whose versions do not run 0 … n−1 |
| `v_terminal_violations` | a retired unit without a terminal kind, or a live unit with one |

Ad-hoc SQL: `query "SELECT …"` accepts one `SELECT` / `WITH` statement and at most 500 rows.

## 5. What the ledger is not

Synthetic events from a synthetic teaching simulation — not telemetry, not a WMS, not a measurement of any site. The quantities are the packaging profile's synthetic teaching values ([PACKAGING_OPTIMISATION.md](PACKAGING_OPTIMISATION.md) §2). The identities are deterministic functions of the inputs, which is what makes them useful and also what makes them meaningless outside the simulation.

## 6. Reproduce

```sh
node tools/make_run_ledger_fixture.mjs       # regenerates test/fixtures/run-ledger.json byte for byte
node verify_ledger.js                        # the recorder: identities, exact route walks, conservation, byte-identical sim
python -m pytest test/test_run_ledger.py -q  # the SQL: hand-built ledger, corruption, SQL == JavaScript stats
node verify_run_ledger_view.js               # the viewer's model against the same hand ledger and fixture
```

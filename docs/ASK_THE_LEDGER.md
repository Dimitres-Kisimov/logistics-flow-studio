# Ask the ledger: the deterministic layer (v3.60)

*Written 2026-09-23 for v3.60. A question box over the recorded run - in the Simulate drawer (the live run) and in the run-ledger viewer (a loaded export) - that answers from the SQL views and the knowledge base with a rule-based matcher. Offline, deterministic, no language model.*

## What it is

`ask.js` (`WT.ask.answer(question, { exp, kb })`) matches a question against a **fixed catalogue** (English, with German synonyms) and answers from the run's own rows. Every answer carries:

- `text` - the sentence a planner reads;
- `read` - the SQL view(s) it read and the rows it used (the same rows the viewer's tables and `tools/run_ledger.py` show);
- `sources` - the knowledge-base entries behind any threshold (a teaching value with its citation, or `measured on <source>, n = …` once a site profile is loaded) and the recorded rates where money is involved;
- `unanswered: true` when the question is outside the catalogue - then the catalogue comes back, never a guess.

The aggregates it computes itself (station wait, cycle time, the run summary, the invariants) are twins of the viewer's `computeViews` and of the SQL views, pinned equal in `verify_ask.js`; costs, quality, service and the trailer log come from `ledger.js`, the tower's audit from `control.js`.

## The catalogue

| Question (English, German) | Reads | Threshold / source it names |
|---|---|---|
| Which step waits longest? · Wo warten die Einheiten am längsten? | `v_station_wait` | - |
| Why did OTIF fall? · Warum ist OTIF gesunken? | `v_otif`, `v_inbound` | `delivery.otif.target`, `control.inbound.lateTicks` |
| What did the control tower propose? · Was hat der Leitstand vorgeschlagen? | `v_control`, the audit | the thresholds of the rules that fired |
| What does a mis-pick cost? · Was kostet ein Fehlgriff? | `v_quality_by_step` (pick rows), the pick station's service time, the recorded rates | `hf.error.mis-pick`, `rates.labour_per_hour` |
| What is the first pass yield? | `v_quality_by_step` | `hf.error.*` |
| Where do the error shares come from? · Woher kommen die Fehleranteile? | the knowledge base (human-factors) | `hf.error.*`, `hf.psf.*` |
| Were the trailers late? · Kamen die Lkw zu spät? | `v_inbound` | `control.inbound.lateTicks` |
| How long does an order take? · Wie lange dauert ein Auftrag? | `v_cycle_time_by_type` | - |
| What does the run cost? · Was kostet der Lauf? | `v_cost_by_type` | `rates.labour_per_hour` |
| How many units were delivered? | `v_run_summary` | - |
| Is the run consistent? · Ist der Lauf konsistent? | the invariant views | - |
| What can I ask? · Was kann ich fragen? | the catalogue | - |

Matching order matters and is fixed (help, mis-pick cost, error sources, tower, trailers, OTIF, wait, quality, cycle, cost, summary, invariants): "what does a mis-pick cost" reaches the mis-pick answer before the cost answer; "where do the error shares come from" reaches the sources before the wait answer.

## Hand-checked answers on fixture A (`test/fixtures/run-ledger.json`, the hand floor, seed 31, 300 ticks)

| Question | The answer's numbers |
|---|---|
| Which step waits longest? | `stg` for `putaway`: 122.4 ticks on average over 23 waits, the longest 206, 18 still waiting; next `stg` for `replen` at 50 over 2 |
| How many units were delivered? | 39 units, 157 events, 8 delivered - 2461 eaches, 6 pallets, 3 parcels |
| How long does an order take? | case-pick 259 over 1 of 8; cross-dock 107 over 3 of 5; returns 116 over 3 of 4 (min 80, max 134); … |
| Why did OTIF fall? | not measured: no carrier windows in this run; the target 0.95 named with its source ("a commonly quoted OTIF target … not a standard") |
| What did the control tower propose? | no decision recorded |
| What is the first pass yield? | 1 at every operation (no error what-if ran) |
| What does a mis-pick cost? | the hand floor's pick face (`face`, carton-flow) serves in 50 ticks with labour at the recorded 35 EUR/h, so the redo costs 50 × 1/60 × 35 = 29.17 EUR in station labour per reworked unit; no error was realised in this run; the teaching share 0.02 named with its HEART anchor |
| Is the run consistent? | every one of the five invariant views returns 0 rows |

## What it is not

Not a model, not a search over free text, not an explanation of causes it cannot see: "why did OTIF fall" reasons only from the two shares the ledger has (units that left the dock on time versus orders that arrived on time) and says which side the misses fall on. A question the catalogue does not cover is answered with the catalogue. The next step, an optional model that rewrites these answers into prose without inventing a number, is a separate release and off by default.

## Reproduce

```sh
node verify_ask.js                         # the catalogue, the hand answers on fixture A, a windowed run with OTIF and a decided proposal, the twins, purity, wiring
python tools/gate.py --check-readme         # both self-tests: ask-the-ledger-deterministic (app), ask-section-answers-on-example-a (viewer)
```

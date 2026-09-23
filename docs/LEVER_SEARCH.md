# Search over levers, and the tower's fifth rule (v3.62)

*Written 2026-09-23 for v3.62. The what-ifs of v3.45–v3.55 are levers a person sets one at a time - staffing, the error shares, the dock and carrier windows. This page is the tool that tries their combinations across seeds and ranks them, and the control-tower rule that proposes the best-ranked combination with the search table as its evidence.*

## The tool

```sh
node tools/search_levers.mjs hand --seeds 1-3 --ticks 600 --out work/search
node tools/search_levers.mjs ecommerce-multichannel-fc --seeds 1-5 --ticks 600 --out work/search --staffing declared,adaptive --outbound-period 240,120,60
```

The grid is the cartesian product of the lever values given (defaults: staffing `declared, adaptive` × carrier period `240, 120`; dock period `120`; error shares `declared`). Every combination runs once per seed with the delivery what-if on, exactly as the app's pickers and knowledge base would set it (door open 30 ticks, the SCMS Truck lateness shape at 60 ticks per day, transit 120 + the shape, promised lead 480), and each combination carries its levers in the tower's own format (`kb`: the staffing picker, `delivery.inbound.periodTicks`, `delivery.outbound.periodTicks`).

Per combination, over the seeds: **OTIF** (`v_otif`'s share over the delivered orders; a seed without a delivered order is missing), the run's **cost** at the default rates (`v_cost_by_type`'s total) and the **delivered orders** - each as mean, sample standard deviation and the Student-t 95 % half-width, the same arithmetic as the viewer's replications (`run-ledger.js` `T975`). Ranked by OTIF mean descending, then cost mean ascending, then id. `search.json` holds the combinations, the ranking and the best; `search.md` the table; `run-<combination>-<seed>.json` every export, so any number can be recomputed. Deterministic: the same arguments write the same bytes.

## The fifth rule: lever-search

The control tower (v3.56) gains `lever-search`. It reads a search table the person loads into the Simulate drawer (*Control tower → Import lever search*), never a live feed. At the first evaluation of a run it compares the run's own combination (its staffing policy, dock period, carrier period, error what-if) with the table's best and proposes the best's levers - as one **combination lever** (the levers that differ, applied together, revertible together) - when three things hold:

1. the table was searched on this scenario (the same floor id) and the same tick length;
2. the run's combination is not already the best;
3. the best's OTIF mean exceeds the run's combination's OTIF mean by more than `control.search.minGainHalfWidths` × the wider of the two half-widths (default 1: the gain must clear the confidence interval; a ranking with overlapping half-widths is not a ranking). A combination the table did not search is compared to nothing: the rule proposes the best and says so.

The evidence is the ranked table (id, n, OTIF mean ± half-width, cost mean ± half-width); the expected effect quotes the table's estimate and says the day re-runs. A person accepts, declines or snoozes as for every rule; nothing acts on its own.

## What it is not

Not an optimiser over a plant: a grid over a synthetic teaching simulation with teaching rates and shares, one run per seed, no warm-up removal, no validation against a real site. Not a guarantee: the half-widths are the honesty of the estimate, and the rule refuses a gain inside them. The tool reads the app's defaults, not a browser's knowledge base - once a site profile (v3.59) is loaded, the drawer's runs use the plant's own rates, and a search that should too must be re-run with them (a follow-up).

## Hand values (`verify_search.js`)

On the hand floor with seeds 1 and 2 over 400 ticks, staffing `declared, adaptive` × carrier period `240, 120`: four combinations, eight runs. The harness recomputes every combination's OTIF, cost and delivered orders from the eight exports it wrote (`WT.ledger.serviceOf`, `WT.ledger.costs`), the mean, the sample standard deviation and the half-width with t = 12.706 (n = 2), the ranking by the stated order, and pins the tool's numbers equal; the cost statistics also equal the viewer's own replication rows for the same runs. The rule is pinned on a hand table: it proposes the best at the first evaluation when the run is at the worst combination with a clear gain, stays silent when the run is already at the best, when the gain is inside the half-widths, and when the table's scenario or ticks differ.

## Reproduce

```sh
node verify_search.js
node tools/search_levers.mjs hand --seeds 1-2 --ticks 400 --out work/search --staffing declared,adaptive --outbound-period 240,120
```

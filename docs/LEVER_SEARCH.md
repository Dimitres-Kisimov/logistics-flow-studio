# Search over levers, and the tower's fifth rule (v3.62; the plant's own rates v3.63)

*Written 2026-09-23 for v3.62. The what-ifs of v3.45–v3.55 are levers a person sets one at a time - staffing, the error shares, the dock and carrier windows. This page is the tool that tries their combinations across seeds and ranks them, and the control-tower rule that proposes the best-ranked combination with the search table as its evidence.*

## The tool

```sh
node tools/search_levers.mjs hand --seeds 1-3 --ticks 600 --out work/search
node tools/search_levers.mjs hand --seeds 1-3 --ticks 600 --out work/search --profile site-profile.json   # v3.63: the plant's own rates
node tools/search_levers.mjs ecommerce-multichannel-fc --seeds 1-5 --ticks 600 --out work/search --staffing declared,adaptive --outbound-period 240,120,60
```

The grid is the cartesian product of the lever values given (defaults: staffing `declared, adaptive` × carrier period `240, 120`; dock period `120`; error shares `declared`). Every combination runs once per seed with the delivery what-if on, exactly as the app's pickers and knowledge base would set it (door open 30 ticks, the SCMS Truck lateness shape at 60 ticks per day - or the plant's own, see below - transit 120 + the shape, promised lead 480), and each combination carries its levers in the tower's own format (`kb`: the staffing picker, `delivery.inbound.periodTicks`, `delivery.outbound.periodTicks`).

Per combination, over the seeds: **OTIF** (`v_otif`'s share over the delivered orders; a seed without a delivered order is missing), the run's **cost** at the default rates (`v_cost_by_type`'s total) and the **delivered orders** - each as mean, sample standard deviation and the Student-t 95 % half-width, the same arithmetic as the viewer's replications (`run-ledger.js` `T975`). Ranked by OTIF mean descending, then cost mean ascending, then id - after the thin-sample guard below has moved any combination that delivered too little to the end. `search.json` holds the combinations, the ranking and the best; `search.md` the table; `run-<combination>-<seed>.json` every export, so any number can be recomputed. Deterministic: the same arguments write the same bytes.

## The rates it searches under (v3.63)

Without `--profile` the grid runs at the app's **teaching values**: the HEART-anchored error shares and the USAID SCMS Truck lateness shape at 60 ticks per day. With a site profile (`tools/fit_rates.py`, [SITE_PROFILE.md](SITE_PROFILE.md)) it runs at the **plant's own**: the fitted error shares (a kind the profile did not fit keeps its teaching default) and, when `delivery.site.n > 0`, the site's own lateness quantiles in ticks - minutes - instead of the dataset shape. `search.json` records the rates under `rates` (the site's name, the tool and the document that fitted it, the effective shares, the lateness shape and list) and `search.md` names them in a line under the title.

This is not cosmetic. On the hand floor with two seeds over 400 ticks the same grid answers differently: at teaching rates the best combination delivers **9 orders at OTIF 0.7778**, at the plant's own rates **11 orders at 0.9091** - the dataset's lateness is international pharmaceutical lanes in days, the plant's is its own trailers in minutes, and the dock gate that follows from them is a different gate. A search is only as relevant as the rates it ran at, which is why the tower refuses a table measured under other rates than the run's (below).

**A thin sample cannot win (v3.63).** A combination whose mean delivered orders is below `--min-delivered` (default 5) is marked `thin` and ranked after every combination that is not. The site-profile search above found why: one combination reached OTIF **1.0 over 1.5 delivered orders** and outranked **0.9091 over 11** until the guard demoted it. An OTIF over almost nothing is not a better day, and the half-widths alone do not say so. `--min-delivered 0` turns the guard off and the thin combination takes first place again.

## The fifth rule: lever-search

The control tower (v3.56) gains `lever-search`. It reads a search table the person loads into the Simulate drawer (*Control tower → Import lever search*), never a live feed. At the first evaluation of a run it compares the run's own combination (its staffing policy, dock period, carrier period, error what-if) with the table's best and proposes the best's levers - as one **combination lever** (the levers that differ, applied together, revertible together) - when three things hold:

1. the table was searched on this scenario (the same floor id) and the same tick length;
2. the run's combination is not already the best;
3. the best's OTIF mean exceeds the run's combination's OTIF mean by more than `control.search.minGainHalfWidths` × the wider of the two half-widths (default 1: the gain must clear the confidence interval; a ranking with overlapping half-widths is not a ranking). A combination the table did not search is compared to nothing: the rule proposes the best and says so.

The evidence is the ranked table (id, n, OTIF mean ± half-width, cost mean ± half-width); the expected effect quotes the table's estimate and says the day re-runs. A person accepts, declines or snoozes as for every rule; nothing acts on its own.

**The rates must agree (v3.63).** Before any of that, the rule compares the table's `rates` block with the run's own plan: if the run declares error shares and the table was searched at others, or the run's dock lateness list is not the table's, the rule **stays silent** and says why - the note lands on `control.state.searchNote` and the card prints it under the loaded table (*The fifth rule is silent here: the table was searched with error shares …; this run uses …*). A ranking measured in another world does not transfer. A table from v3.62 without a `rates` block matches anything, and a run that declares no such block has nothing to contradict - the proposal then carries the table's rates into the run.

## What it is not

Not an optimiser over a plant: a grid over a synthetic simulation, one run per seed, no warm-up removal, no validation against a real site. The rates are teaching values unless a site profile is given, and a profile is what a plant recorded, not what it will do. Not a guarantee: the half-widths are the honesty of the estimate, the rule refuses a gain inside them, and a thin sample cannot win. One limit remains: the tool reads a profile **file**, not the browser's live knowledge base, so a value edited by hand in the card reaches the drawer's runs but not a search - export the profile, or pass the one the fit wrote.

## Hand values (`verify_search.js`)

On the hand floor with seeds 1 and 2 over 400 ticks, staffing `declared, adaptive` × carrier period `240, 120`: four combinations, eight runs. The harness recomputes every combination's OTIF, cost and delivered orders from the eight exports it wrote (`WT.ledger.serviceOf`, `WT.ledger.costs`), the mean, the sample standard deviation and the half-width with t = 12.706 (n = 2), the ranking by the stated order, and pins the tool's numbers equal; the cost statistics also equal the viewer's own replication rows for the same runs. The rule is pinned on a hand table: it proposes the best at the first evaluation when the run is at the worst combination with a clear gain, stays silent when the run is already at the best, when the gain is inside the half-widths, and when the table's scenario or ticks differ.

## Reproduce

```sh
node verify_search.js
node tools/search_levers.mjs hand --seeds 1-2 --ticks 400 --out work/search --staffing declared,adaptive --outbound-period 240,120
node tools/search_levers.mjs hand --seeds 1-2 --ticks 400 --out work/search-site --staffing declared,adaptive --outbound-period 240,120 --profile test/fixtures/site-profile.json
```

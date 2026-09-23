# The plant's own rates: a site profile fitted from recorded events (v3.59)

*Written 2026-09-23 for v3.59. The error what-if (v3.54) and the delivery what-if (v3.55) run on teaching values - HEART / SPAR-H anchors and the shape of a public delivery dataset. This page is how a plant replaces them with its own numbers, and what that does and does not mean.*

## What it does

`tools/fit_rates.py` reads a **recorded** event set - EPCIS 2.0 documents mapped by the return path ([EPCIS_IMPORT.md](EPCIS_IMPORT.md)), or the `source = 'imported'` rows of a run-ledger database - and an optional **trailer log** (CSV: `trailer, scheduled, arrived`, ISO 8601 with a zone), and writes a **site profile** (`wt-site-profile/v1`):

```sh
python tools/fit_rates.py fit --document plant-week-38.json --deliveries trailers-week-38.csv --site "Plant Heilbronn" --out site-profile.json
python tools/fit_rates.py fit --database run.sqlite --run EPCIS-... --out site-profile.json
python tools/fit_rates.py check site-profile.json
```

The profile is loaded like any knowledge-base file (*Settings & data → Knowledge base → Import KB*, or `WT.kb.importJson` / `WT.kb.applyProfile`). It is an **overlay**: only the fitted entries change, the rest of the knowledge base stays; each fitted entry shows a *measured* badge and the label `measured on <source>, n = …` above its teaching default; *Reset* restores the teaching value and its label. The next run of the error what-if reads the measured shares, and with `delivery.site.n > 0` the delivery what-if uses the site's lateness quantiles (ticks = minutes) instead of the SCMS mode.

## The rule

| What | How |
|---|---|
| The record | Recorded events only. The simulation's own twins (`source = 'derived'`) are refused - a fit on them would launder a teaching value into a "measurement". |
| Per business step | events, objects, the events whose disposition is not `in_progress` (descriptive - at `storing` every event is `sellable_*`), the events with an **error disposition** (`mismatch_class`, `sellable_not_accessible`, `damaged` - the app's own vocabulary) and the dispositions counted. Every step in the record, sorted. |
| The error shares | `hf.error.mis-pick` = `mismatch_class` at `picking` ÷ picking events; `hf.error.wrong-putaway` = `sellable_not_accessible` at `storing` ÷ storing events; `hf.error.damage` = `damaged` at `unpacking` + `packing` ÷ those events. Each the app's own error kind at its own step (`routing.js ERROR_KINDS`). Fitted only when the step has at least one event; otherwise listed under `not_fitted` with the reason and the teaching value stays. |
| Not fitted | The performance-shaping multipliers (`hf.psf.*`): a measured share already contains whatever time pressure, lighting and training the plant had; the multipliers stay levers for what-ifs on top. |
| The trailer log | lateness = arrived − scheduled in whole minutes (`floor(x + 0.5)`); nearest-rank quantiles min / p10 / median / p90 / max - the **same rule** as `tools/scms_delivery.py` (`rank = ceil(p × n)`, 1-based; p = 0 the minimum); shares late / early / on time. They land in `delivery.site.n` and `delivery.site.lateness{Min,P10,Median,P90,Max}` (ticks: the simulation's tick is one minute at 60 ticks per hour, so a measured minute is a tick; `delivery.scaleTicksPerDay` does not apply to site quantiles). |
| The label | `measured on <document ids or file>, n = <events> <what> (<numerator> <disposition>); tools/fit_rates.py (v3.59)`. A knowledge-base entry without a label starting with `measured on` is refused by the loader. |
| Deterministic | No dates, no wall clock; the same inputs write the same bytes (`test/fixtures/site-profile.json` is pinned fresh). |

## What it is not

The values are what the record says for the period it covers - not a validated error model, not a forecast, not a benchmark. A step that recorded nothing measures nothing there. A share from fifty picks is a share from fifty picks: the profile carries `n` so a reader can weigh it, and the app shows it. Aggregates only, per step and per trailer: nothing is keyed to a person, and the tool cannot be pointed at one (BetrVG § 87(1)6, GDPR Art. 88). Whether a plant may record such aggregates at all is a question for its works council and its legal basis, not for this tool - the deep dive's chapter 5 says so.

## The fixture

`test/fixtures/fit-rates.events.json` is **synthetic** and hand-designed so the shares are exact fractions: 50 picking events with 2 mis-picks (0.04), 20 put-aways with 1 wrong slot (0.05), 10 depalletisings and 10 packings with 1 handling damage (0.05), 10 receipts. `test/fixtures/fit-rates.deliveries.csv` has ten trailers late by −30, −10, −5, 0, 0, 5, 10, 20, 45, 90 minutes → min −30, p10 −30 (rank ⌈1⌉ = 1), median 0 (rank 5), p90 45 (rank 9), max 90; late 5, early 3, on time 2. `test/fixtures/site-profile.json` is the tool's output on the two.

## Reproduce

```sh
node verify_fit_rates.js                                          # the fit by hand, the refusals, the knowledge base's labels, the wiring
python -m unittest test.test_fit_rates -v                         # the Python side and the command line
python tools/fit_rates.py fit --document test/fixtures/fit-rates.events.json --deliveries test/fixtures/fit-rates.deliveries.csv --site "example plant" --out site-profile.json
python tools/fit_rates.py check site-profile.json
```

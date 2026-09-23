# Changelog

## v3.59 — The plant's own rates: a site profile fitted from recorded events

**The tool.** `tools/fit_rates.py fit --document <epcis.json> ... [--deliveries <trailers.csv>] --out
site-profile.json` (or `--database run.sqlite [--run EPCIS-...]`) reads a RECORDED event set - documents
mapped by the return path, or the `source = imported` rows of a database; derived twins are refused with
the reason - and writes a `wt-site-profile/v1`: per business step the events, objects, non-in_progress
and error-disposition events with their shares and the dispositions counted; the three error shares as
the app's own error kind at its own step (`hf.error.mis-pick` = mismatch_class at picking ÷ picking
events, `hf.error.wrong-putaway` = sellable_not_accessible at storing ÷ storing events,
`hf.error.damage` = damaged at unpacking + packing ÷ those events), fitted only where n ≥ 1 and listed
under `not_fitted` with the reason otherwise; the trailer log's lateness (arrived − scheduled in whole
minutes) as nearest-rank quantiles min / p10 / median / p90 / max by the SCMS tool's own `nearest_rank`
and the shares late / early / on time, into six new `delivery.site.*` knowledge-base entries (ticks =
minutes). Every value is labelled `measured on <source>, n = ... <what> (<numerator> <disposition>);
tools/fit_rates.py (v3.59)`. The multipliers are not fitted. `check` validates a profile. Deterministic.

**The knowledge base.** `WT.kb.applyProfile(profile)` (and `importJson`, which routes the schema) is
an OVERLAY: only fittable entries (`hf.error.*`, `delivery.site.*`) change, each stamped `measured`
{ label, n, source }; a value outside the entry's range, a label not starting with `measured on` or a
non-fittable id is skipped with the reason; `reset(id)` / `reset()` restore the teaching value and drop
the stamp; the stamp survives export / import and a reload; `profile()` reports what was applied. The
card shows a *measured* badge and the label above the teaching default. `readDeliveryLevers` uses the
site quantiles (scale 1, mode `site`) when `delivery.site.n > 0`; the error levers read the measured
shares as they always read the knowledge base.

**Verification.** `verify_fit_rates.js` (the fit on the hand-designed fixture: 0.04 / 0.05 / 0.05 with
their n, the quantiles −30 / −30 / 0 / 45 / 90 and the shares; a step without events not fitted; the
derived-only database refused; the committed profile fresh; the knowledge base's labels, skips, resets
and round trip; the site quantiles through `windowLateness`; the wiring), `test/test_fit_rates.py`
(+7 → 169), the in-app self-test `site-profile-measured-labels` (191/191). Fixtures
`test/fixtures/fit-rates.events.json` (synthetic, hand-designed), `fit-rates.deliveries.csv`,
`site-profile.json`. `docs/SITE_PROFILE.md`. Cache `wt-v138`.

## v3.58 — The return path: a recorded EPCIS 2.0 document into the tracking database

**The mapping.** `tracking.js fromEpcis(document)` reads an EPCIS 2.0 capture document (JSON / JSON-LD,
`type: "EPCISDocument"`, `epcisBody.eventList`) onto the shape the derived twins use
(`factory-tracking-events/v1`): ObjectEvent and AggregationEvent only; only the 13 business steps and
8 dispositions this app knows, in the three CBV forms (bare, `urn:epcglobal:cbv:bizstep:x`,
`https://ref.gs1.org/cbv/BizStep-x`), the form remembered in `wt:vocabulary`; a refusal names the
event and the identifier and says whether it is CBV 2.0 at all (the 41 / 33 / 13 identifiers of the
ratified JSON-LD context, read 2026-09-23). Every event needs a zoned ISO 8601 `eventTime` and an object;
an ObjectEvent naming several EPCs becomes one mapped event per EPC (`eventID#2`, `#3`, ...) so a unit's
history has no holes; events are ordered by time with document order as the tie-break; `wt:tick` is
whole minutes from the earliest event (floor(x + 0.5)), `wt:minute` exact, `eventTime` kept; `wt:kind`
recorded, `wt:source` imported, `wt:op` null. ISO 8601 is parsed by hand (Hinnant's days-from-civil,
the offset applied) - still no `Date` in the module. The run is `EPCIS-<fnv1a>` with scenario
`epcis-import`, `minutes_per_tick 1` and a `run.source` block (document id, counts, earliest / latest,
ignored fields). `store.importJson` accepts the document beside the two shapes it took; the imported run
round-trips through the store's export.

**The SQL side.** `tools/epcis_import.py check | twin | import | dwell`: the Python twin of the mapping
(pinned equal to the committed JavaScript twin event by event), one `run` row and one `tracking_event`
row per mapped event with the new `source` column set to `imported`. `tracking_event` is rebuilt once
in an older database: `source` (derived | imported, CHECKed), `handling_event_id` nullable, no foreign
key from `hu_id` to a ledger unit, the ledger-only columns nullable; `v_epcis_events` joins `hu` on the
left and carries `source`. `v_bizstep_dwell`, `v_unit_history` and the `v_tracking_gaps` invariant work
unchanged over both sources (the gaps stay 0 with a derived and an imported run in one database).

**The app.** *Simulate → Run ledger → Import EPCIS 2.0 document* (a file input; nothing is sent
anywhere): the status line reports the run, the counts, the minutes and the ignored fields; a refusal is
shown with its reason.

**The fixture.** `test/fixtures/epcis-document.json` is **synthetic**, this repository's own (one pallet
unpacked into cases, one case picked, packed and shipped, one found damaged and written off; ten events
out of time order in the three CBV forms, one without an `eventID`, one with ignored fields, mapping to
eleven). GS1's published examples were read for the shape and none is copied: the gs1/EPCIS repository's
LICENSE is the GS1 IP-policy disclaimer, not a copying licence (CREDITS). `tools/make_epcis_fixture.mjs`
regenerates the committed twin. `docs/EPCIS_IMPORT.md` states the rule and what the import is not: a
file is the physical-to-digital direction by hand - a *manual* shadow on Kritzinger's ladder (the deep
dive's chapter 2 and roadmap say so).

**Verification.** `verify_epcis_import.js` (25 checks: the mapping by hand - ticks 0,12,40,40,41,50,90,
105,125,140,180, versions, ids, forms, parents and children; ISO 8601 by hand against the epoch, a leap
day and the GS1 example time; dwell per step in minutes by hand; nine refusals that say which; the store;
determinism and the fresh fixtures; nothing imported, nothing changed - fixture A's twins byte-identical;
the Python twin's three CBV lists equal; the wiring), `test/test_epcis_import.py` (+8 → 162), the in-app
self-test `epcis-import-return-path` (190/190). Cache `wt-v137`.

## v3.57 — Housekeeping after the twin programme: the replication runner's three levers, the rework drawing by op index, an undo for an accepted lever

**The replication runner.** `tools/replicate.mjs` takes the three what-ifs of v3.54 / v3.55 as run inputs:
`--errors declared|<json>`, `--inbound windows|<json>`, `--outbound windows|<json>`. A keyword takes the
app's defaults (the three error kinds at their teaching shares; dock and carrier windows on the SCMS Truck
lateness shape at 60 ticks per day, loaded from `data/scms-delivery.js`), a JSON literal is handed to
flowsim as it is, anything else exits 2. The bundle records the levers (keys only when present) and, because
the SQL and the viewer key replication groups on them since v3.55, runs with different levers never form one
group. `verify_replicate.js` 1f / 1g (+2 → 22 checks).

**The rework drawing.** v3.54 stated a cosmetic limit: `goods.js formAlong` resolved the first occurrence of
an operation, so a unit queued for its re-pick could be drawn in the form before its first pick. `formAlong`
now takes the op's index and `opIndexAt(route, seg)` derives it from the unit's waypoint (the k-th run of
waypoints carrying an op is the k-th occurrence); the ledger passes the index it already had. On every route
without a rework the index is the first occurrence, so nothing else moves (every fixture byte-identical).
`verify_forms.js` 8a / 8b (+2 → 27 checks): queued at the second pick draws the tote, at the first the carton.

**An undo for an accepted lever.** `applyLever` returns the value the lever had; the accepted audit row
carries it as `lever.from`; the audit table in the control-tower card offers *Revert the last accepted
lever* when one exists, which sets the lever back, appends an audit row of status `reverted` (evidence
`{ reverts: <proposal id> }`) and re-runs the day, the same rule as accepting. The tower itself still never
writes a lever. `controlRows` and `v_control` gain a `reverted` column; the SQLite `CHECK` accepts the new
status and a database created before v3.57 rebuilds its `control_event` table once at open (SQLite cannot
alter a CHECK) - `test_run_ledger.py` (+1 → 154). `verify_control.js` 5c / 6b / 6d updated.

**Counts.** 81 harnesses; 154 Python tests; WT-SELFTEST 189/189 and the viewer's 36/36; cache `wt-v136`.
Deleted on GitHub: the three merged Codex branches. The SCMS licence stays unresolved (data.usaid.gov and
catalog.data.gov unreachable from this machine on 2026-09-23; an open human task).

## v3.56 — The control tower: four rules propose, a person decides, accepting re-runs the day

**The module.** `control.js` (`WT.control`): `create(thresholds)`, the read-only `observe(ctl, rec, state)`
evaluated every `evalEveryTicks` ticks (10) on the app's after-tick hook - ledger, tracking twins, then
the tower - and `decide(ctl, id, status, tick)`. Four rules, each at most once per run (again after a
snooze): *queue congestion* (a station's queue at or above the sim's congestion threshold at every
evaluation for `sustainTicks` (30) with no staffing policy active → the adaptive-staffing picker; on the
hand floor the put-away queue reaches 6 at tick 97, dips to 5 across the tick-100 evaluation, is at or
above 6 from 110, and the tower proposes at 140 naming element stg, expected effect quoted from verify_staffing.js: 19 → 17, no fewer completions,
"your floor will differ"), *rework burden* (the error what-if ran with a lever above 1 and, after
`minUnits` (20) through the error-prone steps, the reworked-or-scrapped share exceeds `maxShare` (0.01)
→ reset the largest lever, named, with the per-kind arithmetic, e.g. mis-pick 0.22 → 0.02; silent
without a lever to remove), *inbound late* (a logged trailer later than `lateTicks` (60) → halve the
inbound period; the hand lateness list's trailer 3 at 159 ticks proposes at tick 460), *OTIF below
target* (at least `minDeliveries` (20) delivered orders and OTIF below `delivery.otif.target` → halve
the carrier period; never without carrier windows, never when every order is on time). A proposal =
{ id, rule, tick, evidence (element ids, counts, ticks, shares), lever { kind: picker | kb, key, value },
expectedEffect, why, status, decided_tick }. `decide` writes { seq, tick, rule, proposal_id, status,
lever, evidence } into the tower's audit; declined never proposes again, snoozed returns after
`snoozeTicks` (120: on the hand floor at 260, 380, 500), a second decision or an unknown id is refused.
Purity: a run with the tower attached is byte-identical to one without; two identical runs propose the
same at the same ticks. `controlRows(export)` is the `v_control` twin.

**The app.** A *Control tower* card in the Simulate drawer (after the flow card) lists the open proposals
with their evidence and three buttons. *Decline* and *Snooze* push the audit row (with the run it came
from) into a log the app keeps across runs and change nothing else; *Accept* applies the lever exactly as
the picker (staffing) or the knowledge base (a PSF lever, an inbound or outbound period) would, then
re-runs the day from tick 0 - the run id is a hash of its inputs. The log rides with every run ledger
(`ledger.create(..., { control })`) and is exported as `control` only when a decision exists. The
knowledge base gains a *Control tower thresholds* category (seven seeds pinned equal to control.js
DEFAULTS); the readout's audit table names the run each decision came from.

**SQL and viewer.** `control_event(run_id, seq, tick, rule, proposal_id, status, lever, evidence,
from_run)` and the planner view `v_control` (per rule: proposals, accepted, declined, snoozed, first
tick; reconciled); the viewer's *Control tower* block (the per-rule table and the raw audit, a note
when nobody decided) and a glance card.

**Human, mechanically.** The evidence of every proposal is aggregates per step and station; the module
reads no roster and no worker module and the harness proves it; HONESTY names BetrVG 87(1)6, GDPR
Art. 88, "a person decides" and "not a certification". The deep dive's chapter 3 is rewritten as what
exists at v3.56 and its Reproduce section lists every harness of the programme.

**Limits, stated.** Four teaching rules with teaching thresholds; the expected effects are measured on
the hand floor or arithmetic on declared values, never a prediction for another floor; the tower
cannot undo an accepted lever (a person changes the picker back and re-runs); accepting discards the
running day.

**Verification.** `verify_control.js` (25 checks), +3 Python tests (v_control by hand on a three-row audit,
the status CHECK, an old database gaining the table), both self-tests. 81 harnesses, 153 Python
tests, WT-SELFTEST 189/189 + viewer 36/36. Cache wt-v135. The four run exports are byte-identical.

## v3.55 — Delivery and shipping times in between: dock and carrier windows on a public dataset's shape

**The dataset.** `tools/scms_delivery.py` (fetch / reduce / --check / --offline-check, the shape of
`nist_box_assembly.py`) reduces the USAID SCMS delivery history - 10 324 shipment lines, 2006-2015,
a public GitHub mirror of the Development Data Library file - to `data/scms-delivery.json` (+ the JS
twin and `docs/SCMS_DELIVERY.md`): per shipment mode (Air, Air Charter, Ocean, Truck, not captured)
and overall, rows, usable rows, lateness in days (delivered minus scheduled) as min / p10 / median /
p90 / max by the nearest-rank rule, the shares late / early / on time, and the PO-to-delivery days the
same way. THE RULE is stated once in the tool and recorded in the JSON; unparseable dates ("Date Not
Captured", "N/A - From RDC" - 5 732 of the PO dates) are counted, never filled in; some PO dates are
written m/d/yy and are read as such; the literal mode "N/A" is "(not captured)". Two findings stated
rather than smoothed over: every one of the 10 324 rows carries both delivery dates, and the mirror is
the only reachable copy - the licence is recorded as UNRESOLVED (the DDL issues a Government Work or a
CC BY-ND 4.0 partner licence per dataset), so only aggregates are committed, with the attribution the
DDL asks for. No retrieval date anywhere: the reduction reproduces byte for byte.

**The model.** `flowsim.spawnPlan` takes `opts.inbound = { periodTicks, openTicks, lateness[] }` and
`opts.outbound = { periodTicks, promisedLeadTicks, transit[] }` (or `true` for the defaults 120 / 30 and
240 / 480). Trailer j is scheduled at j x P and arrives max(0, late_j) later - an early trailer waits
for its slot - and the door is open O ticks from the arrival; units spawn only while it is open (one
`break` between the pool guard and the in-flight cap; the arrival accumulator keeps counting, so a
trailer is a burst at the door), and every window's first open tick logs the trailer. The lateness
list is not a random draw: `windowLateness(quantiles, scale, 16)` pushes the Weyl sequence
u_j = frac(j x 0.6180339887) through the piecewise-linear inverse distribution of the chosen mode's
quantiles and scales by the knowledge base's ticks-per-day (60: one dataset day = one plant hour, a
teaching scaling said so wherever it shows); the spawn loop draws the PRNG exactly as before. A unit
loaded at the outbound dock waits for the next carrier departure (every M ticks, never less than the
eight-tick dwell) and retires exactly at it. Absent keys -> no branch: the plan, the state and fixture
A are byte for byte what they were.

**The ledger.** With windows every unit carries `trailer`, `due_tick` (spawn + the promised lead),
`transit_ticks` (a nominal transit plus the same lateness shape, by sequence) and, at delivery,
`customer_tick`, `on_time_shipped`, `on_time`; `run.inbound` / `run.outbound` carry the windows and
the ledger's honesty and join the run id; the trailer log is exported as `inbound`; `serviceOf(export)`
gives orders, delivered orders, OTIF orders and share (an order is on time in full when every unit
was delivered by its due tick - synthetic one-line orders unless a pool was loaded), the shipped-on-
time share and the mean transit; `inboundRows` the trailers with the units each brought. The tracking
twins carry `wt:delivery` (the trailer on the first event; promise, transit and outcome on the
shipping event).

**SQL, viewer, app.** `run.inbound` / `run.outbound`, six `hu` columns, `inbound_event`, the planner
views `v_otif` and `v_inbound` (reconciled), guarded ALTERs; the four replication views (and the
viewer's twin) now key their groups on the error and delivery levers as well - the gap v3.54 stated is
closed. The viewer's *Delivery* block (OTIF cards, the trailers at the door) and a *Delivery* glance
card; the planner's *Delivery* picker (instant | windows), a knowledge-base `delivery` category (eight
seeds: the periods, the mode index, the scale, the promised lead, the nominal transit, the OTIF
target - a commonly quoted target, not a standard) and a delivery line in the flow readout.

**Limits, stated.** The lateness shape is international pharmaceutical lanes, not a warehouse's dock,
and the scale is a teaching choice; not a yard, not dock appointments, not a carrier network, not a
customer calendar; every spawn is gated by the inbound windows (order types that start in stock too);
OTIF counts synthetic one-line orders; a trailer more than three periods late is not looked for.

**Verification.** `verify_delivery.js` (25 checks: the Weyl values and the inverse distribution by hand, the
window openings and the trailer log by hand, spawns only inside windows, no new PRNG draw, a drained pool,
retirements at departures, OTIF on a six-unit pool by independent arithmetic, the dataset twin, the keys,
the twins, the wiring), `test/test_scms_delivery.py` (a twelve-row hand CSV, nearest rank by hand, the
committed reduction, the offline check), +4 Python ledger tests (OTIF and the trailers by hand, no rows
without windows, the guarded ALTERs, replication groups keyed on the levers), both self-tests. 80
harnesses, 150 Python tests, WT-SELFTEST 188/188 + viewer 35/35. Cache wt-v134. The four run exports are
byte-identical.

## v3.54 — Human error, honestly: declared shares per step, quota-dispatched branches, an unrolled rework

**The model.** `flowsim.spawnPlan` takes `opts.errors` - `true` for the three kinds at their defaults,
or `{ "mis-pick": 0.02, "wrong-putaway": 0.003, damage: 0.005, psf: { timePressure, signalToNoise,
familiarity }, cap }` - and `routing.normalizeErrors` turns it into effective shares: share × the
product of the levers (HEART's error-producing conditions: time pressure ×11 at most, low
signal-to-noise ×10, unfamiliarity ×17), capped at 0.5, the levers above 1 recorded as the latent
conditions. `routing.branchesFor` then hands `flowsim.buildRoutes` one extra branch per (kind,
step) of every base branch, the way the returns split already works: the rework spliced in
(`… piece-pick, verify-pick, piece-pick …`; `… putaway, verify-put, putaway …`) or the write-off
appended (`… pack, scrap`), the base branch keeping the rest of the demand, all dispatched by the
existing quota rule (a 2 % share over 100 units errs at indices 25 and 75, by hand). Two new
operations after the twenty, `verify-pick` (pick face) and `verify-put` (storage), no station, no
new anchor; the route id and label name the kind and the step. Without `opts.errors` nothing
changes: the plan JSON, the route count, the run id hash and fixture A are byte for byte what they
were; the legacy spine never branches. The shares are TEACHING VALUES anchored on HEART (Williams
1986; consolidated 2017) and SPAR-H (NUREG/CR-6883) generic probabilities - nuclear-industry
anchors, not warehouse measurements - and the knowledge base carries them as a `human-factors`
category (seven seeds, pinned equal to routing's defaults) that says so.

**The ledger.** Two observer fixes the rework needed and every existing route is indifferent to:
`quantityAt` takes the op INDEX (the queued event at the second pick carries the picked quantity,
not the pallet), and a unit served at one occurrence of an operation and queued at its next
occurrence within the same tick - the same bench, the waypoint moved, op and status did not - is
recorded as served, passed (the verification), queued. Units on an error branch carry
`error_kind / error_op / error_outcome / error_latent`; `run.errors` records the kinds, the levers
and the ledger's honesty and joins the run id; `stats().quality` (only when the what-if ran) and
the pure `qualityByStep(export)` give ISO 22400-2's names per operation: units through, errors,
reworked, scrapped for damage, first pass yield, rework ratio, scrap ratio.

**The tracking twins.** At the erring step the disposition the kind names (`mismatch_class`,
`sellable_not_accessible`, `damaged`) with `wt:error` (kind, step, detected, latent); at the
verification `inspecting`, back to `in_progress`, `wt:error.detected` true; a damaged unit stays
damaged while held at the returns bench and is destroyed `non_sellable_other`. The Python twin
mirrors it (`tracking_event.error_detected`).

**SQL, viewer, app.** `run.errors`, the four `hu.error_*` columns and `tracking_event.error_detected`
with guarded ALTERs; `v_quality_by_step` (a planner view, reconciled against the JavaScript rows);
the viewer's *Quality by step* table with a note that names the what-if or says every step was
perfect, a *Human error* glance card, the invariant count spelled out instead of "all four"; the
planner's *Human error* picker (none | declared, remembered on this device) and a quality line in
the flow readout.

**Limits, stated.** A unit errs at most once and one kind at a time; a rework is an unrolled detour,
not a loop (the KNOWN LIMITS say so); the legacy spine never branches; `goods.js formAlong` resolves
the first occurrence of an operation, so a unit queued for its re-pick is drawn in its first-pass
form - a cosmetic limit; replication groups do not yet key on the error lever (v3.55 adds the
levers to the grouping).

**Verification.** `verify_errors.js` (33 checks), +4 Python tests (the quality view by hand with one
reworked unit, the perfect fixture, the guarded ALTERs, the twin's error and its detection), both
self-tests. 79 harnesses, 139 Python tests, WT-SELFTEST 187/187 + viewer 34/34. Cache wt-v133.
The four run exports are byte-identical.

## v3.53 — The tracking database: EPCIS-shaped twins, derived not recorded, kept across runs

**The module.** `tracking.js` maps every handling event of the run ledger to exactly one
EPCIS-shaped event: GS1 EPCIS 2.0 event types (ObjectEvent, AggregationEvent) and actions,
CBV 2.0 business steps and dispositions used as vocabulary - no conformance is claimed, because a
simulation has no wall clock (`eventTime` is null; the tick and minute ride in `wt:` fields) and
the EPC URIs are built on GS1's documentation prefix. The mapping is the one the deep dive's
chapter 6 specified: `created` is an ADD at receiving (or picking for a unit that starts in
stock), a return enters `returned` with an `rma` transaction, `queued` keeps the op's step with
`wt:kind: queued`, depalletise is an AggregationEvent DELETE (unpacking: the pallet SSCC over its
cases as GTIN-14), pack and palletise are AggregationEvent ADDs (the parcel or pallet SSCC over
eaches as GTIN-13 or cases as GTIN-14), `load` is loading then shipping / in_transit, `restock` is
stocking / sellable_accessible, `scrap` is holding then destroying / non_sellable_other as a
DELETE. The twins are **derived, not recorded**: `fromLedger(export)` and the incremental
`observe(track, rec)` produce the same document event for event, and neither touches the ledger
or the simulation (a run with the tracker attached is byte-identical to one without). Three
questions over the events: `historyOf` (where was unit X), `dwellByBizStep` (per step: events,
units, spans, mean and maximum ticks to the unit's next event, waiting separated - equal to the
ledger's own spans) and `dispositionCounts`.

**The store.** `openStore({ name, maxRuns })` keeps runs across sessions in IndexedDB (over http)
with the same promise-shaped API served by an in-memory store where none is available (Node,
file://, a private window): put / get / delete a run, history by handling unit and by order
reference across runs, eviction of the oldest run beyond the cap, export and an import that
refuses an unknown business step. A stored-sequence counter replaces a clock. History is keyed by
the handling-unit id or the order reference, not by the SSCC, which recurs per run.

**SQL and viewer.** `tools/run_ledger.py` derives `tracking_event` at import with a Python twin
of the mapping (the test pins it equal to the committed `test/fixtures/run-ledger.tracking.json`
event by event) and four views: `v_epcis_events`, `v_unit_history`, `v_bizstep_dwell` (a planner
view, reconciled against the JavaScript rows) and the invariant `v_tracking_gaps` (a handling
event without a twin, or a twin outside the vocabulary - zero rows on every fixture, one row per
deliberate corruption in the tests). The run-ledger viewer gains a *Tracking* section (dwell per
business step, dispositions by step, the gap count), the twins beside a unit's trace, and the
fifth invariant. The committed example report gained the new planner view.

**The app.** The after-tick hook multiplexes the ledger observer and the tracker; *Save to
tracking store* and *Export tracking events (JSON)* sit beside the run-ledger buttons; the scene
inspector joins every package to its handling unit, SSCC and order (the assistant no longer says
the identities are not connected).

**Human, mechanically.** Every event is keyed to a handling unit, an element and a business step,
never to a person; the harness proves `tracking.js` references no worker roster and no clock, and
its HONESTY names BetrVG § 87(1)6 and GDPR Art. 88.

**Verification.** `verify_tracking.js` (43 checks: the mapping, the vocabulary against the deep dive, the
EPC URIs by hand, GLNs one-to-one with the elements, dwell == spans, the store, purity, export ==
observer, wiring); seven Python tests (the twin equal to the fixture, gaps on every fixture and after
a corruption, dwell and history by hand, SQL == JavaScript on the fixture); the app self-test round-trips a
run through the store - on the memory backend under the gate, and on IndexedDB when the page is opened
with `&idb=1`, which `python tools/selftest_realtime.py` does in real-time headless Chrome (run by
hand: PASS 186/186, "store indexeddb"). The gate's `--virtual-time-budget` driver cannot reach
IndexedDB: under it Chromium leaves requests incomplete (an open and a write went through, a read
never returned) - a limit found while shipping this release and stated here rather than hidden; the
store's open also times out into the memory fallback with the reason, so no caller can stall on it.
The viewer self-test drives the section. 78 harnesses,
135 Python tests, WT-SELFTEST 186/186 + viewer 33/33. Cache wt-v132. The four run exports are byte-identical.

## v3.52 — The deep dive: what a factory digital twin is still missing

**The document.** `docs/DIGITAL_TWIN_DEEP_DIVE.md` (about 11 700 words, twelve chapters):
what a factory digital twin is by the standards (ISO 23247's definition and observable
manufacturing elements, Kritzinger's model / shadow / twin ladder, the Asset Administration
Shell, GS1 EPCIS 2.0 / CBV 2.0, ISO 22400, VDI 3633 / 4499 / 5200), what this app already
has (an OME coverage table; the run ledger, the SQLite twin, the routing model's own known
limits quoted), a list of twelve gaps with the standard each violates and the cost of
leaving it open, three chapters on keeping the approach human (Grosse et al.'s human
factors, Rasmussen's SRK and Reason's latent conditions, the SPAR-H performance-shaping
factors read as design levers, BetrVG § 87(1)6 and GDPR Art. 88 as design constraints:
errors belong to a step, never to a person), and four design contracts with acceptance
gates named after the harnesses that will prove them: the tracking database (EPCIS-shaped
events derived from the ledger, persisted across runs), human error (declared shares per
step, quota-dispatched, teaching values anchored on HEART / SPAR-H, an unrolled rework),
delivery and shipping times in between (dock and carrier windows whose lateness shape comes
from a public USAID delivery dataset, OTIF), and a control tower that proposes from
aggregates with a human in the loop. A "what is real, with sources" table, a register with
editions and explicit non-claims, a "not modelled" list and a "reproduce" section close it.
Every number is cited or labelled a teaching value; the app is placed honestly as a digital
model with one measured shadow.

**Verification.** Docs only: no new harness; 77 harnesses, 129 Python tests, WT-SELFTEST
185/185 + viewer 31/31. Cache wt-v131 (unchanged).

## v3.51 — Detail: standards chips on the group headers, the screenshots, the driver

**Detail.** The *Machines (DIN 8580)* and *Production / Assembly* group headers of the Class
Library carry a chip naming the standards the group is informed by ("informed by DIN 8580 ·
ISA-95"; labels only, never a certification). The hover card already opens on keyboard
focus (v3.48); the Inspector's *Provenance* and *Dataset* rows and the factory panel's
measured / modelled chips (v3.50) are the per-operation detail.

**Screenshots.** `docs/img/class-library.png` (Factory mode, the Machines group in the 2.5D
thumbnail style, 2× DPR), `docs/img/nist-box-assembly-2d.png` and
`docs/img/nist-box-assembly-iso.png` (the cell with the factory panel; the 2.5D view with a
machining centre's provenance in the Inspector), all taken from the live app by
`tools/screenshot.py` — a Playwright driver that operates the page through its own controls
(rail drawers, mode button, library toggles, Fit), quantised to 256 colours; `--hero`
retakes the README hero and the starter shot. Not part of the gate or CI. The deep-link
`view` / `mode` parameters considered for reproducible screenshots were not added; the
driver toggles the view and the mode instead.

**Downstream.** Portfolio site card, the Würth case study (counts and one sentence EN / DE,
PDF rebuilt), the agent brief and the task list carry v3.48–v3.51.

**Verification.** No new harness; 77 harnesses, 129 Python tests, WT-SELFTEST 185/185 +
viewer 31/31. Cache wt-v131.

## v3.50 — A factory from an actual dataset: the NIST box-assembly cell

**The data.** `tools/nist_box_assembly.py` fetches the public NIST Smart Manufacturing
Systems Test Bed *Box Assembly* logs (github.com/usnistgov/smstestbed, `tdp/mtc/Split`,
184 MTConnect logs: Box, Cover, Plate × 20 instances on two Hurco VMX 24 machining centres)
into a git-ignored cache and reduces them with ONE stated rule (leading stale samples
dropped; the run time is the maximum of `Program_Runtime_Seconds`; a wall-clock span
cross-check; unusable logs counted, never filled) into `data/nist-box-assembly.json`, its
JS twin and `docs/NIST_BOX_ASSEMBLY.md`. `--check` re-fetches and compares (manual);
`--offline-check` runs in the tests. The NIST notice is kept verbatim; no logo.

**The cell.** Generator profile `nist-box-assembly` (`laneTypes`: two `cnc-mill`,
`mfg-assembly` + `cmm-inspection`, `pack-station`; `dataset: "nistBoxAssembly"`) and
`buildDatasetProcess`: a six-operation chain whose two machining cycles are the measured
medians summed per machine (Box on Hurco02; Cover + Plate on Hurco04), with sources that
name the dataset, the machine and the rule; assembly (240 s) and CMM inspection (600 s)
are labelled teaching estimates, demand 4 boxes per shift a teaching value. Without the
dataset twin the same geometry builds with no process block (the app derives its
teaching chain). Example `nist-box-assembly-cell`; `buildFactory` and `exportData` carry
the block and its provenance (`meta.dataset`). The four legacy profiles emit no
`laneTypes` / `dataset` and build byte-identically (digests pinned).

**The app.** `state.dataset` (never serialised); Inspector rows *Operation*, *Line
cycle* (measured | modelled), *Provenance*, *Dataset*; the factory panel's basis line
says "Cycle times: 2 measured (…), 2 modelled" and each row carries a measured /
modelled chip with the source as its title. `data/nist-box-assembly.js` loads before
`generate.js` and is precached.

**Verification.** New `verify_nist_factory.js` (24 checks: the committed file's schema,
notice, rule, ordered statistics, derived sums and JS twin; the profile, build,
geometry, determinism, block, provenance strings, sanitize round-trip, metrics, dataset
meta and the honest fallback; the example and its export; the ten unchanged digests;
wiring) and `test/test_nist_box_assembly.py` (+9: the rule on inline samples and logs,
the committed reduction, the renders, the offline check; the online check only with
`WT_NIST_NETWORK`). Pins named: `verify_factory.js` and `verify_flowbalance.js` count
five factory keys. App self-test +1 (`nist-cell-example-loads-with-measured-cycles`).
77 harnesses, 129 Python tests, WT-SELFTEST 185/185 + viewer 31/31. Cache wt-v130.

## v3.49 — Standard types: a typed machine catalogue

**The catalogue.** Nine machine types, each named by public standards: `cnc-mill` (3-axis
machining centre), `cnc-mill-5axis`, `cnc-lathe`, `press-brake`, `moulding-cell`, `welding-cell`,
`coating-booth`, `heat-treatment` and `cmm-inspection`. Every definition carries
`standard: { din8580: { group, name } | null, isa95: "work-cell", note, source }` - the DIN 8580
main group (1 Urformen … 6 Stoffeigenschaft ändern; the CMM has none, inspection is not a
manufacturing process) and the ISA-95 / IEC 62264-1 role - classification labels only,
informed by, not a certification; no ISA-95 information model. All are single-server
flow stations (`base: "station"`), so the process model (`OP_KIND` → station), the line
sim, the workforce pose and the costing (the Workstation teaching kind) treat them as the
existing Station (process). Cycle times are labelled teaching values, editable.

**Everywhere else.** Own 2D glyph + 2.5D form per type (`shapes.js`: guard bands, steel, a
moving working part - spindle, ram, platen, arm, bridge), iso heights, the library group
*Machines (DIN 8580)* after Production / Assembly (hidden in Warehouse mode like the other
factory groups), plain-language synonyms with default lanes ("add a 5-axis machining
centre"; "machining station" still means the generic station), a standard chip in the
Class Library entry and card, a *Standard* row in the Inspector (one sentence from
`library.standardText`).

**Goods.** Two forms appended: `klt` (VDA 4500 small-load carrier, 600 × 400 × 280 nominal,
one plastic colour, rim and ribs) and `workpiece` (a steel block, a drawing constant).
`MACHINE_STAGE_FORM` (KLT in, workpieces on the lane, KLT out) is selected by `formFor` only
behind a `machineLine` flag the app sets when a placed element carries a standard; every
layout without one keeps `STAGE_FORM` byte for byte. `formForType`: machines and stations
handle workpieces, source / drain a KLT (named change of the v3.48 pin).

**Verification.** `verify_library_preview.js` +8 (forms, the table, the flag, draw smoke,
descriptors), `verify_library.js` +3 (the group in each mode, describe, cloning),
`verify_process.js` +3 (source → mill → drain derives a 300 s station, sanitize round-trip,
12 units/h), `verify_factory.js` +2 (NL parse and apply), `verify_examples.js MEGA_EXEMPT`
+9, `verify_forms.js` 7a regex updated, app self-test +1 (`din8580-machines-registered-
everywhere`). 76 harnesses, 120 Python tests, WT-SELFTEST 184/184 + viewer 31/31. Cache
wt-v129. Honest limits: the machines cost as the Workstation kind; no new worker pose (an
operator works two-handed at the panel); the catalogue's cycle times are teaching values.

## v3.48 — The library shows what you place

**The list.** The Class Library's swatches used to collapse to the 28 px LOD icon (the
painter passed the footprint in cells where `draw2D` expects pixels, and no 28 px box
reaches the glyph tier). Now every entry draws the same glyph the floor draws, aspect-true
in a 56 × 36 px box at the full detail tier, with the goods the type handles on it
(`goods.formForType`: racking → pallet load, conveyors → carton, pack bench → parcel,
control stations and the production components → tote, stretch-wrap → wrapped pallet;
gates, chargers and the fluids components handle no discrete goods). `draw2D` gains one
flag, `thumbnail: true`, that skips the on-screen footprint guard; no floor caller passes
it, so floor rendering is unchanged. A Plan | 2.5D toggle (remembered on this device) draws
the list as the 2.5D form instead; the sub-line names the footprint and the handled goods;
the hover (and keyboard-focus) card shows the 2.5D form, the height, and the capacity or
cycle-time rows the Inspector shows, from one descriptor (`library.describe`), labelled
teaching values. The toolbar flyout keeps the simplified icon on purpose (18 px).

**The drop.** While a tool is armed or a library item is dragged, a placement ghost follows
the pointer: the item's own glyph in a dashed footprint, green where the drop is legal, red
with the reason where it is not (`ghostCandidate` = the `placeAt` clamp + the same
`placementProblem` the click uses). The drag image is the thumbnail itself. The ghost is
never serialised and never enters the simulation; on a touch screen, tap an item, drag a
finger over the floor, tap to place. Honest limit: the ghost checks bounds, overlap and
reserved zones only; aisle and dock-approach rules stay with the Compliance Check.

**Inspector.** Behaviour gains *Handles* and *Cycle time* rows for flow types (the same
descriptor). The swatch CSS loses its `!important`, so the flat-colour fallback for a custom
type without a glyph is visible again.

**Verification.** New `verify_library_preview.js` (26 checks: the flag reaches the glyph
tier for all 54 types in both themes against an icon-tier control, the guard line exact and
single, the aspect-true fit by hand and over the catalogue, `formForType` total with pinned
pairs, `describe` against the domain, the ghost's overlap / clamp / reserved-zone / unknown
cases, the wiring), app self-test +3 (every entry carries a real thumbnail canvas; the ghost
follows a pointer move while armed and clears on leave; a library drag over the floor
previews the drop and clears on leave). 76 harnesses, 120 Python tests, WT-SELFTEST
183/183 + viewer 31/31. Cache wt-v128. Screenshots `docs/img/hero-plant-2d.png` and
`docs/img/warehousetwin.png` retaken.

## v3.47 — Board grades

**The table.** `pack.js` `BOARDS`: the twelve ECT box-certificate classes (23, 26, 29, 32,
40, 44, 48, 51, 61, 71, 82, 90 lbf/in) converted with the exact pound-force and inch
definitions (`LBF_PER_IN_TO_KN_PER_M` = 4.4482216152605 / 25.4 = 0.175127 kN/m per lbf/in;
every kN/m value computed, never typed), wall construction and typical flute calipers as
commonly listed (approximate), one `BOARD_SOURCE` string; `nearestGrade(ectKNm)`. The
profiles' board values are untouched (fixture pin, byte-identical exports).

**Viewer.** *Your case* gains a board-grade select that fills the ECT and caliper inputs
(explicit values win; `yourCase` reports `grade`); the strength sentence names the nearest
certificate class (5 kN/m → 29 ECT ≈ 5.08). `docs/PACKAGING_OPTIMISATION.md` §2 has the row
with its source; `CREDITS.md` says the table is classification values and unit arithmetic,
not a supplier's board table.

**Verification.** `verify_stacking.js` +6 (the conversion exact, twelve classes increasing
and computed, the source text, nearest classes, the grade filling blanks and losing to
explicit values, the profiles untouched), viewer self-test +1. 75 harnesses, 120 Python
tests, WT-SELFTEST 180/180 + viewer 31/31. Cache wt-v127.

## v3.46.1 — Fix: a harness pinned the planner-view tuple's last entry

`verify_ledger_flow.js` 4c asserted `"v_flow_links")` — v_flow_links as the LAST planner view —
and v3.45 appended `v_staffing`, so `node test/run-all.mjs` had one red harness in the v3.45 and
v3.46 pushes (the CI job caught it; the local runs were misread from a background task's exit
code). The check now asserts membership in the tuple. No product change.

## v3.46 — Replications over seeds

**The runner.** `node tools/replicate.mjs <scenario-id|hand> --seeds 1-10 --ticks 300 --out <dir>
[--policy queue-staffing]` builds the floor once (the hand floor or a library scenario with
its declared mix and capacities), records one run ledger per seed and writes `run-<seed>.json`
and `bundle.json`; deterministic. `tools/ledger_env.mjs` is the shared loader.

**SQL.** A seeded `t_critical` table (Student's t, two-sided 95 %, df 1–30; the views fall to
1.960 beyond), `sqrt()` registered when the SQLite build lacks it, and four views -
`v_replication_groups`, `v_replication_cycle_by_type`, `v_replication_cost_by_type`,
`v_replication_summary` - grouping every run by scenario, mix, ticks and policy: n, mean,
the two-pass sample standard deviation, t(n−1) × s / √n, min, max. `replications` prints them.

**Viewer.** A multi-file input (several runs of one scenario), a *Replications* section with a
strip plot per order type (a dot per seed, the bar the mean ± the half-width) and the tables,
the four SQL texts (29 now); `RunLedger.replications` is the twin. `howwecompare.js` now says
*replications over seeds with Student-t 95 % intervals; no warm-up removal, no validation against
a real plant* instead of *deterministic single-run heuristics*.

**Verification.** +1 harness (`verify_replicate.js`, 20 checks), +3 Python (the hand numbers
30 / 32 / 34 → 32, 2, 4.9687 in SQL; a single run has no interval; the t table and sqrt),
viewer self-test +1, the comparison harness +1. CI replicates three seeds into the database
and prints the views. 75 harnesses, 120 Python tests, WT-SELFTEST 180/180 + viewer
30/30. Cache wt-v126.

## v3.45 — Adaptive staffing, a what-if

**The policy.** `flowsim.spawnPlan` takes `opts.policy = {kind:"queue-staffing", threshold,
maxServers, cooldownTicks}` (defaults: the congestion threshold 6, two workers, 30 ticks):
before serving, a bench whose queue reached the threshold gains a worker, a bench with an
empty queue and the cool-down elapsed loses one; the serve loop banks the rate x workers.
Every change is logged {tick, station, element, servers}; `state.maxServers`. Absent -> no
key, no branch, byte-identical (proved against fixture A and by snapshot). The ledger
records `run.policy` (with `STAFFING_HONESTY`) and `staffing[]`; the policy joins the run id
(`ids.inputHash`); the rates honesty text is untouched so every earlier export is unchanged.

**SQL and viewer.** `run.policy` (guarded ALTER), table `staffing_event`, planner view
`v_staffing` (changes, max workers, first change, ticks with the extra worker; `LEAD` over
ticks), `v_run_summary.policy`, a reconcile key. The viewer: a *Staffing* glance card, a
*Workers at each bench* step chart with the table and SQL under the planner tables (25 SQL
texts now), the compare marking a what-if side. The planner: a *Staffing* picker beside the
order mix (remembered on the device; a change rebuilds the run), the readout showing
workers on benches.

**Measured on floor A** (every station at the floor rate): the put-away queue reaches 6 at
tick 97; with the policy the second worker joins at that tick, the longest queue is 17
instead of 19, completions 11 = 11. Honest: the what-if adds capacity the declared floor does
not have; a unit is still charged one worker's service time; idle time is not charged.

**Verification.** +1 harness (`verify_staffing.js`, 25 checks), +3 Python (the view by hand,
empty without a policy, an old database migrating), app self-test +1 (the picker, a policy
run's log, no key without), viewer self-test +1 (the section without a policy). 74 harnesses,
117 Python tests, WT-SELFTEST 180/180 + viewer 29/29. Cache wt-v125.

## v3.44 — Your own orders, through the ledger

**The pool itself.** `flowsim.spawnPlan` takes `opts.pool` ([{orderId, lines:[{sku, qty}]}]):
one unit per order line, released in file order, re-released from the first line with the
loop (a re-released order counts on: cycle × orders + n); no extra RNG draw; absent, nothing
changes. `ids.inputHash` folds a pool digest into the run id only when a pool is present.
`ledger.js` names line k of order n (`HU-ORD-<run>-<n>-<k>`), keeps `order_ref`, `sku` and
`line_qty` on the unit, records `run.dataset = {source, orders, lines, skus}`; `pack.js`
`quantitiesAlong(…, line)` lets the line's quantity drive the entering quantity of a returns /
vas / export line and the pick of a case- (rounded up to cases) or piece-pick line - a pallet
archetype still moves a whole pallet. The app hands the loaded pool to the flow and the ledger.

**SQL and viewer.** `run` gains `dataset_source / dataset_orders / dataset_lines / dataset_skus`,
`hu` gains `order_ref / sku / line_qty` (guarded ALTERs migrate older databases; the inserts
are named-column now); `v_run_summary` shows the provenance; new detail view
`v_dispatch_by_order` (lines, delivered lines, eaches in / out, cases, parcels, cases per
pallet, `pallets_needed` rounded up) - consolidation modelled at dispatch, not in the flow.
The viewer's glance gains the *Order stream* card (own data: n orders / m lines, or synthetic)
and the dispatch section the *Dispatch by order* table with its SQL (24 views now).

**Sample data and fixture D.** `tools/make_sample_data.py` writes `docs/examples/skus.csv` (120
articles), `orders.csv` (300 orders, 1,021 lines) and a README - synthetic, seeded, checked
fresh by a test and in CI; `node tools/make_run_ledger_fixture.mjs d` feeds them through the
real importer (`wmsdata.js`) onto fixture C's floor: fixture D, `?example=d`, imported and
reconciled in CI. README gained *Run it on your own data* (the two headers, the sample, what
the model still does not know: no order type in the file, no article dimensions, whole
pallets for pallet lines, consolidation at dispatch only).

**Verification.** +1 harness (`verify_pool.js`, 30 checks: a hand pool of 3 orders / 6 lines
spawning exactly six units n/k in file order with the quantities by the rule, the loop, the
pool-less run byte for byte fixture A, dispatch by order with a two-line consolidation,
fixture D rebuilt through the importer, the wiring), +8 Python (dataset and line columns
round trip, an old database migrating, dispatch by order by hand, the consolidation case,
fixture D, the sample data fresh / headers / ranges), app self-test +1 (an inline CSV through
the importer reaches the flow and the ledger), viewer self-test +2 (example D). 73 harnesses,
114 Python tests, WT-SELFTEST 179/179 + viewer 28/28. Cache wt-v124.

## v3.43 — A realistic recording, at full precision

**Fixture C.** The recorded examples served at the simulator's floor rate (50 ticks per
unit) because the fixture script never loaded `wms.js`, so no floor declared capacities.
Fixture C is the library floor `ecommerce-multichannel-fc` recorded with `wms.js` loaded
(seed 6, 180 ticks, the scenario's declared mix, the AGV floor's `amr` transport class):
193 units, 1,175 events, 35 delivered, eight stations at 1.82 (staging), 0.83 (pick faces)
and 1.28 (pack stations) ticks per unit — the stage sums equal the wms capacities — and no
floor-rate flag on the glance. `?example=c` and a button load it; `sw.js` precaches it; A
and B are byte-identical (built before the scenario modules load). `tools/ledger_env.mjs`
is the one headless loader; the fixture script gained `reconcile <dir>`.

**Precision.** `ledger.js` records `service_ticks` and `minute` unrounded (A and B
unchanged: 1 / 0.02 is exactly 50 and a minute is a tick at 60 per hour) and sums every
cost total with compensated (Neumaier) arithmetic; SQLite's `SUM()` has been compensated
since 3.43.0. `python tools/run_ledger.py reconcile <export> --js <rows>` measures SQLite
against the JavaScript rows of 13 views column by column: 5.6e-17 on A and B, 1.1e-13 on
C, over 111 columns. Tolerances tightened from 5e-4 to one step in the fourth decimal
(1e-4) where both sides are compensated; CI reconciles every fixture on every push.

**Verification.** +1 harness (`verify_precision.js`, 24 checks), +4 Python (unrounded
round trip, the reconcile tool by hand, every fixture reconciled through node, fixture C at
declared capacities), viewer self-test +3 (example C: no floor-rate flag; the compare names
the different scenario). 72 harnesses, 106 Python tests, WT-SELFTEST 178/178 + viewer
26/26. Cache wt-v123.

## v3.42 — One gate, in CI too

**The gate.** `python tools/gate.py` runs every check a release must pass — the headless
harnesses, the Python tests, ruff, the generated-SQL check and both in-browser self-tests
(`index.html?selftest=1`, `run-ledger.html?selftest=1`) through a headless Chromium-based
browser it finds itself, served over http on a free port — prints one scoreboard and the
README line-9 sentence, and with `--check-readme` fails when the counts drift from what was
measured. A missing `WT-SELFTEST:` line is a failure; the browser gets its own profile.

**CI.** New `verify-browser` job (ubuntu's Chrome) runs both self-tests and the README
check on every push; a weekly schedule re-runs every job. The maintainer checklist and
the production notes name the gate, list the viewer's suite and carry no stale count
(`ALL 29 HARNESSES`, `57/57`, `22/22` were all wrong).

**Verification.** +1 harness (`verify_gate.js`, static: the gate's flags and browser drive,
the CI job and schedule, README line 9 against the runner's list and `sw.js`, the docs),
+5 Python (`test_gate.py`: parse/render inverses, the scrape, the drift check, a browser
lookup that never raises). 71 harnesses, 102 Python tests, WT-SELFTEST 178/178 + viewer
23/23. Cache wt-v122 (no bump: no app-shell change).

## v3.41 — The report, and the guide

**`report`.** `tools/run_ledger.py report --database db [--run R] [--runs A B] [--out report.md]`
writes one run as deterministic Markdown: header, the at-a-glance row (units, events,
delivered, received, in flight, pallets, parcels, trailers, cost total / per unit / per
received each / per delivered each) with the data-quality flags, every planner view as a
table (`md_table`, `run_id` dropped), the cost detail with the rates, the invariants with
`Invariant violations: 0`, the six compare tables when `--runs` is given, the honesty
text. `docs/examples/run-report.md` is the committed example (fixture A against B) with a
freshness test; CI imports both fixtures, writes a report and checks the generated SQL.

**Guide.** `docs/RUN_LEDGER_SCHEMA.md` §7 walks the viewer section by section (what it
shows, the defining view, the proving harness); README links the example report.

**Verification.** Python +5 (the report names every planner view and the run, a hand row,
the compare section, `md_table` escaping, the detail-view groups; the committed example is
fresh). 70 harnesses, 97 Python tests, WT-SELFTEST 178/178 + viewer 23/23. Cache wt-v122 (no bump: no app-shell change).

## v3.40 — Cost that answers the question

**Holding cost.** `analytics.defaultRates()` gains `holdingPerUnitHour: 0` (a fourth rate
row in the Analyze panel; the cost analyzer ignores it and says so); `ledger.ratesBlock`
carries `holding_per_unit_hour`; `ledger.costs` charges a waiting span's ELAPSED hours x
the rate as `holding_eur` (labour still charges the station's service time). SQL:
`rate.holding_per_unit_hour` (guarded migration for older databases, named-column
insert), `v_span_cost` gains `held_hours` / `holding_eur`, `v_cost_by_hu` /
`v_cost_by_type` / `v_cost_by_location` gain `hours` and `holding_eur`, the totals
include it; `v_compare_cost` unchanged (its totals include it). The honesty text now
reads "queue time costs no labour; a holding cost is charged only if you set one".

**Per received each.** `v_cost_by_type` and `ledger.costs` gain `eaches_in` and
`eur_per_received_each` beside `eur_per_each`; the viewer's cost section gains a fourth
card and the columns, the glance shows both, and a flag says when no holding cost is
set. The planner's flow card shows the run's cost so far (total, per unit, the split),
recomputed only when the recording grew.

**Verification.** Python +2 (holding by hand: A +0.0667 -> 17.2699, B 0, C 0, face
1.2393, eaches received 576 / 576 / 3, 0.03 and 0.8221 per received each, linear in the
rate; an old-schema database gains the column and the current view text); the fixture
SQL == JS test covers the new columns; `verify_cost_ledger.js` +2 hand checks; viewer
self-test +1. Fixtures A and B and `run-ledger-sql.js` regenerated (run ids unchanged).
70 harnesses, 92 Python tests, WT-SELFTEST 178/178 + viewer 23/23. Cache wt-v122.

## v3.39 — The viewer as one report

**Defects.** The SQL shown under the viewer's tables was hand-typed and had drifted from
the SQLite views in nine places (two compare texts were `...` placeholders, `v_span_cost`
was not runnable, `v_cost_by_hu` named a column that does not exist, two views left
columns unaliased, the invariant views had another shape, `v_cost_by_hu` was never
shown). The run card printed the order mix as `NaN %` (the recorder's mix is a list).
"Your case" could hang the browser on a transient keystroke (a case side of 4 mm gave
~10^9 pinwheel combinations), fired twice per change and accumulated listeners on every
load. `views()` ran three times per load and the cost model up to five. The SQLite tool
kept old view text in an existing database (`CREATE VIEW IF NOT EXISTS`). All fixed.

**Generated SQL.** `tools/export_viewer_sql.py` writes `run-ledger-sql.js` from
`run_ledger.VIEWS` - every text the statement SQLite runs, minus the CREATE VIEW
prefix - loaded first on the page; `RunLedger.SQL` is that object. Tests: the committed
file equals a fresh render (stale = red), every key is a view and every body its DDL
minus the prefix with no placeholder, and every text RUNS in SQLite as shown. The tool
drops and recreates its views on every open; `views --all` prints `DETAIL_VIEWS`.

**One report.** `run-ledger.html` restructured into ten sections with a sticky nav, a
skip link and an appendix (how to read the page; reproduce commands filled in for the
loaded run). New *The run at a glance* (`RunLedger.glance`): identity, mix, totals,
cost, invariants and the data-quality flags - no rates; stations at the floor rate
(`FLOOR_SERVICE_TICKS` = 1 / flowsim's `minStationServicePerTick`, asserted); units
still in flight. `RunLedger.model(exp)` memoises views / ribbon / flow links / costs /
Sankey per export object. One `fmtCell` for every cell (money 2 dp, per-each 4 dp,
capex as money); minutes beside ticks as display-only derived columns (no view gains a
column). `<th scope="col">`, focus to the glance after a load, `aria-label` on the
flow figure, an auto-fit card grid, a print stylesheet with SQL expanded on
`beforeprint`, a CSV button on every table (`RunLedger.csv`, RFC 4180, raw values),
`?example=a|b`, an `rl:loaded` event and `RunLedger.whenLoaded()`. `errors.js` and the
app's CSP now guard the page. "Your case" debounced (150 ms) and bound once; `pack.js`
`fourBlock` caps block thickness at six (7^4 combinations at most; the ten profiles
unaffected, asserted).

**Viewer self-test.** `run-ledger-selftest.js`, inert unless `run-ledger.html?selftest=1`:
drives the real buttons, waits for `rl:loaded`, checks every section, no error text,
every SQL block complete, one flow path per link, the cost cards, print + CSV, the memo,
the derived columns, "Your case" reacting to input, the compare after B and all 23 SQL
blocks; reports with the `WT-SELFTEST` contract and `data-page="run-ledger"`.

**Verification.** `verify_run_ledger_view.js` +17 (section 5). Python +3. Viewer self-test
22/22. 70 harnesses, 90 Python tests, WT-SELFTEST 178/178 + viewer 22/22. Cache wt-v121.

## v3.38 — Stacking strength, the pinwheel and your case

**Stacking strength.** `pack.js` `bct(ect, caliper, perimeter)` - the simplified McKee
formula, 5.874 x ECT x sqrt(caliper x perimeter), newtons with ECT in kN/m and lengths
in mm, `inRange` false outside the published range (height >= perimeter / 7, footprint
ratio <= 3 : 1); `STACK_FACTORS` with the published derating options (90 days under
load 0.6, a year 0.5; 85 % RH 0.6, 90 % RH 0.5; 25 mm overhang 0.68; column in
practice 0.85, interlocked 0.5) and `stackFactor`; `stackLoadKg` (the cases above the
bottom case plus each pallet on top with its tare share); `safeLayers`. `tiHi(pallet,
box, maxStackMm, caseKg, board, factors, stack)` reduces the layers until the bottom
case stays within its allowable load and reports `strengthLimited` and a `strength`
block (BCT, allowable, load, utilisation, safe layers). Every profile declares a
synthetic `board` or an honest `evaluated: false` note; `casesPerPallet` does not pass
the board, so every simulated quantity is unchanged - and at the default factors no
profile is strength-limited anyway (asserted). The fixed-capacity cage now reports
`stackMm: 0` (a v3.34 gap).

**The pinwheel.** `fourBlock(L, W, bl, bw)` - Steudel's four-block layout: cases with
their long side along each edge, pinwheel-fashion, the hole filled with the best grid /
band layer, thicknesses enumerated, deterministic tie-break, overlap-free by
construction. `bestLayer` uses it only when it packs strictly more than both the grid
and the bands; on the ten profiles x the standard pallets it never does (the harness
prints where it would). Hand case: 1000 x 1000 with 600 x 400 -> 4 against bands 3.
`layerRects` draws it.

**Viewer.** The packaging section states the strength verdict with its arithmetic (or
'not evaluated' with the reason); the optimisation table shows the bottom-case load of
its allowable per candidate and 'strength' as a limit; the new *Your case* section
(`RunLedger.yourCase`) ranks a case of your own on every pallet, draws the best layer
and states the verdict. The export's profile block carries the board.

**Docs.** `docs/PACKAGING_OPTIMISATION.md` §2 gains the sources (Steudel 1979; McKee,
Gander & Wachuta 1963 with the validity range; the derating guidance), §3.6 the
pinwheel, §3.7 stacking strength with the worked arithmetic, §4 rewritten.

**Verification.** `verify_stacking.js` (31 checks, every number written out by hand:
2,197.85 N; 36 and 81.125 kg; 0.6 and 0.085; 134.47 kg, 23 and 11 layers; the pinwheel
4 / 3 / 2 with overlap-free rectangles; no profile changed and none strength-limited
at the defaults, the grocery tray at 90 % RH for a year; the 40 kg / ECT 3 carton
limited to 3 layers; your case; wiring). Self-test +1.
70 harnesses, 87 Python tests, WT-SELFTEST 178/178. Cache wt-v120.

## v3.37 — Compare two runs

**Paired tables.** `RunLedger.compare(A, B)`: the viewer's tables for two exports paired
key by key (order type; bench + operation) with deltas B - A - summary, cycle time,
touches, station wait, dispatch, cost. Keys are the union of both runs (a key seen in
one run only survives with the other side and the delta null); a run without rates
compares with null cost; a different scenario or profile sets `same_scenario` false.

**SQL.** `v_compare_summary`, `v_compare_cycle`, `v_compare_touches`, `v_compare_wait`,
`v_compare_dispatch`, `v_compare_cost`: one row per ordered pair of runs in the database
and key, LEFT JOINs over a unioned key set (no FULL OUTER JOIN, so SQLite 3.12-era CI
runs them); `compare(db, a, b)` and the CLI `compare --database db --runs A B [--out]`.

**Fixture B.** `tools/make_run_ledger_fixture.mjs [a|b|all]` builds a second recorded run
on the same floor and seed with a cross-dock-heavy mix (`run-ledger-b.json`, `.stats`,
`.views`); the run id differs because the hash covers the mix. Precached.

**Viewer.** A second file input and *Compare with recorded example B*; the section
*Compare two runs* with A / B / delta tables, both runs' ids and mixes, the like-for-like
flag and the six SQL texts.

**Finding.** On the fixture floor the cross-dock-heavy day delivers 16 units (8,676
eaches) against 8 (2,461) in the same 300 ticks, at 296 EUR against 350; cross-dock cycle
time is identical (107 ticks) and case-pick cycle time falls by 62 ticks because the
single staging pad is less contended. A finding about that floor, not a recommendation.

**Verification.** `verify_run_compare.js` (24 checks: the hand pair with every terminal
event 10 ticks later - cycle +10, touches and dispatch unchanged, cost +6.1656 per
delivered unit, the return untouched, the reverse pair negated, a key in one run only,
no rates, a different profile; the recorded pair - fixture B byte-identical to a fresh
run, different id, same scenario, invariants, cross-dock the largest type, every row
the pairing of views(A) and views(B); wiring). Python +3, self-test +1.
69 harnesses, 87 Python tests, WT-SELFTEST 177/177. Cache wt-v119.

## v3.36 — The flow, as recorded

**Links from the ledger.** `ledger.js` `flowLinks(exp)`: per pair of operations, the
units whose consecutive NON-queued events moved from the one to the other (a queued
event is a wait, not a move; a unit's two events at its terminal operation collapse),
with the retired units and the eaches that left the from-operation; `sankeyFromLedger`
builds the model (nodes in the operation catalogue's order; links in units, retired
units only, or eaches). Same definition as the SQL view `v_flow_links` (LEAD over each
unit's versions), proved equal on the hand ledger (six links) and the recorded fixture
(26 links), plus the identity units entering X = units recorded at X - units that
started at X, in JavaScript and in SQL.

**Layered Sankey.** `analytics.js` `sankeyLayoutLayered` / `sankeySvgLayered`: a
branching network - columns by longest path from the sources (Kahn's order), nodes
stacked per column with a gap, a bar as tall as the larger of what enters and what
leaves it, every ribbon in its own slice ordered by where it goes / comes from, the
scale set by the tightest column, a cycle flagged and its back-links outlined. The
linear `sankeyLayout` / `sankeySvg` are untouched: `verify_analytics.js` now freezes
them with golden sha1 hashes of a hand model (light, dark, geometry).

**Viewer and planner.** `run-ledger.html` gains *The flow, as recorded* (units / retired
only / eaches, the link table, the SQL) and loads `analytics.js`; the planner's Analyze
card draws the recorded network under the stage-model Sankey once a run has a ledger.

**Verification.** `verify_ledger_flow.js` (34 checks: the hand links and columns,
geometry - no overlap, slices inside bars, width proportional, one dominant - on hand
and recorded models, conservation over retired units and in >= out over all, the
entering identity, no back-links because every route is acyclic, eaches mode, a
synthetic cycle flagged, wiring). Python +3, self-test +1.
68 harnesses, 84 Python tests, WT-SELFTEST 176/176. Cache wt-v118.

## v3.35 — What a handling unit costs

**Spans and costs.** `ledger.js` `spans(exp)` / `costs(exp[, rates])`, computed from the
export alone so the viewer, the fixture script and the harness share one definition
with the SQL. A span is the time between two consecutive events of a unit: waiting
when the first is `queued` (queue + service, inseparable in the sim), moving
otherwise. A waiting span is charged the station's service time (1 / its service
rate), whatever the unit waited - queue time costs nothing; a moving span is charged
in full at the class of mover the floor contains (AGV, forklift, conveyor; none =
free). Per span: hours x labour rate (manned classes: racking = a picker, workstation,
forklift; the staging pad is manned with no equipment class) + hours x capex /
amortisation years / operating hours per year + hours x kW x energy price. Rounded
only at the aggregates (4 dp).

**Export.** `locations[].service_ticks` (1 / the station's service rate, null off a
station) and an optional `rates` block (`ratesBlock`: labour, energy, hours per year,
transport class, the equipment catalogue with a manned flag, the type -> class map
for every element type on the floor, an honesty line). Schema id unchanged; a file
without rates simply has no cost. `app.js` passes the Analyze panel's rates at
create; `analytics.js` exports `TYPE_TO_CLASS`. The recording is byte-identical with
and without rates (asserted).

**SQL.** `tools/run_ledger.py`: tables `rate`, `equipment_rate`, `location_class`,
`location.service_ticks` (guarded migration for older databases); views `v_spans`
(LEAD over each unit's versions), `v_span_cost`, `v_cost_by_hu`, `v_cost_by_type`
(euros per unit and per delivered each), `v_cost_by_location` (+ one internal-
transport row). `summary` and `views` include the two aggregates.

**Viewer.** `run-ledger.html` loads `ledger.js` and gains *What a handling unit
costs*: this run / per unit / per delivered each, cost by order type, cost by location,
the rates in the file (classes with euros per hour, the type -> class map), the
disclosure; a unit's trace shows what it cost so far. `RunLedger.SQL` now carries all
16 views the SQLite tool defines - `v_run_summary`, `v_version_gaps` and
`v_terminal_violations` were missing although the page said otherwise.

**Finding.** The recorded fixture costs 349.74 EUR for 39 units over 300 ticks, 92 %
of it labour, because the hand-built floor declares no stage capacities: every
station serves at the floor rate of one unit per 50 ticks, and the staging pad alone
books 175 EUR. Disclosed on the page, not tuned.

**Verification.** `verify_cost_ledger.js` (31 checks: the hand ledger's spans and money
written out by hand - 17.2032 + 9.2484 + 2.4663 = 28.9179 by type = by location, rates
linear in each input, zero-duration spans free, no rates -> no cost; the recorded run's
waiting spans only at the three stations each charged 50, spans of every retired unit
= its cycle, the committed views.json, byte-identical sim with and without rates,
every route ends in a terminal kind; wiring). Python +5 (spans and money by hand,
linearity, empty without rates, SQL == JavaScript on the fixture), self-test +1.
67 harnesses, 81 Python tests, WT-SELFTEST 175/175. Cache wt-v117.

## v3.34 — Packaging optimisation, and the routing stations on generated floors

**Band layouts.** `pack.js` `bandDP` / `bestLayer` / `layerRects`: the one-dimensional
knapsack over strips (Smith & De Cani, 1980), tried in both band directions and used
only when it packs strictly more than the single-orientation grid. It recovers the
standard layers a plant stacks: 5 KLTs (600 x 400) per layer on an industrial pallet
(bands 600 + 400 = 3 + 2), 10 cartons (400 x 300) per layer on 1200 x 1000 (bands
400 / 300 / 300 = 4 + 3 + 3, a perfect tiling). `tiHi` now reports `pattern` and the
`layer`; `optimizeProfile` ranks every pallet for a profile and states the gain.
Profile consequences: automotive 25 KLTs per pallet (was 20), bulky 15 (was 12); every
other profile unchanged, so the recorded fixture is byte-identical.

**Viewer.** `run-ledger.html` gains *Optimise the pallet pattern*: the ranked
candidates with layers, cases, gross weight, cube utilisation and the binding limit;
the current and best layers drawn from their rectangles; the what-if on the run's own
pallet-borne eaches (inbound pallets and trailers now vs with the best pattern). The
packaging section now draws the real layer (grid or bands) instead of a grid guess.

**Generator.** `generateLayout(key, { stationsForRouting: true })` places QC bench,
depalletiser and returns bench in receiving and wrapper and value-add bench in packing
with the zone-bounded free-spot search the scenarios use; `meta.routingStations` lists
what was placed and what was skipped. The Generate panel has the option, on by
default. Without it the output is byte-identical to before.

**Docs.** `docs/PACKAGING_OPTIMISATION.md` (the question, sources with what is real
and what is synthetic, the pattern model with worked examples, what is deliberately
not modelled, how to reproduce) and `docs/RUN_LEDGER_SCHEMA.md` (identities, the
export, every SQL view and invariant).

**Verification.** `verify_pack.js` +5 hand-computed checks (bands 10 and 5, the EUR
grid keeps 8, ten non-overlapping rectangles inside the deck, optimizeProfile gains);
`verify_gen_stations.js` (6 checks over every profile x 3 seeds: placed or honestly
skipped, overlap-free, compliance never FAILs, the full mix routable wherever all
five were placed, byte-identical without the option, wiring); viewer harness +2.
66 harnesses, 76 Python tests, WT-SELFTEST 174/174. Cache wt-v116.

## v3.33 — The run-ledger viewer: the whole run, start to finish

**What.** `run-ledger.html` + `run-ledger.js` + `run-ledger.css`: an offline page that
draws one recorded run from the `factory-run-ledger/v1` export - the run card, the
packaging hierarchy with the ti-hi pallet pattern drawn from the profile (plan +
elevation), a start-to-finish ribbon per order type (units and pallets / cases /
eaches / parcels at every operation, arrow width = eaches, form underneath), cycle
time / touches / station wait / WIP over time / quantities per operation, the dispatch
manifest with trailers drawn slot by slot, a unit trace with SSCC + GTIN-14, a
waiting-vs-moving timeline and every event, and the invariants with the SQL that must
return zero rows. Loads the recorded example, a chosen file, or a run handed over from
the planner (new *Open in the run-ledger viewer* button; localStorage hand-over with a
size guard). `RunLedger.views / ribbon / trace` are pure and mirror the SQLite views.

**Verification.** `verify_run_ledger_view.js` (26 checks): the hand-built ledger with
hand-computed cycle times, touches, waits, WIP, quantities, dispatch and ribbon; the
recorded fixture's summary equal to the app's stats and every invariant zero; one lane
per route; corruption surfaces; wiring, precache at wt-v115, offline-guard rules.
Rasterized and inspected in headless Chromium. 65 harnesses, 76 Python tests,
WT-SELFTEST 174/174.

## v3.32 — The run ledger, and its SQL

**What.** `ledger.js` records the live simulation as an append-only event stream: one
record per handling unit (RUN / ORD / HU ids, SSCC, GTIN-13, GTIN-14, packaging
profile, eaches received) and one event per operation passed (created, queued, served,
passed, delivered / restocked / scrapped) with pallets, cases, eaches, parcels, retained
and scrapped quantities and the equipment the operation happened at. It is a pure
observer on a new after-tick hook: the sim is byte-identical with or without it; a
tick that serves a unit and moves it on, or a unit that passes several waypoints in
one tick, is recorded in full and in order. Stations now carry the element they are;
anchors carry the ids they bound to. The flow card gained the run id, per-type counts,
a per-unit trace and a JSON export (`factory-run-ledger/v1`, with the floor's element
types so SQL can classify locations).

**SQL.** `tools/run_ledger.py` (standard library): import (idempotent per run), the
planner views `v_run_summary`, `v_cycle_time_by_type`, `v_touches_by_type`,
`v_station_wait`, `v_wip_by_tick`, `v_quantities_by_op`, `v_dispatch`, the invariant
views `v_conservation_violations`, `v_cross_dock_violations`, `v_version_gaps`,
`v_terminal_violations`, a bounded read-only `query`, and a JSON `summary`.
`tools/make_run_ledger_fixture.mjs` regenerates the committed fixture deterministically.

**Verification.** `verify_ledger.js` (32 checks: identities, consecutive versions,
exact route walks, conservation at every event, exact element locations, the SQL
invariants in JS, determinism, byte-identical sim, no mutation, simulated time,
wiring). `test/test_run_ledger.py` (14 tests: a hand-built ledger with hand-computed
cycle times, touches, waits, WIP, quantities and dispatch; every invariant empty, then
a deliberate corruption makes each fire; idempotent re-import; bounded query; the
recorded fixture's SQL summary equals the JavaScript stats). 64 harnesses, 76
Python tests, WT-SELFTEST 174/174. Cache wt-v114.

## v3.31 — The packaging hierarchy and the numbering system

**Why.** A ledger, an SQL query and a viewer need two things the simulator did not
have: quantities with real units (how many eaches, cases, pallets a unit is) and
identities that mean the same thing in every layer and reproduce on re-run.

**pack.js.** Unit loads with the public dimensions (DIN EN 13698 EUR / industrial /
half pallets, VDA 4500 KLT footprints, 33 / 26 pallets per 13.6 m trailer); a ti-hi
pattern optimiser (best orientation, height limit, load limit, cube utilisation, every
pallet ranked); trailer fill; ten per-industry packaging profiles mapped onto every
library scenario; and `quantitiesAlong(profile, archetype, ops)` - the pallets /
cases / eaches / parcels a handling unit carries at every operation, with what stayed
in stock and what was scrapped, conserving eaches at every step.

**ids.js.** Deterministic `RUN- / ORD- / HU- / EVT-` identities (the run hash covers
layout + seed + mix) and GS1 SSCC / GTIN-13 / GTIN-14 / GLN with the mod-10 check digit.

**Honesty.** Profile values are synthetic teaching values; the optimiser is informed by
practice, not a load plan; the GS1 prefix is GS1's documentation prefix.

**Verification.** `verify_pack.js` (38 checks, all against hand-computed numbers:
8 x 6 = 48 cartons on EUR at 90.6 % cube, 20 KLTs, 144 pharma cartons, a 40 kg carton
weight-limited to 32, SSCC 340123450000000017, GTIN 4012345678901, conservation across
every archetype x profile, no id collisions across the library). Self-test gains one
check and two module shapes. 63 harnesses, 62 Python tests, WT-SELFTEST 172/172.
Cache wt-v113.

## v3.30 — R3: the goods follow the operation, not the stage

**The defect.** v3.23 drew every handling unit in the form of its STAGE (receiving =
wrapped pallet-load, storage = carton, picking = tote, packing / shipping = parcel).
Honest for the single legacy spine, where the stage implies the operation; false the
moment v3.29 let units walk their own recipes - a full pallet in "storage" is still a
pallet, a cross-dock unit never becomes a carton, a return does not arrive as a pallet.

**The fix.** `goods.js` gains `OP_FORM`, a closed table of the TRANSFORMING operations
(depalletise -> cartons, pallet-pick -> pallet-load, case-pick -> cartons, piece-pick /
pick -> tote, pack -> parcel, palletise -> pallet-load, wrap -> wrapped-pallet, restock ->
carton); every other operation keeps the incoming form. `formAlong(route, op, queued)`
walks the unit's own route to the operation it last passed (excluding it while the
unit waits in that station's queue) from an honest start form: a pallet-load off the
trailer, a parcel for a return, a case on the shelf for a route that starts in stock.
`formFor(mu, route)` uses it on any non-legacy route and the stage chain otherwise, so
with no mix declared every form is byte-identical to v3.23 - asserted at every tick.
A new `wrapped-pallet` form (the pallet-load envelope, six film bands and a sheen edge)
makes a wrapped dispatch pallet read differently from the inbound load it started as.
`flowsim.makeRoute` now carries `startsInStock`. Units stay conserved; appearance only.

**Verification.** `verify_forms.js` (25 checks): the table is closed against the
routing operations; hand-derived form sequences for all eight archetypes and both
returns outcomes; waiting semantics; a 600-tick live run of the full mix in which a
cross-dock unit is a pallet-load at every tick, a full pallet is never a carton / tote /
parcel, a case-pick unit is seen as cartons after the depalletiser and as a wrapped
pallet after the wrapper, every return arrives as a parcel, and the drawable units
carry exactly the model's forms; legacy byte-identity; a drawing smoke of the new form
at every tier in both themes. Self-test gains one check. 62 harnesses, 62 Python
tests, WT-SELFTEST 169/169. Cache wt-v112.

## v3.29 — R2 + R4: the missing stations, and the order mix goes live

**The defect.** v3.25 built a per-order routing engine with eight order archetypes,
but it was a DARK capability: nothing in the app ever declared an order mix, so every
live run still walked the single legacy spine - and three of the eight archetypes
(case pick, each pick, value-add) could never be routed on ANY floor, because no
depalletiser or value-add bench existed and goods-in QC had to borrow the returns bench.

**R2 - the missing stations.** Three new element types - `qc-bench` (Goods-in QC
bench, 3x2, 1.1 m), `depalletiser` (3x3, 2.4 m) and `vas-station` (Value-add /
kitting bench, 3x2, 1.1 m) - registered in the domain and palette order, the shape
registry (2D glyph + 3D form + icon), iso heights, floor stage tint, library groups
and clone bases, the workforce roster (benches manned with the bench pose, the machine
unmanned), the goods carrier surfaces and the analytics equipment catalogue. The
router binds `depalletise -> depalletiser`, `vas -> vas-station` and `qc -> qc-bench`,
borrowing the Returns / QA station only when no QC bench is placed and disclosing it
on the step. Nothing is "pending" any more; palletising still borrows the stretch-wrap
element - a documented gap. Route review now ranks a MISSING station above fallback
geometry (a recipe with an absent station is unroutable, not merely approximate).

**R4 - the order mix.** Every one of the 22 warehouse scenarios declares a realistic
mix of order types (synthetic teaching shares) and carries the stations that mix
needs, so the declared mix is 100% routable on that floor - asserted for all of them.
The signature plant declares the full seven-type mix and grew to 933 elements over
32 warehouse types. The Live material flow card gained an Order-mix picker (this
layout's declared mix / a realistic day / standard spine only; remembered on this
device) and a readout block with per-type share, spawned, in-flight and done counts
plus the routes the floor cannot serve, naming the element to place. A layout's mix
rides on `config.orderMix` through save, share and export; a layout without one stays
byte-identical.

**Unchanged by construction.** With the standard spine selected (or no mix declared)
every run is byte-identical to v3.28 - the legacy-collapse harness still proves it
across all 31 layouts; the chain-issue badge on every scenario is unchanged.

**Not done yet.** Goods on the floor still change form by STAGE (v3.23), not by
operation - a case-pick unit is not yet drawn as a carton after the depalletiser (R3).
Keyword-generated floors do not place the new stations; the readout names what to
add. The shares are illustrative, not a forecast.

**Verification.** 61 headless harnesses (two new: `verify_stations.js`, 41 checks
including hand-computed anchor centroids on a hand-built floor and a live run of the
full mix; `verify_ordermix.js`, 20 checks over every scenario), 62 Python tests,
WT-SELFTEST 168/168 in headless Chromium (two new checks). Cache wt-v111.

## 2026-09-21 — Docs reconciled against the merged Codex review branch

Merged the 2026-09-19 review branch (PR #1, 40 commits) into main. The README's
per-feature notes had accumulated the harness, browser-check, Python-test and cache
counts of the moment each feature landed; they now point to one measured block at
the top of the README. Measured on this commit: 59 headless harnesses,
62 Python tests, WT-SELFTEST PASS 166/166 in headless Chromium, cache wt-v110.
Entries below keep the counts that were true when they were written. Moved the
v3.27 and v3.28 entries, which had been appended after v3.1, to their place above
v3.26. Fixed run-together words in the README (Cachewt-v86, above1000, at10:05).
No code changed.

## 2026-09-19 — Stable identities for legacy imports

Equipment without string IDs now receives deterministic import-N identities in file order. All explicit IDs are reserved first, including those later in the file, so generated IDs cannot collide with them. Input records are not mutated. Cache wt-v110.


## 2026-09-19 — Reject ambiguous imported equipment identities

Layout loading rejects duplicate or blank explicit equipment IDs before modifying custom definitions or the current floor. Legacy records without string IDs retain generated-ID behavior. This is an identity preflight, not complete atomic import validation. Cache wt-v109.


## 2026-09-19 — Rebuild playback after curved conveyor rotation

Playback signatures now include equipment identity and curved-belt orientation. A square conveyor can change direction without changing its bounds; Play/Step now rebuild the model in that case. Existing geometry invalidation and KPI stale markers remain. Cache wt-v108.


## 2026-09-19 — Preserve geometry when shrinking the floor

The manual Resize control rejects dimensions that would exclude equipment or reserved areas. Rejection leaves the layout intact and explains what must move. Successful resizing pauses playback. Internal blank-factory creation remains a separate path. Cache wt-v107.


## 2026-09-19 — Manual placement constraints

Shared reserved-area and fixed-object checks now guard manual placement, dragging, nudging, duplication, resizing and rotation. Invalid drafts block edits; a conflicting object can move to a permitted location. Accepted edits pause playback. Imports, generation and floor resizing remain outside these guards. Cache wt-v106; local wt-v105 was not published.


## 2026-09-19 — Direct Play and equipment drag-and-drop

The floor now exposes Play/Pause, Reset, speed and elapsed time without opening
a simulation menu. Default preview speed is 60x so the minute-bucket model visibly
advances each second. Library and Add-menu equipment can be dragged onto the floor;
existing placement bounds, overlap and tier checks remain in force. Starting a drag
from isometric switches to editable 2D. Added resource-view stop times in seconds,
minutes, hours and days, plus exact seeking. Offline precaching now requests fresh
assets on a version upgrade to avoid mixed HTML/script versions. Cache wt-v104.

## 2026-09-19 — SQL package snapshots in resource playback

Resource scenarios can now derive endpoints and package contents from a read-only
SQLite snapshot. Expected versions and one-package-per-job associations are checked.
The viewer validates embedded event history and displays recorded package state
separately from planned movement. Added a SQL-linked synthetic example; cache wt-v100.
This does not execute work or reserve current database resources.

## 2026-09-19 — Scheduled workers and loads in the browser

Added resource movement playback linked from the planner and transfer history.
One clock, scrubber and 1x–100x speeds drive all checked worker/load positions in
plan or isometric projection. Imports verify geometry, return paths, resource
ownership, skills, calendars and logical area capacity. Bundled example and new
viewer assets are in PWA cache wt-v99. Planned scenario IDs remain separate from SQL.

## 2026-09-19 — Geometry-driven resource motion

Connected directed route timing to resource dispatch and continuous worker/load
positions. Explicit return paths determine repositioning time; loads remain at
their sources until handling begins. Calendar and shared-area waits retain the
same schedule. This is a CLI/library foundation, not browser or SQL integration.

All notable changes to WarehouseTwin (Logistics Flow Studio) are recorded here.
Dates are ISO (YYYY-MM-DD). Every figure the app produces is a **synthetic,
seeded teaching heuristic unless you import your own data** — informed by public
standards (ISO 22400, DIN 15185, ASR, EN, VDI), not a certification and not a
measurement of a real site.

## 2026-09-19 — Visible scene inspector and local guide

Added an initially visible Factory assistant, with grounded rule-based answers
and explicit disconnected-model status. Package and worker selection marks the
same display coordinates in both projections and exposes position, heading and
stage. Worker poses remain illustrative; persistent history, telemetry and SQL
identity integration remain future work. PWA cache wt-v84. All 54 harnesses,
157 browser checks and 11 Python tests pass; deterministic PDF output unchanged.

## v3.28 — Time-based playback and SQL execution prototype

Added 1x–100x speed, minutes/hours/days duration and exact stopping. Replaced
frame-count advancement with an elapsed-time clock; retained minute-bucket model
semantics. Added local transactional SQLite order/pick prototype and primary-source
competitor comparison. Cache wt-v83. No claim of autonomous safety approval or
real-time physical transport accuracy.

## v3.27 — Editable shift workbench

Added Plan a shift at the top of Simulate: two factory profiles, live workload,
stock and electricity findings, grouped editable assumptions, JSON import/export,
and explicit separation from the floor simulation. Added numerical and browser
regressions; cache wt-v82. No scheduling or engineering-safety claims.

## v3.26 — Review the equipment behind an order route

The Live material flow panel now shows each recipe as an ordered review, including missing and unsupported operations, shared benches, fallback positions, and both returns outcomes. An empty floor can still resolve the legacy animation, but the review correctly reports equipment gaps. Simulation behaviour and existing numeric baselines are unchanged.

The panel uses the existing router and anchor counts; it does not certify feasibility or switch playback routes. Corrected stale UI copy denying the queues already present in the engine. Added primary-source factory research with explicit future-work boundaries. New route-review harness and real selector exercise; cache wt-v81.

## v3.25 - EVERY PACKAGE TAKES ITS OWN PATH (order-driven routing, R1: the engine)

**The defect.** `flowsim.js` hardcoded ONE spine - `receiving -> storage -> picking ->
packing -> shipping` - and pushed EVERY handling unit onto that same waypoint list.
There were no order types, no quality control, no depalletise or palletise step, and
`stretch-wrap` was a placeable object rather than a routing step. Every package took
the same cookie-cutter path.

**The engine.** New `routing.js` (`WT.routing`) makes the ORDER decide the path.

- **20 OPERATIONS** - the atomic things that happen to goods (receive, goods-in QC,
  depalletise, put-away, replenish, pallet / case / piece pick, tote consolidation,
  value-add, pack, palletise, stretch-wrap, outbound staging, load, returns inspection,
  restock, scrap). Each declares the ANCHOR that performs it, the flow STAGE the unit
  reports while doing it, the STATION kind that serves it, and the FORM the unit takes
  afterwards (the hint R3 turns into operation-driven goods drawing).
- **8 ORDER ARCHETYPES**, each declaring the OPERATION SEQUENCE it requires - not a
  stage list. Full pallet out (receive > QC sample > put-away > pallet pick >
  stretch-wrap > load, and NEVER depalletised, NEVER packed); case pick (+ depalletise,
  then consolidated, palletised and secured rather than re-packed - full cases ship as
  five); cross-dock (receive > QC > staging > load, and it NEVER enters storage);
  customer returns (receive > inspect, then a REAL two-outcome split to restock or
  scrap); value-add (pick > kitting / labelling > pack > load); export / fragile
  (pick > extra QC > palletise > wrap > load); and `legacy-spine`, the v3.24 path,
  kept as the DEFAULT.
- **A router** that resolves an archetype's operations against the anchors the CURRENT
  layout actually has. Where an operation has no station, the order type is
  UNFULFILLABLE and says so in plain language naming the element to place - it is
  never silently skipped and never silently re-routed (the `process.js` `validateFlow`
  / `fluids.js` discipline). `WT.flowsim.routingReport(layout)` gives the
  per-archetype fulfillability read for a floor.
- **Per-MU routes replace the single spine.** Each unit carries its own waypoint list,
  its archetype and its current operation. The STATIONS stay global, so two order
  types that both cross the pick face contend for ONE physical FIFO queue and
  congestion stays real. Units are conserved exactly as before - globally AND per
  order type, at every tick.
- **Deterministic by construction.** Which archetype a unit is, is a largest-remaining-
  QUOTA dispatch over the declared mix - the same rule `process.js` uses at a multi-way
  split. No `Date`, no `Math.random`; a route is a pure function of order identity and
  layout.

**Backward compatibility is a hard gate.** With no mix declared the plan carries
exactly ONE route - the legacy spine - whose waypoint array IS the plan's own. Proven,
not asserted: the generic route builder fed the legacy operation list reproduces
`buildWaypoints` waypoint for waypoint, and a 250-tick loop run plus a 400-tick pool
run are byte-identical with and without the legacy mix, across all 31 example,
generated and preset layouts in the repo.

**Honesty.** The route recipes are SYNTHETIC teaching models informed by ordinary
distribution-centre practice, not a WMS and not measured order-profile data. Two
operations currently borrow a SHARED anchor because the app has no dedicated element
yet - goods-in QC on the Returns / QA bench, palletising on the Stretch-wrap /
palletiser - and every shared binding is disclosed on the step and in the report.
`depalletise` and `value-add` have no element type at all, so the archetypes needing
them are honestly unfulfillable until R2 ships the stations.

### Honesty defect corrected in the same release: DIN 15185 -> ASR A1.8

The app cited **DIN 15185** as the source for **working-aisle widths** in the advisor
rule, the canvas guard, the standards panel, the Compliance Check (including the
`guideline` field exported into reports), the knowledge base, both optimizers and the
docs. **That citation was wrong.** DIN 15185 covers floor tolerances and person
protection in guided narrow aisles - not working-aisle geometry - and its part 2 is
withdrawn.

Every aisle-width attribution now reads **ASR A1.8** (*Verkehrswege*, 2022-03), whose
construction is: widest transport means or load, plus a lateral safety margin on each
side (**0,50 m** vehicles only, **0,75 m** where pedestrians share the route below
20 km/h), plus a **0,40 m** meeting allowance - reducible to **1,10 m** total where
encounters are infrequent (~10/h) - with a clear height of at least **2,00 m**.
DIN 15185 stays in the standards panel as **landscape context only**, with its real
scope and an explicit note that no feature is informed by it (the same pattern the
panel already used for VDI 2510).

**The published 2.9 m default is NOT changed, and here is why it is worth knowing.**
Applying the ASR A1.8 construction to a reach truck whose widest envelope is ~1,27 m
gives about **2,67 m** for vehicle-only traffic and **3,17 m** where pedestrians share
the route. The app's 2.9 m sits **between** the two. It is therefore a truck-class
teaching value, **not** a figure derived from the rule, and it is now documented as
such in `domain.js`, the knowledge base and `docs/DOMAIN_NOTES.md` rather than being
silently adjusted. A real design must be worked from the actual truck and load
envelope and the traffic mix.

`verify_compliance.js` now asserts the aisle finding is attributed to `ASR A1.8` and
that `DIN 15185` no longer appears in the Compliance Check's guidelines list;
`verify_compare.js` and `verify_report.js` assert the same of the exported honesty
strings.

**Gates.** 50 headless harnesses green (new `verify_routing.js`), browser self-test
153/153 (4 new order-routing checks), offline guard clean, `sw.js` at `wt-v80` with
every `verify_*.js` pin synced on both regex sides.

**Informed by, and honest about the gap.** The recipes follow the German process
decomposition the trade guidelines use (goods receipt, quality assurance, returns,
put-away, storage + replenishment, picking, packing, dispatch, empties) and the
guideline-described unit-transformation chain. Informed by, NOT compliant with, NOT a
certification. The engine states its own limits in `routing.js`: each archetype's
operation order is FIXED (practice says the sequence is not necessarily determined and
steps may be omitted); QC is a pass-through step rather than a branch into blocked
stock; returns has two outcomes here where practice distinguishes four; replenishment
is a step inside the each-pick sequence rather than the order-independent LOOP it
really is; and dangerous goods, the cold chain as a routed zone, the empties
counter-flow, second-stage batch sortation and dispatch-label application are not
modelled at all. Expressing the loops needs a directed graph, which is a later step.

**Still to come.** R2 the missing station types (QC bench, palletiser, depalletiser,
VAS/kitting bench, consolidation buffer); R3 the visual truth (units visibly diverging
by order type, operation-driven goods
forms); R4 order-pool integration and per-archetype KPIs.
## [3.24] — 2026-08-14

**The plant reads like a working shift.** v3.21 gave the hall its materials,
v3.22 put people in it and v3.23 made the goods physical. Four things still
gave the floor away as a diorama, and new `shift.js` (`WT.shift`) fixes all
four as **one strictly read-only drawing layer** over the flow sim: it adds
**no model, no number and no export**, it never writes a byte of sim state,
and every position is a pure function of (layout, plan, sim state, element
identity, the sim's own tick). Structure is untouched and every saved
scenario stays **byte-identical**.

**1 · Manned trucks actually haul.** v3.23's own honest limitation was that a
forklift / reach truck **body** was static in `shapes.js` — only its forks
cycled. It was the one piece of the plant drawn moving without ever going
anywhere. Now it works:

- it takes a load at its bay, drives out along the aisle **in the direction
  the sim's own plan routes material** (a flow-direction field over the plan
  polyline, snapped to the dominant axis, because aisles are axial), raises
  the forks at the far end, sets the pallet in, **turns**, and comes back
  with the empty pallet on the tines;
- the haul lane is **marched against the real layout** at half-cell steps and
  stops about half a truck short of whatever blocks it, so the body stays out
  of the racking and only the **tines and the pallet** reach into the face —
  which is what putting a load away looks like. A truck with nowhere to go
  keeps working its forks on the spot, exactly as in v3.23;
- the cycle is a **closed loop** whose position, heading and fork height are
  continuous at every step boundary and across the wrap (verified over a
  4000-sample sweep) — no pop, anywhere;
- with **no clock** (a stopped plant, or `prefers-reduced-motion`) every truck
  is parked at its own bay centre, squared up, forks down, loaded: *exactly*
  the picture v3.23 drew;
- the load rides the travelling tines through the **same pose** the body is
  drawn at, so a pallet can no more drift off a moving truck than off a
  parked one; RGV and AGV keep their existing in-footprint lane travel, and
  all three now resolve through one pose model.

**2 · Congestion you can see, without strobing.** v3.22 deferred the
per-station queue read and shipped a coarse stage-level latch instead,
because an integer queue depth crosses its threshold many times a second and
anything bound straight to it *flickers*. The fix is a filter, not a latch,
in three layers:

- **smooth** — `level` is an exponential average of `queue / threshold`,
  integrated in **sim time** in the analytic form, which makes it *exactly*
  invariant to how that time is chopped into frames (advancing 1 tick once
  and 0.5 ticks twice against the same observation are bit-identical), so the
  plant cannot look different on a faster machine;
- **Schmitt trigger** — the three-state band (clear / building / backed up)
  rises at one threshold and falls at a lower one, so a level sitting on a
  boundary must travel the whole dead band to come back;
- **minimum dwell** — a band that has just changed is frozen for 48 sim
  ticks, which puts a hard ceiling on how often *any* station can change its
  read.

Against a queue that crosses the threshold on **every tick for 900 ticks**
the band changes **zero** times; against a square wave slamming from empty to
double the threshold *faster than the dwell*, it tracks the signal but never
changes twice inside the dwell. **The number stays raw:** the queue count on
the badge and every KPI remain the sim's own instantaneous value — only the
paint is deliberately slow.

The same signal drives the **workforce**: a station's pace rides its smoothed
level, and a genuinely starved station (behind its own 1.5 s dwell) puts its
worker into the idle cycle — the per-station busy/idle v3.22 had to defer.
Pace is handed to `workers.js` as an **integrated effective work clock**
rather than a speed multiplier, because scaling the raw tick by a speed that
changes mid-run *teleports* the phase — a pose pop of hundreds of ticks. The
integrated clock is monotone and Lipschitz by construction, so the pace can
change without the pose moving. And a genuinely deep queue is now spread
further back along the sim's own route, so real congestion reads as a **line**
instead of a pile on the eighth place.

**3 · Dock realism.** A door that is working has a **trailer** backed onto
it, its shutter up, a leveller plate bridging the gap and empty pallets
stacked on the apron; a door that is not stays shut. Which one you see is the
sim's own stage occupancy through the same smoother with a **two-second
dwell**, so a trailer never blinks — and with the plant stopped nothing is
drawn at all.

**4 · The paint agrees with the flow.** v3.21 stencilled travel arrows down
every painted aisle, but their direction came from the geometry of the facing
*pair*, which is arbitrary — half the paint could point against the traffic.
Each arrow is now flipped to agree with the direction the sim actually routes
material past that point (same place, same size — only the sign changes). And
an **andon** lamp reduces the run to the three states a real plant signal
shows, as **shape + colour + words** (never colour alone), on the flow panel
that already exists — read off the *smoothed* bands, so the lamp cannot
flicker either.

**One model, both views.** The truck, the trailer and the apron are oriented
boxes through the caller's `project(x, y, heightM)` — the plain world→px map
top-down, the iso projection in 2.5D — painted by `WT.workers`' own box
painter, so the trucks, the goods and the people are literally the same
geometry code. LOD-gated (culled below the glyph tier), view-culled top-down
and capped, so the mega hall stays smooth.

**Gates:** all **49** harnesses pass (new `verify_shift.js`, 14 checks: the
flow-direction field and arrow orientation; haul lanes that never cross an
element; truck path continuity over the cycle and the wrap; the no-clock
static frame; finite, in-bounds poses on two plants including the
894-element mega hall plus garbage-safety; **the anti-strobe guarantee** on
three signals; frame-rate invariance; the Schmitt dead band; the monotone
work clock; strict read-only over sim state with conservation intact; dock
geometry and the no-blink door; a draw smoke through both projectors ×
themes × LOD tiers; determinism with no `Date` / `Math.random` in source *or*
live exports; and the andon, the honesty label and the shipped wiring). The
in-browser self-test grows 140 → **149**; the offline guard is clean; the
cache is bumped to `wt-v79` with every `verify_*.js` pin synced.

**Honest limitations.** This is an ILLUSTRATIVE schematic animation of
warehouse work. The trucks are **not** a fleet model and the haul cycle is
**not** a duty cycle — one truck per placed forklift element, driving a lane
derived from the layout, on a fixed-length cycle. The trailer is a generic
schematic box showing the **rear section** at the door (a real 13.6 m trailer
continues outside the drawn frame), not a vehicle spec and not a brand. The
congestion bands are a **drawing filter** over the existing synthetic queue
heuristic — not a measurement, not a queueing-theory result and not a KPI. A
hauling truck is drawn as an overlay after the blocks, so it is not occluded
per-pixel by what it passes behind (the same limitation the workforce and the
flow boxes have always carried), and its top-down footprint plate stays put
as the marked bay it drove out of. Still to do: a truck does not yet steer
round a corner (its lane is one axis), and the docks model no turnaround time
and no yard.

## [3.23] — 2026-08-14

**The goods are physical.** Since P3 the material flow has been a swarm of
abstract stage-coloured squares — and a warehouse does not move squares. New
`goods.js` (`WT.goods`) is a pure, deterministic model that turns every
handling unit the flow sim *already carries* into the object it actually is at
that point in the chain, and puts it on the surface that is carrying it.
Structure is untouched, every saved scenario stays **byte-identical**, and this
layer adds **no model and no number** — it is strictly read-only over the
existing sim.

**What a unit looks like at each stage** (mapped onto the sim's *own* stage
machine — nothing is invented):

| stage | form | the real event |
|---|---|---|
| receiving | wrapped **EUR pallet-load** — three bottom runners, a boarded deck, three tiers of kraft cartons, stretch-wrap film bands | a loaded pallet comes off the inbound trailer |
| storage | **kraft carton** with a taped seam | the put-away station **depalletises** it |
| picking | moulded **plastic tote** — lip and hand grips, signal blue with a red in the mix | cartons are **picked** into a tote |
| packing | taped, labelled **parcel** | the tote is **packed** |
| shipping | **parcel** | parcels are **loaded** on the outbound trailer |

The form changes exactly where the sim's own FIFO server does the work: a unit
**waiting** in a queue still shows the form it arrived in, and becomes the next
thing at the instant the station *serves* it. **Units are conserved** — this is
a change of *appearance only*: one MU stays one MU, so flowsim's invariant
(spawned == in-flight + completed) is untouched.

**Riding the active components.** A support index over the layout records the
belt top of every conveyor, curve, track and sorter, the deck of every RGV and
AGV, and the top of every pack bench — so a carton on a belt is drawn at **belt
height**, not floating over the floor. Because the sim already routes along the
conveyor cell centres (and along a curved conveyor's quarter-arc), a unit
follows the belt **round the bend** with its nose pointing the way it travels.

**Queues back up nose-to-tail.** A waiting unit is no longer stacked in a pile:
the queue extends *back along the sim's own route*, one unit length plus a
bumper gap per place in it, so congestion looks like congestion. The queue's
order, length and service rate remain entirely the sim's.

**Trucks carry the goods.** A forklift, RGV or AGV carries a pallet on its
forks or deck, moved by the **same lane parameter and the same animation phase**
its own carriage is drawn at — and a reach truck's forks *raise* with the load
and come back down empty.

**Racks show stock.** The rich tier's **existing** deterministic fill pattern is
scaled by the storage stage's share of the live flow, clamped inside the shape
registry's own `RICH_FILL` bound — the same slots, emptying and refilling in the
pattern's own order. No second inventory model, no new number, and byte-identical
to before whenever the plant is not running.

**One model, both views.** Every corner goes through the caller's
`project(x, y, heightM)`, so a unit is a solid oriented box with a contact
shadow on its carrying surface in 2.5D and a correctly oriented plan shape
top-down, by construction. The oriented-box painter and the kraft are
`WT.workers`' own (`boxFaces` + PPE) — the carton on the belt is literally the
same code and the same board as the carton in a worker's hands.

LOD-gated and culled (a cheap stage-coloured mark when a unit is a couple of
pixels across, a solid form at normal zoom, the full pallet at rich zoom, and a
*uniform* degrade above the drawing budget so the largest hall stays smooth);
deterministic (no `Date`, no `Math.random` — the clock is the sim's own tick, so
a paused plant and `prefers-reduced-motion` both resolve to a legible static
frame). Illustrative only: nominal generic handling-unit dimensions used as
drawing constants — **not** CAD/BIM, **not** a survey, **not** a measurement.

New `verify_goods.js` harness (48th); the browser self-test gains 7 checks
(140/140); the offline guard is clean; the cache is bumped to `wt-v78` with
every `verify_*.js` pin synced.

## [3.22] — 2026-08-14

**The plant has people in it, and they do their job.** Since v2.1 a "worker"
was a head disc and a shoulder bar bolted onto the furniture of a pack bench:
it could bob, it could not *work*. This release gives the floor an actual
workforce. New `workers.js` (`WT.workers`) is a pure, deterministic **pose +
gait model** — an articulated 1.75 m figure (hips, knees, feet, shoulders,
elbows, hands, head) placed by two-link IK and driven by named **work cycles**,
one per station type. Structure is untouched (no rail/drawer/panel change),
every saved scenario stays **byte-identical**, and nothing here feeds a KPI.

**What a worker actually does now.**
- **Pick face** — walks to the face with a real alternating gait and
  counter-swinging arms, **bends and reaches in**, straightens with a **kraft
  carton in its hands**, carries it back at chest height and sets it down. The
  reach height is stable per element, so a rack row is picked at *several*
  levels — and the body follows the hands: a floor-level face is a deep bend
  with the knees in it, a chest-level face is barely a lean.
- **Pack / processing bench** — draws the goods in, works over the bench
  (hands working at the carton), sweeps a tape gun **one-handed** across it
  while the other hand stays put, then pushes the finished parcel away and
  reaches out for the next one.
- **Staging (put-away)** — carries a carton in at chest height, places it,
  straightens, walks back empty, takes up the next one.
- **Dock door** — steps up to the door, **raises a handheld** above the
  shoulder, reads the label, lowers it and steps back.
- **Nobody is a mannequin.** A stationary worker still has a weight shift and
  breath; and a stage that has no goods in it yet stands **idle** until the
  shift wakes (latched per run, so a queue flickering around zero can never
  strobe the poses).

**The gait is driven by travel, not by the clock.** The stride phase is
`distance / stride length`, so a worker crossing a longer leg takes *more*
steps; the stride amplitude follows the leg's own speed profile, so the feet
come together as they arrive. Every cycle is a **closed pose loop** (each
step's end pose is the next one's start), verified over a fine sweep — there
is no pose pop at any step boundary or at the wrap.

**One skeleton, both views.** Joints live in a body frame (forward / lateral /
up, in metres) and are projected through the caller's
`project(x, y, heightM)` — the plain world→px map top-down, the iso projection
in 2.5D — and solid parts (torso, carton, tote, scanner) are drawn as
**oriented boxes** through that same projector. So from above you look down on
the shoulders and see the feet swing fore and aft; from the 2.5D camera the
same skeleton stands up; and a pick reads as a pick in both **by
construction**. The head's on-screen size is *measured* through the projector,
so the 2.5D figure never gets a balloon for a head.

**Hi-vis that reads at distance.** An EN ISO 20471-family yellow-green vest
with a retroreflective band, work-shirt sleeves that read *against* the vest,
dark trousers, safety boots, a hard hat and a deliberately **neutral head — no
skin tone, no gender, no identity is modelled** — all outlined in near-black,
which is what actually keeps a 7 px figure legible on the daylit slab *and*
the night shift (asserted at ≥ 3:1 as non-text UI in both themes). Full detail
(knees, elbows, helmet, reflective band, taped carton, contact shadow) only at
the zoomed-in tier; figures are culled entirely below the glyph tier,
view-culled top-down and capped at 64, so a big hall stays fast.

**Deterministic by construction.** No `Date` and no `Math.random` anywhere in
`workers.js` — the clock is the flow sim's own tick, so the workforce freezes
exactly when the sim pauses, and a null clock (plant stopped, or
`prefers-reduced-motion`) gives every worker the legible **standing** pose
their cycle rests at, never a leg-in-the-air freeze.

**Two fixes that fell out of the work.**
- Manned stations no longer draw a person welded into the glyph; they draw the
  **work in progress** — a carton that travels the bench and closes as it is
  made up (2D and 2.5D). People are their own layer now.
- **The dark-theme glyph pen was broken, and had been for a while.**
  `shade()`/`lighten()` hand back CSS `rgb(r,g,b)` strings while the colour
  parser only understood hex, so *every* `rgba(lighten(...))` call — which is
  the whole dark-theme pen — parsed `"rg"`/`"b("`/`"21"` as hex and collapsed
  to the **same dark crimson for every element**, whatever its material. That
  is the "interior strokes read redder than intended" note from v3.21: the
  dark pen now really is each element's own material colour, lightened.

**Gates:** all **47** harnesses pass (new `verify_workers.js`, 15 checks over
the pose/gait geometry: roster correctness + determinism + cap, finite and
bounded joints over full cycles, the gait laws, cycle continuity, the pose
matching the station, the load being in the hands, the reduced-motion static
frame, a draw smoke through both projectors × themes × tiers with no input
mutation, both views agreeing, no clock/RNG in source *or* live functions, the
honesty labels and the shipped wiring); `verify_shapes.js` gains a check
pinning the dark-theme pen; the in-browser self-test grows 125 → **133**; the
offline guard is clean; the cache is bumped to `wt-v77` with every
`verify_*.js` pin synced.

**Still honest about what this is:** an ILLUSTRATIVE schematic animation of
warehouse work — not motion capture, not ergonomics or biomechanics, not a
labour standard, not a measurement of anyone's workload, and the
one-worker-per-manned-element roster is a drawing heuristic, **not** a staffing
recommendation. The goods themselves are still the abstract stage-coloured
flow boxes; turning those into real pallets, cartons and totes riding the
equipment is the next step (A3).

## [3.21] — 2026-08-14

**The design correction: this is factory work, not a drafting tool.** The
v3.20.1 craft pass dressed the simulator as a *blueprint* — deep-blue slate
chrome, a blue-black canvas, cyan hairline grid, candy-pastel element tints.
Every one of those choices named the wrong subject. A plant floor is not an
IDE, and this release re-tokens the whole product to the **material world of a
factory**. Structure is untouched (the rail + drawers + icon-expand layout is
the user's own choice); nothing about behaviour, copy or serialization changes,
and **every saved scenario stays byte-identical**.

**The canvas is a plant floor.**
- The slab is **poured concrete** — a warm neutral gray with a deterministic
  *exposed-aggregate* speckle. The stones come from a pure, seeded function
  (`WT.floor.concreteSpecks`; no `Date`, no `Math.random`) baked once into an
  8 m repeating tile, so painting the whole hall costs a single `fillRect` no
  matter how large it is, and the same layout pours an identical slab on every
  run and every machine.
- The 5 m lines are **saw-cut control joints** with a chamfer highlight.
  Concrete really is poured in ~5 m bays and cut so it cracks where you choose
  — which happens to be the model's own major grid step, so the measurement aid
  and the material finally agree instead of arguing.
- The markings are **paint**: 100 mm safety-yellow aisle lines with stencilled
  travel arrows, 75 mm white zone borders, and a 150 mm black/yellow hazard
  hatch on every dock apron. All of it is *scuffed* by a deterministic wear
  function, because paint in a working plant gets driven over. None of it is a
  CAD hairline any more. The aisle paint is promoted from the **same**
  facing-pair model the compliance aisle check uses, so the paint on the floor
  can never disagree with the rule that governs it.
- Equipment gains a **contact shadow** so it stands *on* the slab instead of
  being drawn on top of it, and the building shell reads as a clad steel wall.
- **High-bay lighting** is modelled only where it is real: warm sodium/LED
  pools on the night shift, and *nothing added* to the evenly-lit daylit hall
  (every attempt to model daylight pooling either washed the concrete out to
  paper or left square seams where the gradients met — restraint was the
  correct answer, not more paint).

**Colour is material, not decoration.** 51 element types are re-toned off the
candy/blueprint ramp onto real materials: orange-red painted rack uprights on
galvanised steel beams, machine gray with safety-orange guards, kraft board,
pallet timber, and genuine plant signage (amber = attention, red = stop, green
= running). `shapes.js` gains a shared `MATERIALS` vocabulary so the 2D glyph
and the 2.5D form can never disagree; rack **beams are steel whatever the
uprights are painted**; and what sits on a rack is now wooden pallets and kraft
cartons rather than tinted copies of the rack's own hue. Blue survives only
where it is honest — plastic totes, cold-store and fluid cues, and ISO 7010
*mandatory-action* blue for the selection ring. No brands, no trademarks: every
motif stays a generic industrial schematic.

**The chrome is a machine console.** The rail is a powder-coated steel column
with brushed-metal separators, recessed lit keys, a condensed silk-screened
label set, an amber indicator keel on the engaged tool and a green ready LED.
Neutrals are warm concrete/steel throughout — in **both** themes, because a
night shift is not blue.

- **Light = daylit hall**, **dark = night shift**: the slab recedes into warm
  light pools while the machines and the painted lines stay lit.
- **Accessibility:** every text pair is WCAG AA in both themes, with the ratios
  *computed* and asserted live by the extended self-test — including the
  console's own ink against the powder-coat it sits on (11.3:1 / 5.3:1) and the
  indicator LEDs at ≥ 3:1 as non-text UI. `prefers-reduced-motion` is honoured
  exactly as before.

**Gates:** all 46 harnesses pass; the in-browser self-test grows 118 → **125**
checks (7 new: console tokens present, console ink AA on the powder-coat,
neutrals provably warm rather than blue-dominant, the canvas material palette
complete in both themes, concrete/paint determinism, a structural clock/RNG-free
scan of the material layer, and the shapes material vocabulary theme-complete);
`verify_floor.js` adds 13 checks over the new pure geometry; the offline guard
is clean across 97 files; the cache is bumped to `wt-v76` with every
`verify_*.js` pin synced.

**Honest limitation:** the material identity is a *rendering* correction. It
changes no number, no model and no export — capacities, KPIs, compliance
outcomes and the IFC geometry path are exactly what they were in v3.20.2.

## [3.20.2] — 2026-08-14

**The tier default is now `full`.** A first-time visitor used to meet a
component library with most storage systems padlocked, because the
demo/full showcase gate (`tiers.js`) defaulted to `demo`. This deployment
is a portfolio showcase, not a sales funnel, so the complete library — all
14 storage systems, every slotting strategy, the MRO preset, CSV import,
the floor-plan underlay and the unabridged advisor — is what the app opens
with.

The gate itself is untouched and still a first-class feature: the header
button now reads **"Switch to demo"**, and flipping it re-applies every
capability limit exactly as before, so the engineered entitlement split
(one capability-flag module, no scattered `if`s) stays demonstrable on
demand. Only `tiers.js`'s `current()` fallback changed — no capability
list, no behaviour, no copy, no serialization, and every scenario stays
byte-identical. `lsp/verify.js` now pins the new default *and* proves the
demo gate still bites by stubbing the entitlement store, and
`PUBLISH_ANDROID.md` §C states the default plus what a real paid
deployment would do instead. Cache `wt-v75`.

## [3.20.1] — 2026-08-12

An **award-level visual craft pass** — "industrial control room": the dark
canvas is the hero, chrome recedes, colour stays reserved for state. Entirely
**within** the established rail / multi-open-drawer structure (nothing
restructured), with **no behaviour, copy, or serialization change** — every
scenario stays byte-identical.

### Changed
- **Design-token layer** (`styles.css`): ink-role text tokens
  (`--accent-ink` / `--ok-ink` / `--warn-ink` / `--danger-ink`) so every
  status-coloured **text** pair passes **WCAG AA** in the light theme
  (accent-as-text was 2.77:1 on white → 5.93:1; ok 3.30 → 5.02;
  warn 3.19 → 5.02; ratios **computed**, and asserted **live** by the
  self-test) while the vivid base tokens keep painting borders and tints, so
  signal stays saturated where it isn't text. Dark inks equal the base
  colours (8.3–10.7:1 — already passing), so dark is visually unchanged.
  Plus: a disciplined **three-step elevation ladder** (`--shadow` resting
  card, `--shadow-2` docked drawer, `--shadow-3` floating panel —
  slate-tinted in light instead of dead black), **one** shared
  uppercase-label tracking token (`--track-label`, replacing 25 ad-hoc
  0.03–0.06 em values), and motion tokens (`--ease-out`, `--dur-1/2`).
- **Instrument typography**: KPI numerals are now tabular
  (`font-variant-numeric: tabular-nums` on `.kpi-value` / `.proc-kpi-val`)
  so a live readout never wobbles column-to-column; display-size KPI values
  get a touch of negative tracking.
- **Canvas craft** (`app.js`): a refined **selection affordance** — the one
  selected element earns a soft accent halo plus four corner ticks (glow is
  reserved for state that demands attention; nothing else on the floor
  glows); **stage-glow discipline** — only a *congested* flow station gets a
  halo, calm stations stay flat; **per-theme grid contrast** — dark 5 m
  major lines step up (`#2b3d5c → #34486b`) so the dark floor reads
  structured, light 1 m minors recede (`#e8edf3 → #eaeff5`) so placed
  elements pop. All deterministic — no time input, no RNG.
- **Micro-interactions**: a 1 px hover lift on rail icons authored *inside*
  `prefers-reduced-motion: no-preference` (reduce never sees it), an accent
  keel on the active rail tool, and drawer open/close riding the shared
  ease/duration tokens.
- **Empty-state composition**: a radial vignette focuses the welcome card
  while the floor grid stays legible at the edges; confident display-title
  tracking; the three action glyphs sit in quiet tinted chips. Same copy.

### Verification
- Self-test extended **114 → 118**: design tokens present, tabular KPI
  numerals, **live-computed** WCAG AA contrast on the ink tokens, and both
  reduced-motion guards in the shipped stylesheet.
- `sw.js` cache bumped `wt-v73 → wt-v74` (version-history trail preserved);
  all six harness cache pins synced. All 46 harnesses green; offline guard
  clean; no external assets (system font stacks only).

## [3.20.0] — 2026-08-10

Closes the two minor gaps the v3.17–v3.19 releases documented: (a) the CRAFT
placement optimizer still consumed the **stored** from-to arc rates even on a
declared multi-way process network, and (b) the per-element **fluid rate
overrides** were honoured in-memory by the v3.19 steady-state solver but
**dropped by the serializer**.

### Changed
- **CRAFT placement derives F from the resolved flow network**
  (`optimize_factory.js`): when the process block declares a **valid
  multi-way network**, `buildFD()` now builds the from-to flow matrix F from
  the **resolved arc flows** (`WT.process.resolveFlow` — the same numbers
  `metrics()` reports: split shares, merge accumulation, gozinto through
  assembly/dismantle) instead of the stored `process.routing` rates, so the
  placement objective **MHI = Σ F·D** weighs each arc by the
  material-handling intensity that actually flows on it. On the
  `machining-qa-split` archetype the 60/40 QA branch arcs weigh
  **72 / 48 parts/hr** at the offered 120/hr — even when the stored rates
  have gone stale (harness-proven: tampering every non-source arc's stored
  rate to 1/hr leaves the whole craft report **byte-identical**). A **plain
  chain** (every existing scenario) and an **invalid** declared network
  (already rejected by `validateFlow` with the friendly message) keep the
  stored rates on the **exact pre-v3.20 code path** — a full hand-written
  pin proves the chain craft report is **byte-identical** (MHI 3400 → 2200,
  one B↔C swap, no new keys). The never-illegal / never-worse guarantees
  are re-asserted on the resolved basis (independent legality oracle:
  in-bounds, overlap-free, DIN 15185 aisle count never increased; MHI
  monotone non-increasing; deterministic). `buildFD` reports the basis
  (`flowBasis: "resolved" | "stored"`); the craft report carries the key
  **only** on the resolved path so every existing output stays
  byte-identical.

### Added
- **Per-element fluid rate overrides persist** (`fluids.js` + `app.js`): the
  override keys the steady-state solver reads (`rateM3h`, `flowRateM3h`,
  `capacityM3`, `fillPct`, `inputs`) now survive save / load / share.
  `WT.fluids.overridesOf` / `WT.fluids.applyOverrides` are the single
  sanitizing source of truth (rates/capacity clamped ≥ 0, `fillPct` clamped
  0–100, mixer `inputs` a whole number ≥ 1; junk ignored; **non-fluid
  elements are never touched**). `serialize()` writes an override **only
  when actually set** on a fluid element — a layout with no overrides
  serializes **byte-identically** to before (asserted across all 24 example
  scenarios) — and `deserialize()` restores them. Hand-computed round-trip:
  the demo pipe's **30 m³/h** cap survives save → load (delivered 30 m³/h,
  tank full in **96 min**), where the v3.19 serializer silently reverted it
  to the 40 m³/h registry default (delivered 40, full in 120 min).
- **Role-aware rate fields in the existing Inspector** (Behaviour group —
  the established grouped-Inspector pattern, **no new panel, no redesign**):
  a Fluid source gets *Supply rate (m³/h)*, a conduit (Pipe / Portioner /
  DePortioner) *Flow capacity (m³/h)*, a Tank *Capacity (m³)* + *Fill level
  (%)*, a Mixer *Input streams*. Setting a value stores the override on
  that element; clearing the field (or re-entering the declared default)
  removes it, so the element serializes exactly as before.
- **Verification**: new `verify_craftflow.js` harness (the **46th**, wired
  into `test/run-all.mjs`, 38 checks, all expectations hand-computed): the
  full byte-identical chain-craft pin, the resolved 72/48 F matrix, the
  stale-stored-rates invariance proof, F ≡ resolveFlow arcs (can't
  diverge), an independent MHI recomputation, the never-illegal /
  never-worse oracle on the resolved basis, the invalid-network stored
  fallback, the override sanitization table, the 30-vs-40 m³/h round-trip
  proof and the example-scenario byte-identity sweep. Two new in-browser
  self-test checks (now **114/114**): the live serialize → deserialize
  override round-trip through the real app path, and the resolved-flows F
  matrix on the live `machining-qa-split` build.

### Honesty
- The optimizer remains a transparent **heuristic finding a local optimum**
  — modelled, not measured; NOT guaranteed optimal, NOT a validated
  discrete-event simulation, NOT CAD/BIM, NOT a certification. The fluids
  model remains a **steady-state analytical model** — NOT CFD, NOT
  hydraulics, NOT transient dynamics. Rates (including overrides) are
  synthetic teaching values the user edits.

### Infrastructure
- `sw.js` cache `wt-v72` → **`wt-v73`** (changed `optimize_factory.js`,
  `fluids.js`, `app.js`, `selftest.js`; no asset added or removed); the
  `verify_hardening` / `verify_palette` / `verify_analytics` /
  `verify_animation` / `verify_fluids` cache pins bumped to match.

## [3.19.0] — 2026-08-10

Gives the Fluids / process-industry component family (placeable since v3.7,
but static) its **deterministic continuous-flow behaviour** — the last big
functional parity item on the roadmap. Everything is a **steady-state
analytical model**: computed as closed-form arithmetic over the connected
component network — **no time stepping, no RNG, no clock**.

### Added
- **Fluids steady-state continuous-flow solver** (`fluids.js` → `WT.fluids`):
  fluid components that **touch** (a shared footprint edge ≥ 1 m; corner
  contact does not connect) form a network; multi-source BFS hop distances
  orient every junction from the drain-farther to the drain-nearer element
  (ties broken by source distance, then element id — a total order, so the
  directed network is **provably acyclic** and nothing ever flows into a
  source or out of a drain). Two analytical passes solve it: a **backward
  acceptance** pass (how much each element can accept and eventually deliver
  to a drain or buffer in a tank — a dead end accepts 0) and a **forward
  flow** pass (sources push their declared rate up to acceptance; at a
  branch, flow **splits equally capped by each branch's acceptance**, the
  excess re-filling unsaturated branches — deterministic water-filling, a
  documented model rule).
  - **Sources** produce at their declared `rateM3h`; supply the network
    cannot carry is reported as **curtailed** (back-pressure — an overflow
    risk at the source, with a plain-language warning).
  - **Pipes** carry up to `flowRateM3h`; a saturated pipe is named the
    **bottleneck** (utilisation 100 %).
  - **Tanks** buffer: `capacityM3` + `fillPct` give the free volume, and the
    net fill rate yields the **overflow horizon analytically** — *"fills at
    +50 m³/h, FULL in 96 min at current rates"* is free volume ÷ net inflow,
    pure arithmetic.
  - **Mixers** blend their input streams with **exact ratio conservation**
    (out = sum of ins; blend shares reported) and are flagged **starved**
    when fewer live input streams arrive than their declared `inputs`.
  - **Drains** consume; **Portioner/DePortioner** pass flow through
    conserved (their continuous↔discrete dosing is *not* modelled).
  - **Volume conservation is VERIFIED at every node** (in + produced = out +
    consumed + buffered + curtailed; residual reported — the same checked-
    not-assumed discipline as `resolveFlow`), and the network totals close:
    supply = delivered + buffered + curtailed.
- **Read-out in the existing Factory line efficiency card** (`#fluidsReadout`
  filled by `renderFluidsReadout()` — the v3.17 flow-rows pattern: **no new
  panel, no UI redesign**): network totals (supply → delivered / buffered /
  curtailed), the named bottleneck, per-element steady flows, tank fill
  horizons, and every warning (overflow risk / starved / dead end / no
  supply) in plain language. It refreshes with the panel and on every layout
  mutation, and renders **empty** for any layout without a connected fluid
  network.
- **A hand-computable demo** (`WT.fluids.demoLayout()`): 40 + 40 m³/h
  supplies → mixer blends 80 → 200 m³ tank at 60 % → pipe capped 30 m³/h
  (the bottleneck) → drain receives 30; the tank fills at +50 m³/h → FULL in
  **96 min**; conservation residual 0.
- **Verification**: new `verify_fluids.js` harness (the 45th, wired into
  `test/run-all.mjs`, 31 checks, all expectations hand-computed): the demo
  steady state, asymmetric mixer blending (60/20 → shares 0.75/0.25),
  capacity curtailment (40 offered → 30 carried, 10 backing up), terminal-
  tank fill time (120 min), branch water-filling (80 → 30/50), the starved-
  mixer / no-supply friendly messages, **collapse to the base case**
  (untouching fluid components = zero metrics; **every example scenario
  stays fluids-inactive and byte-identical** — `analyze()` is read-only and
  adds nothing to the serialize), determinism (byte-identical re-runs; no
  `Date`/`Math.random` in the source), the honesty labels, and the shipped
  wiring. Three new in-browser self-test checks (now **112/112**): the
  `WT.fluids` module shape, the demo computing + rendering in the live card,
  and the read-out staying inert/empty on a non-fluids layout.

### Changed
- `sw.js` cache `wt-v71` → **`wt-v72`** (new `fluids.js` in the app shell);
  `index.html` loads `fluids.js` before `app.js` and ships the
  `#fluidsReadout` container inside the existing Factory line card.
- Existing behaviour is otherwise untouched: **every existing scenario,
  example, generated layout and panel is byte-identical** — the solver only
  activates for layouts that actually connect fluid components into a
  network, and unconnected fluid components stay exactly as static as
  before.

### Honesty
- A **steady-state analytical model — modelled, not measured**. **NOT a
  validated process simulation, NOT CFD, NOT hydraulics** (no pressure,
  viscosity, head loss or pump curves), **not transient dynamics** (tank
  levels are a linear horizon at the current rates, drain-down / pull demand
  is not modelled), and **not a certification**. Rates are the components'
  synthetic order-of-magnitude teaching values; the equal-split branch rule
  is a documented model convention, not a hydraulic computation.

## [3.18.0] — 2026-08-08

Closes the two follow-up gaps the v3.17 release notes acknowledged: (a) the
factory layout **generator** could not emit a multi-way network (`derive()`
builds linear chains only — multi-way entered only via JSON import or the
demo), and (b) the optimizer consumed multi-way **metrics** but its **RPW
line-balancing** heuristics remained chain-oriented.

### Added
- **A fourth factory baseline that emits a genuine multi-way process network
  from the generator** (`generate.js`): **“Machining shop with QA split
  (multi-way flow)”** (`machining-qa-split`), selectable in the existing
  Generate flow (Factory mode), matched by generator keywords (“qa split”,
  “inspection split”, …), reachable from the command palette and from the
  plain-language *“use the machining-qa-split baseline”*. It lays out a
  machining feed lane (2 stations), **two QA branch stations** (the arms of a
  declared **60/40 split**) and a **pack-and-finish merge** step, and — new —
  **emits the matching `process` block from the generator itself**
  (`gen.process`, adopted by the app instead of the derived linear chain):
  operations bound to the placed elements (`op-<elementId>`, the `derive()`
  convention), split ratios declared on the arcs, accepted by
  `WT.process.validateFlow`, canonical under `sanitize`, ratio-preserving
  through the serialize round-trip. Hand-computed and harness-pinned at the
  offered 120 parts/hr: arc flows **120/120/72/48/72/48/120**, effective times
  **30/30/24/32/25 s** per finished unit, bottleneck **QA deep test** at 32 s
  → **112.5 parts/hr**, line efficiency 141/160 ≈ **88.1 %**, conservation
  residual ~0. Deterministic and seeded (the seed is recorded; the line
  composition is a fixed function of the profile — the same convention as
  every factory baseline). Reserving the branch lane emits **no** block (the
  app falls back to the honest derived chain — never a broken network).
- **RPW line balancing on resolved per-finished-unit effective loads**
  (`optimize_factory.js`): the balancer’s task times are now the **same
  numbers `WT.process.metrics` reports** — on a chain, the gozinto- and
  servers-weighted `cycle × cyclesPerFinished / servers`; on a declared
  multi-way network, `resolveFlow`’s proportional-flow effective times (a
  60 %-share QA branch weighs 0.6 × its cycle) — instead of raw chain cycle
  times. On the generated QA-split line this packs **[Machining 1+2] = 60 s /
  [QA deep + QA fast] = 56 s / [Pack] = 25 s** — the **theoretical minimum**
  of 3 stations (a raw-cycle balancer cannot see that the two branches
  together load only 56 s per finished unit). The RPW precedence walk is a
  DAG walk, so both branches of a split rank and pack correctly, and the
  packing respects precedence across the split and merge.
- **Verification**: new `verify_flowbalance.js` harness (the 44th, wired into
  `test/run-all.mjs`, 39 checks) — the generated block’s hand-computed
  resolved flows/metrics, byte-identical legacy builds, the reserved-lane
  fallback, a **full hand-written pin proving the pure-chain RPW output is
  byte-identical to the legacy balancer**, the multi-way packing hand case,
  bounded over-takt efficiency, and an optimizer that is **never illegal or
  worse** on multi-way inputs (independent legality oracle; TOC read-back
  equals `WT.process.metrics`). `verify_factory.js` now pins **4** factory
  profiles and runs the new baseline through the full geometry / compliance /
  determinism / part-flow battery. Two new in-browser self-test checks (now
  **109/109**). Service-worker cache bumped to `wt-v71` (every pinned
  harness synced).

### Changed (documented, deliberate)
- **Over-takt line efficiency is now bounded to [0, 1]**: when a task’s
  effective load exceeds takt (possible once loads are gozinto-weighted), the
  efficiency denominator switches from takt to the **realized bottleneck
  station time** (the classical Helgeson–Birnie basis). Previously an
  over-takt chain could report a “line efficiency” above 100 %. Lines with
  every load ≤ takt — which includes every pre-v3.18 balancer output — are
  computed exactly as before, and on a **pure chain** (servers 1, no
  assembly/dismantle) the entire balancer output is **byte-identical** to
  v3.17 (harness-pinned).
- Balancer outputs for chains **with** assembly/dismantle or multi-server
  stations (e.g. the generated assembly-line) now reflect the honest
  effective loads, so their groupings/efficiencies differ from v3.17’s
  raw-cycle numbers — the scenario **data** is untouched and byte-identical;
  only the advisory balance read-out changed.

### Unchanged / honesty — what remains chain-oriented
- The balance is a **capacity grouping only**: it never re-routes flow, never
  changes declared split ratios, and never adds/removes servers. An
  **invalid** declared network falls back to raw cycle times after
  `validateFlow`’s friendly rejection (never a guessed resolution). The CRAFT
  placement objective continues to use the stored from-to arc rates (which,
  for the generated baseline, equal the resolved flows). Structural
  plain-language edits on the new baseline **re-derive a linear chain**
  (`derive()` remains chain-only by design — the network comes from the
  generator recipe or an import).
- Every existing scenario, all three legacy factory baselines and all four
  warehouse baselines are **byte-identical**. UI direction unchanged — the
  new archetype appears inside the existing Generate flow; the optimizer
  panel only re-words its Balance labels (“Σ effective load ÷ n × takt”).
- Everything stays **modelled, not measured**; a **heuristic local
  optimum** (not guaranteed optimal); deterministic, teaching-scale; **NOT a
  validated discrete-event simulation**, not CAD/BIM, not a certification.

## [3.17.0] — 2026-08-08

### Added
- **Multi-way proportional-flow routing in the factory line simulation
  (`process.js`).** Until now the from-to routing arcs of a `process` block
  were *structural* — a branched network could be declared and serialized, but
  the deterministic line sim flattened everything onto one linear chain. Now a
  block that **declares** a split (≥ 2 outgoing arcs, each carrying a `ratio`,
  ratios summing to ~1) or a merge (≥ 2 incoming arcs) is **resolved into a
  proportional flow network** (`WT.process.resolveFlow`): split arcs carry
  their declared share, merges accumulate, assembly divides (inputs → 1) and
  dismantle multiplies (1 → outputs), and **conservation is verified at every
  node** (flow out = transformed flow in, residual ~0). The token line sim runs
  **on that network** (`WT.process.simulateFlow`) with the same 4-phase
  blocking-buffer mechanics plus a **deterministic largest-deficit quota
  dispatcher** at each split — no `Date`, no RNG, exact long-run proportions —
  and `metrics()` reports the Theory-of-Constraints bottleneck, takt,
  utilisation, line efficiency and Little's Law WIP/lead-time on the resolved
  per-finished-unit loads, plus an additive `flow` summary
  (splits/merges/arcs/conservation).
- **Friendly validation, never a guess** (`WT.process.validateFlow`): ratio
  sets that don't sum to ~1, a split arc without a ratio, routing cycles and
  duplicated arcs are rejected with a plain-language message (shown in the
  existing Factory line read-out; `metrics()` returns null rather than
  computing nonsense).
- **Hand-computable demo network** (`WT.process.demoNetwork()`): an importable
  wt-1 layout — source → Machining → **60 % QA fast / 40 % QA deep** → merge →
  Pack → drain at 100 parts/hr offered. Exact expectations: effective times
  30/24/32/25 s per finished unit, bottleneck *QA deep test* at 32 s →
  **112.5 parts/hr**, utilisation 0.9375/0.75/1/0.78125, line efficiency
  111/128 ≈ 86.7 %, arc flows 100/60/40/60/40/100 parts/hr, conserved at every
  node.
- **Verification**: new `verify_flownet.js` harness (the 43rd) — hand-computed
  split/merge flows, independent node-by-node conservation recompute, a
  dismantle-then-split gozinto case, determinism (identical 50/50 branches
  measure identical utilisation), friendly-rejection messages, and **collapse
  to the base case**: on every generated factory profile the network sim
  reproduces the legacy chain sim **byte-identically** and neither `flow` nor
  `ratio` keys appear anywhere. Three new in-browser self-test checks (now
  **107/107**). Service-worker cache bumped to `wt-v70`.

### Unchanged / honesty
- **Every existing scenario is byte-identical.** Plain-chain process blocks
  take the exact legacy code path; `derive()` still builds linear chains; a
  warehouse layout still has no process block. The UI direction is untouched —
  the only surface change is extra rows inside the existing Factory line
  read-out, and only for blocks that actually declare multi-way routing.
- The line metrics remain a **deterministic proportional-flow model —
  modelled, not measured**; teaching-scale; **not a validated discrete-event
  simulation**, not CAD/BIM, not a certification.

## [2.0.0] — 2026-08-05

### Added
- **Consolidated showpiece release.** Brings Story Mode, the 894-element
  signature plant, the user-definable object library and the 2.5D isometric
  view together as the flagship build, with a new README hero and captured
  in-app screenshots.
- No behavioural or determinism change versus 1.15.0 — this is the
  presentation/consolidation release; the version metadata is reconciled to
  **v2.0.0** across the docs.
- Verification is fully green and unchanged in substance: **35 headless logic
  harnesses** (`node test/run-all.mjs`) plus the in-browser end-to-end
  self-test at **PASS 57/57**. Proprietary, offline-only, strict-CSP intact.

## [1.15.0] — 2026-08-05

### Added
- **User-definable object library (`library.js`, `WT.library`).** The palette
  is no longer a fixed preset list — define your own object *types* from a base
  material-flow behaviour class (storage / conveyor / station / transporter /
  dock / zone), organised into a categorised, collapsible palette tree; the
  built-in equipment types become editable *seeds* (clone a built-in into a
  custom).
- A **"Define Object" dialog** (name, category, base, integer-metre footprint,
  height, a 2D glyph + colour, and base-specific behaviour params) with Edit /
  Clone / Delete. A saved def injects straight into `WT.domain.ELEMENTS` so
  every existing consumer (capacity, aisle/overlap, compliance, the WMS/flow
  sim, the IFC export, the 2D + 2.5D renderers, serialize) resolves it with
  **no special-casing** and a built-in-only layout stays byte-identical.
- Persists to localStorage, import/exports as JSON, and **embeds** any custom
  types a layout uses into the `wt-1` serialize output (a default no-custom
  layout serializes byte-identically to before). Deterministic: no `Date`, no
  RNG.
- New **`verify_library.js` harness (35th)** plus Define-Object /
  categorised-palette in-browser self-test checks.

## [1.14.0] — 2026-08-05

### Added
- **894-element signature mega-plant.** A single, deliberately huge *synthetic*
  automated fulfilment/distribution plant added to the Example Scenarios
  library (`examples.js`, `mega-automated-fulfilment-plant`), bringing the
  library to **23 scenarios**.
- Its **own large floor (372 × 248 m**, within the app's **400 × 250 m** max)
  and a dedicated deterministic tiling builder that lays **894 elements**
  exercising the whole equipment palette at once (AS/RS aisles, VNA, shuttle
  high-bay, deep-lane reserve, mezzanine pick faces, a conveyor-and-sorter
  spine with RGV/AGV lanes, inbound/outbound dock walls). Clean rack blocks
  separated by empty streets, so it is **overlap-free** and never *fails*
  aisle/escape compliance by construction.
- Loads as a first-class dropdown/side-panel example, renders in 2D + 2.5D,
  animates the material flow and works under Story Mode; the v1.6 view-culling
  + shapes LOD keep 800+ elements smooth. Deterministic (no `Date`, no RNG);
  the 22 existing scenarios stay byte-identical.
- `verify_examples.js` gains 10 showcase checks; the self-test gains a live
  "mega loads + renders + compliance-safe at 800+ elements" check.

## [1.13.0] — 2026-08-05

### Added
- **Story Mode — a cinematic one-click guided tour.** A new pure, DOM-free
  `WT.story` module (`story.js`): an ordered **7-step** plan (load a synthetic
  e-commerce FC scenario → frame the whole plant → walk the five functional
  zones in flow order with plain-language captions → start the live material
  flow) plus the camera math behind the moving shot (`ease`, `frameZone`,
  `lerpCamera`).
- A top-bar **"Story"** control starts/exits it; a caption HUD carries
  Pause/Resume + Skip + Exit; Esc exits; it is fully keyboard-accessible.
  Deterministic (a frame-counted tween, no `Date`/RNG); under
  `prefers-reduced-motion` the camera **jump-cuts** and each caption still
  dwells.
- Plays over the **same synthetic, illustrative** example scenario — a
  transparent teaching animation, **not** a real DES engine, **not** a
  measurement and **not** a certification.
- New **`verify_story.js` harness (34th)** plus Story in-browser self-test
  checks.

## [1.12.0] — 2026-08-04

### Added
- **Realistic floor: measurements, markings & a finer grid.** A
  **rendering-only, additive** facility layer on top of the rich objects
  (v1.11) so a big plant reads like a real facility — the *floor* now, not just
  the equipment. All geometry is a **pure, deterministic** function of the floor
  size + the element list in a new **DOM-free `floor.js` (`WT.floor`)** module
  (no `Date`, no RNG), consumed by `app.js` for the actual canvas strokes.
  - **Two-tier grid with LOD.** Major **5 m** grid lines always draw; the minor
    **1 m** lines are **level-of-detail-gated** — they appear only once a cell
    reads at least **14 px** on screen (`WT.floor.minorGridVisible`), so a
    400 × 250 m hall zoomed out isn't an unreadable smear and the wasted
    per-line cost is skipped. At normal zooms on any ordinary floor the 1 m
    lines show exactly as before, so the base look is unchanged.
  - **Scale ruler + dimensions.** A metre **ruler** runs along the **top and
    left** floor edges — ticks + labels from a pure `rulerTicks(floorMetres,
    stepM)` that always closes on the true floor edge — with the **label step
    widening** when zoomed out (`rulerLabelStepM`) so labels never collide. When
    an element is **selected**, its **dimensions** (`w × d m`, from
    `dimensionLabel`) show in a small pill beside it. The ruler + dimensions
    ride in **screen space** (crisp at any zoom) but are positioned via the
    **same `worldToScreen`** the hit-test uses, so they track pan/zoom/Fit.
  - **Floor markings (faint, theme-aware, under the elements).** A facility
    **perimeter** outline; **aisle centre guides** down the working aisle
    between facing rack rows — derived from the **same `WT.domain.facingAisle-
    Pairs`** model the Compliance Check uses, so a guide can never disagree with
    the aisle rule; **dock-approach hatching** in front of dock doors
    (`dockApproach`, clamped in-bounds); and functional **zone tints**
    (receiving / storage / picking / packing / shipping, coloured from the
    theme's flow-stage palette) that appear **only when zone-bearing elements
    exist**. The fine markings are LOD-gated (`markingsVisible`); the perimeter
    + tints are cheap and draw whenever the layer is on.
  - **A "Measure" toolbar toggle** (default **on**) shows/hides the ruler,
    dimensions and markings; the two-tier grid LOD is always on. Off, the view
    is essentially as before.
  - **The element data model is UNCHANGED** — positions and sizes stay
    **integer-metre cells**, so compliance, capacity and the simulation are
    untouched; the whole feature is view-culled + LOD-gated so 400 × 250 m maps
    stay smooth, with no per-frame allocation in the hot loops.
  - **Honest scope.** This is an **illustrative facility rendering of a
    synthetic model** — the "measurements" are the model's own **metre grid
    (1 cell = 1 m)**, **not** a site survey and **not** CAD/BIM (the real
    geometry path remains the IFC export). No real brands.
  - `floor.js` (new) + `app.js` (two-tier grid, zone tints, markings, ruler,
    dimension readout, the Measure toggle); `index.html` loads `floor.js` +
    gains the `measureBtn` control; `sw.js` precaches `floor.js` and bumps the
    cache **wt-v40 → wt-v41**. **New `verify_floor.js` harness (33rd):**
    `rulerTicks` positions/labels/edge-close (garbage → `[]`, deterministic,
    non-mutating), the grid tiers + minor-grid px/cell threshold, the ruler
    label-step widening, `dimensionLabel` text, `perimeter`/`dockApproach`/
    `aisleGuides` finite + in-bounds + non-mutating on every edge/axis,
    `zoneTints` only when zones exist (right stage, skips transport/boundary),
    the illustrative / not-a-survey / not-CAD-BIM honesty label, and the shipped
    wiring. The live pixels are verified in the browser; every geometry path is
    covered here.

## [1.11.0] — 2026-08-04

### Added
- **Realistic high-detail object rendering (progressive LOD).** A **third**
  level-of-detail tier on top of the existing **icon** (far) and **glyph** (mid)
  tiers, so the plant reads like a real facility when you zoom in — while big,
  zoomed-out layouts stay just as fast.
  - **`WT.shapes.detailLevel(pxPerCell)` → `"icon" | "glyph" | "rich"`**, a pure
    function of the **on-screen** pixels-per-cell (base `cellPx` × the view
    zoom). Thresholds: below **10 px/cell** → icon, **10–40** → glyph (today's
    default), **≥ 40** → the new **rich** tier. `draw2D` and `draw3D` pick their
    fidelity from it. The rich tier only fires when an element is **large on
    screen** (zoomed in) *and* clears the existing footprint-legibility guard —
    so a big hall at normal zoom never pays for it.
  - **What "rich" adds (2D top-down), layered on top of the base glyph so
    animated parts keep moving:** racking / AS-RS / shuttle / drive-in /
    push-back / flow gain **pallet load-units** sitting in a share of the bay
    positions; **AS/RS** a structured deep rack each side of the crane aisle;
    **docks** a panelled door with guide rails; **conveyor** a couple of belt
    load-units (they scroll when the flow is playing, static otherwise);
    **stations / returns** a tote on the bench; **mezzanine** an interior post
    grid; **forklift / RGV / AGV** a load body; plus sorter trays, stretch-wrap
    film bands, cantilever long-goods bars, a charging post and a gate
    threshold. Type colour kept; theme-aware.
  - **What "rich" adds (2.5D isometric):** the extruded forms gain **pallet
    load-units on the shelf levels** for racking; **AS/RS** a tall multi-level
    rack each side of the crane mast; **mezzanine** a decked platform on an
    **interior post grid** with pallets on the deck; **conveyor** belt
    load-units; **vehicles** a small 3D load body. Painter-order and the single
    light direction are unchanged.
  - **Deterministic, allocation-lean, LOD-gated.** The load-unit fill is a
    **fixed rule seeded from the element** (its floor position) — **no `Date`,
    no RNG** — so it is stable frame-to-frame, identical on re-render, and
    testable; identical racks at different spots don't look cloned. The rich
    overlays add **no per-frame allocation** in the hot path, and the existing
    v1.6 **view-culling** still only paints on-screen footprints, so zooming in
    on one corner of a large hall stays smooth. The `anim` phase still drives
    every moving part at the rich tier.
  - **Honest scope.** This is an **illustrative, higher-fidelity schematic of a
    synthetic model** — still **not** CAD, BIM or a survey (the real geometry
    path remains the IFC export), and the load-units shown are an **illustrative
    fill pattern, not the actual computed inventory count**. No real brands.
  - `shapes.js` gains `detailLevel` + the `RICH2D`/`RICH3D` overlays; `iso.js`
    `drawScene` threads the on-screen px/cell into `draw3D`; `app.js` passes the
    per-element fill seed (2D) and the on-screen px/cell (iso). **New
    `verify_detail.js` harness (32nd):** `detailLevel` thresholds +
    determinism, an **every-type** rich 2D+3D mock-context smoke (light + dark,
    all-finite, no throw, no input mutation), rich **adds** detail and is
    **LOD-gated** (icon < glyph < rich; below the threshold the output equals
    the plain glyph), the fill is deterministic + seed-sensitive, the anim phase
    still moves at the rich tier, and the illustrative / not-an-inventory-count /
    not-CAD-BIM honesty labels are present. Rendering only — the simulation,
    logic, compliance, IFC and isometric projection are untouched. Service
    worker cache bumped `wt-v39` → `wt-v40`. Offline, no dependencies, no cost.

## [1.10.0] — 2026-08-04

### Changed
- **Larger maps + wider zoom range — fit MORE items on the floor.** The
  editable warehouse now scales up to a **400 × 250 m** hall (was 120 × 80 m),
  and the interactive zoom clamp widens to **0.04× – 8×** (was 0.2× – 5×) so the
  **whole** largest floor can be **framed with Fit** and then zoomed in for
  detail.
  - **Fit actually frames the max floor now.** Because the viewport keeps the
    reference aspect, `fitView` computes a scale of **≈0.092×** for the full
    400 × 250 m floor — which used to be clamped up to the old 0.2× minimum
    (cutting the floor off). The new 0.04× minimum sits comfortably below that,
    so the clamp no longer floors the Fit scale and the entire hall is visible.
    Zooming out past Fit is still allowed for breathing room; **100%** still
    resets to a centred 1:1, and wheel / `+` / `−` keys work across the wider
    range.
  - **Still smooth at size.** Rendering and navigation only — **no change to the
    simulation, logic, compliance, IFC or isometric projection** (fully
    deterministic). The existing view-culling (`WT.view.cullToView`) means a big
    floor with many items only draws the elements whose footprint is on screen,
    and the per-type shapes LOD collapses to a single icon when zoomed out, so a
    large hall stays responsive.
  - A very large but **sparse** floor is honestly just extra empty space — the
    bigger maximum only gives complex layouts more room; it invents nothing.
  - `view.js` `FLOOR_MAX_W`/`FLOOR_MAX_H` and `SCALE_MIN`/`SCALE_MAX` raised;
    `index.html` floor-size input `max` attributes raised to match;
    `verify_view.js` extended with checks that `normalizeFloor` accepts the large
    max (and clamps beyond it), that `fitView` frames the max floor **within** the
    new clamp at any reference viewport, that the wider `clampScale` bounds hold,
    that a large-floor `cullToView` returns only on-screen elements, and a
    set-max-floor-then-Fit round-trip whose bounds cover the whole floor. Service
    worker cache bumped `wt-v38` → `wt-v39`. Offline, no dependencies, no cost.
  - Illustrative schematic of a synthetic model, **not** CAD/BIM; no real brands
    or vendor models; the sizes are order-of-magnitude teaching values.

## [1.9.0] — 2026-08-04

### Added
- **More equipment types: eight new, genuinely distinct warehouse objects in
  the palette.** Each carries an honest domain schema **and** a **distinct 2D
  top-down glyph plus a distinct 2.5D isometric form** (one source of truth,
  `WT.shapes`) — none is a plain rectangle. Additive and non-breaking: the
  existing 21 types and every saved layout / example / generated plant load and
  render **unchanged**; the new types route through the **same generic**
  place / select / drag / overlap / compliance / capacity paths. All
  in-browser, offline, no dependencies, no cost.
  - **Two storage systems** (they carry pallet positions and form working
    aisles like the other racking):
    - **Pick-to-light rack** — small-parts shelving with light-directed pick
      modules; fully selective each/carton pick faces, capacity stated in
      pallet-equivalents (`pickFace`), fast confirmed picks (−3 s/line in the
      sim). *Glyph:* shelf grid + a lit module dot per bay. *Form:* low
      see-through shelf frame + lit pick-face displays.
    - **VNA narrow-aisle racking** — very-narrow-aisle, guided man-up turret
      racking; near-drive-in floor density with **100 % selectivity** across
      full height, at a slower man-up cycle (+4 s/line) and a guided ~1.6–1.8 m
      aisle (informed by DIN 15185). *Glyph:* dense narrow bays + a guided-aisle
      rail. *Form:* tall many-level rack frame + a floor guide rail.
  - **Six handling / support / boundary elements** — all **0 storage capacity**
    (movement/processing equipment, like RGV/AGV):
    - **Forklift / reach truck** — a materials-handling truck at its operating
      spot (the working aisle it needs is placed separately as a gap).
    - **Charging station** — a battery/opportunity charging point for the
      AGV/AMR or truck fleet.
    - **Sorter loop (tilt-tray)** — a **closed-loop** tilt-tray/cross-belt
      sortation system with divert chutes (distinct from a straight conveyor
      *segment* — a routing **loop**, not a point-to-point link). *Animated:* a
      tray circulates the loop while the flow plays.
    - **Stretch-wrap / palletiser** — an end-of-line pallet-wrapping turntable.
      *Animated:* the wrap mast orbits the load while the flow plays.
    - **Returns / QA station** — a bench for returns processing and quality
      inspection (grade → re-label → restock or scrap).
    - **Gate / sectional door** — an internal zone-segregation barrier (fire /
      security / temperature), **distinct from a loading dock door** (no vehicle
      bay, no inbound/outbound flow direction).
  - **Honest categorisation + safe integration.** The two storage types are
    `category:"storage"` (non-zero `elementCapacity`, aisle-aware); the six
    handling/support types are `category:"flow"` with **0** capacity, so they
    never inflate storage or misfire the aisle/route logic. The 2.5D height
    table (`iso.js` `HEIGHTS`) and the editable KB densities auto-mirror the
    domain model. Illustrative schematics of a **synthetic** model — **NOT**
    CAD/BIM, no real brands or vendor models.
- **`verify_shapes.js` extended** (now **17 checks**): the eight new types are
  in the domain, the shape registry (2D **and** 3D) and the palette; their
  `elementCapacity` is **0** for the six handling/support types and **> 0** for
  the two storage types; a focused draw smoke covers every new type in
  2D + 3D × light/dark × small/large with **no throw**, **all-finite** coords
  and **no mutation**; and the two new animatable forms (sorter loop,
  stretch-wrap arm) visibly **move** their part across animation phases.

### Changed
- **Offline PWA cache** bumped `wt-v37` → `wt-v38` (`domain.js`, `shapes.js`,
  `iso.js`, `app.js` changed; nothing added to the shell). Fully offline; no new
  dependencies; no external references. (The `wt-v37` cache-version assertions
  in `verify_animation.js` and `verify_hardening.js` were updated to `wt-v38`.)

## [1.8.0] — 2026-08-04

### Added
- **A "living plant": press `P` to switch 2D ⇄ 3D, material flow now runs in
  the 3D view too, and the equipment itself is animated.** Additive and
  non-breaking — a normal load looks and behaves exactly as before, and when
  the flow isn't playing every element renders in its static form as today.
  All in-browser, offline, no dependencies, no cost.
  - **`P` toggles the whole view 2D ⇄ 2.5D.** A keyboard shortcut fires the
    **same** view-mode toggle the toolbar's "2.5D view" button uses (no
    re-implementation). It is **input-guarded** (ignored while typing in an
    `input`/`select`/`textarea`) and **modifier-guarded** (ignored when Ctrl/
    ⌘/Alt is held, so it never hijacks a browser/OS shortcut). Pan keeps its
    own affordances — the **Pan** button, **Space**, and **middle-mouse drag**
    — so `P` is unambiguously the view switch. The 2.5D button now advertises
    the shortcut in its label/title.
  - **Material flow renders in the 2.5D (3D) view too.** The animated flow
    handling-units (MUs) and the pick/put/pack **station rings + queue badges**
    are projected through the isometric projection (`WT.iso.project`, lifted a
    little off the floor) and drawn stage-coloured **inside the 2.5D scene** —
    not just top-down. It composes with zoom / pan / Fit exactly like the
    top-down overlay.
  - **The equipment is animated in both views.** While the flow is **playing**:
    **conveyors** scroll unit-loads along the belt in the flow direction;
    **RGV/AGV** vehicles travel their lane (rail-guided back-and-forth,
    free-roaming loop); **AS/RS** and **shuttle** carriages run the aisle and
    lift. It is driven by a **deterministic animation phase seeded from the
    flow sim's tick** — `WT.shapes.equipmentPhase(t, seed)`, a pure function
    with **no `Date`/`Math.random`**, bounded in `[0,1)` and periodic — passed
    as **one source of truth** into `WT.shapes.draw2D`/`draw3D` so the top-down
    glyph and the 2.5D form move **identically**. It **pauses with the sim**
    (the tick stops advancing → a static frame — Step/Pause show equipment
    still), is **LOD-aware** (skipped when an element reads too small on
    screen), honours **prefers-reduced-motion**, and allocates nothing new in
    the per-element hot loop.
  - **Honest scope.** This is **illustrative** animation of a **synthetic**
    teaching model — the moving parts do **not** change any KPI, label or the
    flow model; the 2.5D heights remain illustrative defaults (not a survey,
    not a BIM model — the real geometry path is the separate IFC export). No
    real brands; every motif is a generic material-handling schematic.
- **New harness** `verify_animation.js` (**31st**, 14 checks): `equipmentPhase`
  is bounded/deterministic/periodic/garbage-safe; a mock-context smoke draws
  every animatable type (conveyor/rgv/agv/asrs/shuttle) in **2D and 3D** across
  a range of phases + themes with **no throw** and **all-finite** coords; a
  distinct phase visibly **moves** the part (while a non-animatable type
  ignores `anim` and the static no-anim path is byte-identical); the 2D
  animation is **LOD-skipped** when tiny; neither draw mutates its inputs;
  `WT.iso.project` maps an MU world position to finite coords; and the shipped
  wiring is asserted (the `p`/`P` keydown → view toggle, input- + modifier-
  guarded; flow-in-3D via `projPx` → `WT.iso.project`; the anim tick-seeded,
  playing-gated, threaded into `draw2D` + `drawScene(animFor)`; the button
  hint; the `sw` bump; the self-test check; the runner entry).
- **Self-test extended** (`selftest.js`, now **47** checks): a live check that
  dispatching a real `KeyboardEvent("keydown", {key:"p"})` on the window
  **toggles the view mode** `top → iso → top` through the same handler a real
  keypress uses.

### Changed
- **Offline PWA cache** bumped `wt-v36` → `wt-v37`. `shapes.js` (the animation
  phase + moving parts) and `iso.js` (the `animFor` pass-through) already ship
  in the precache; nothing added to the shell. Fully offline; no new
  dependencies; no external references. (`verify_hardening.js`'s cache-version
  assertion updated `wt-v36` → `wt-v37`.)

## [1.7.0] — 2026-08-03

### Added
- **Deep-link to a scenario via URL.** A URL can now open a specific example
  scenario (and skip the onboarding modal), so a synthetic plant is
  **shareable/embeddable with a link** and a demo or screenshot can open a
  chosen plant directly, unobstructed. Additive and non-breaking — a normal
  load (no query flags) looks and behaves exactly as before.
  - `index.html?scenario=<id>` (or the alias `?example=<id>`) where `<id>` is a
    `WT.examples.library` id — e.g. `index.html?scenario=coldchain-frozen-dc` —
    loads that scenario onto the floor **via the same `loadExample()` the side
    panel and header quick-pick use** (no re-implementation) and suppresses the
    welcome modal for that load so the plant shows immediately.
  - `?onboarding=0` (also `false`/`off`/`no`) suppresses the welcome modal on
    its own, without loading a scenario; a `?scenario=` implies it.
  - **Nothing is persisted.** A deep-link is per-URL, not a saved preference —
    it never flips the "don't show onboarding again" `localStorage` flag; it
    only suppresses the modal for that one load. (Loading the scenario itself
    autosaves the working layout exactly as the UI "Load onto floor" button
    does — that is the shared loader's normal behaviour, unchanged.)
  - **Unknown id is safe:** a `?scenario=` that isn't in the library falls
    through to a normal boot with a gentle notice — a bad link never breaks the
    app.
  - **Composes with everything.** Boot **precedence**: an explicit `#layout=`
    share-hash wins, else a `?scenario=` deep-link, else the saved layout, else
    the demo starter. `?selftest=1` is never hijacked; `?tour=off` still works.
  - The parsing is a **pure, DOM-free, deterministic** helper
    `WT.deeplink.parse(search) → { scenario, skipOnboarding }` (`deeplink.js`)
    that reads nothing, mutates nothing and does **not** validate the id (it
    returns the raw id; the app validates it against the library) — so it is
    fully headless-tested.
- **New harness** `verify_deeplink.js` (**30th**): the parser returns the id
  for `?scenario=` and `?example=` with onboarding suppressed, `?onboarding=0`
  suppresses on its own (`?onboarding=1` keeps the modal), an empty/`?`/
  non-string query and `?selftest=1` are a clean no-op, an unknown id is
  returned verbatim, a real library id round-trips, purity + determinism
  (proven with a poisoned `document`, no input mutation), composition +
  order-independence, and tolerance of a trailing `#fragment`/`+`-space/
  malformed `%xx`/bare key without throwing.
- **Self-test extended** (`selftest.js`, now **46** checks): a live check that
  `WT.deeplink.parse` exists and that `parse("?scenario=<real id>")` yields
  that id with onboarding suppressed while `?selftest=1` stays a no-op.

### Changed
- **Offline PWA cache** bumped `wt-v35` → `wt-v36`; `deeplink.js` added to the
  service-worker precache and loaded in `index.html` before `app.js`. Fully
  offline; no new dependencies; no external references.

## [1.6.0] — 2026-08-03

### Added
- **Production hardening (pass 2): accessibility, large-layout performance, and
  a QA/production checklist.** Real, verified improvements — additive and
  non-breaking; a normal load looks and behaves exactly as before.
  - **Accessibility (real, but *not* a WCAG certification).**
    - **Landmarked regions:** `<main>` and the three columns carry `aria-label`s
      (building tools / floor / simulation panels) so assistive tech can jump
      between them.
    - **The `<canvas>` gets a text alternative.** A canvas is opaque to screen
      readers, so `#floor` now carries an `aria-label` **and** an
      `aria-describedby` pointing at an **offscreen summary** (`#floorDesc`,
      `.sr-only`) that `app.js` keeps current — element count, floor size (m),
      view mode, and live-flow status. It only touches the DOM when the text
      changes, so it stays cheap even during playback.
    - **Named toolbar controls:** the icon / short-text controls (zoom −/+,
      Fit, 100%, Pan, 2.5D, Guided demo, Play/Pause) all expose an accessible
      name (`aria-label`/`title`). Every primary control is a native
      `<button>` (keyboard-operable); the custom card-header toggles remain
      `role="button"` + `tabindex` + Enter/Space.
    - **Visible focus:** a `:focus-visible` outline is shown on every
      interactive control (buttons, button-styled links, role=button toggles).
    - **Reduced motion honoured:** with the OS "reduce motion" setting on, the
      continuous material-flow animation **does not auto-run** — Play shows a
      single static/stepped frame and the app stays **fully usable** (Step /
      Reset advance the model on demand). This governs the one-click Guided
      demo too. CSS transitions/animations are also stilled. `app.js` reads a
      cached `prefers-reduced-motion` matcher.
  - **Performance for large layouts (bounded effort, *not* a guarantee for
    arbitrary size).** A new **pure, testable** helper
    `WT.view.cullToView(elements, viewBounds, pad)` culls the per-frame element
    draw to the elements whose footprint overlaps the visible world rectangle
    (`WT.view.viewBounds`), so on a big floor (e.g. 120×80) zoomed in, glyph +
    label work is proportional to what is **on screen**, not the whole layout.
    The per-type shapes registry already drops to a single LOD icon when zoomed
    out. **Simulation results are unchanged** — this is rendering/throughput
    only; every logic/determinism harness still passes byte-for-byte.
- **New maintainer doc** `docs/QA_CHECKLIST.md` — an honest pre-release
  checklist (offline works; installs as a PWA; service-worker cache bumped;
  `?selftest=1` → `PASS n/n` with the headless one-liner; no console errors;
  CSP present; error boundary works; keyboard/a11y checks; large-layout perf
  sanity; data stays on-device; honesty labels present; proprietary license).
  Cross-linked from `docs/PRODUCTION.md` (new a11y/perf section).
- **Self-test extended** (`selftest.js`, now **45** checks): the canvas
  aria-label + offscreen description, key toolbar controls having accessible
  names, the reduced-motion flag hook, and the pure `cullToView` culling being
  correct + non-mutating — driven against the live app.
- **New harness** `verify_a11y_perf.js` (**29th**, ≥ 10 checks) gates all of
  the above headlessly: the canvas aria wiring, named toolbar controls,
  landmarked regions, the `prefers-reduced-motion` rule + the flow loop reading
  the flag, `:focus-visible` + `.sr-only`, `cullToView`/`viewBounds` purity +
  correctness + determinism, `QA_CHECKLIST.md` presence, the new self-test
  checks, and the license staying proprietary (no MIT in any touched file).
- Service-worker cache bumped **`wt-v34` → `wt-v35`**.

## [1.5.0] — 2026-08-03

### Added
- **Production hardening: in-browser self-test, global error boundary, and a
  strict Content-Security-Policy.** The app's DOM/UI had only ever been tested
  indirectly (the harnesses cover pure logic); this pass closes that gap with a
  real in-browser end-to-end self-test plus two safety nets — none of which
  change a normal load.
  - **Global error boundary** (`errors.js`, loaded **first**, before every other
    script). It installs `window.onerror` + `window.onunhandledrejection`,
    records every uncaught error / unhandled rejection into
    `window.__WT_ERRORS__`, and surfaces **one honest, non-blocking banner**
    — *"Something went wrong — details in console."* — instead of leaving a
    silently dead UI. It never **swallows** an error: the handlers do not return
    `true` / `preventDefault()`, so the browser's own console reporting stays
    intact. Tiny, dependency-free, CSP-safe.
  - **In-browser self-test** (`selftest.js`, `?selftest=1`). **Inert** by default
    — a normal load never runs it. When enabled it waits for boot, then drives
    the **live app** through the same functions the UI uses (exposed as
    `window.__WT_TEST_API__` only in self-test mode) and asserts ~40 checks:
    every `WT.*` module present and correctly shaped, a clean error-free boot,
    the key panels/buttons in the DOM, a real example load placing elements and
    redrawing, WMS ops populating its panel, the flow stepping/playing then
    stopping, the 2.5D toggle being a pure layout no-op, the report building with
    its expected sections, About/KB opening, and the zoom controls running. It
    writes a **machine-readable** result into a `#wt-selftest` element and the
    console — `WT-SELFTEST: PASS 40/40` or `WT-SELFTEST: FAIL n/40 :: <checks>`
    — for a maintainer to read headlessly. Each check is isolated (a thrown
    check is one FAIL, never a dead page) and the suite restores the app to a
    normal state at the end.
  - **Strict offline Content-Security-Policy** (`<meta>` in `index.html`):
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:; connect-src 'self'; worker-src 'self';
    manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';
    frame-src 'none'`. No external hosts, **no `unsafe-eval`**, no inline scripts;
    inline **style** is allowed because the UI uses a handful of `style=""`
    attributes. A static scan confirms there is no `eval(` / `new Function(` and
    no inline `on*=` handler anywhere, so the policy breaks nothing. This is
    **best-practice hardening for an offline app, not a security certification**.
- **New harness** `verify_hardening.js` (28th) verifies all of the above
  headlessly (the error boundary actually installs + records + does not swallow
  under a window-shim; the CSP directives; the eval/inline-handler scan; the
  self-test's inertness, ≥ 25 assertions and machine-readable output; the
  guarded test API; the service-worker precache + cache bump). The **live**
  self-test runs in a real browser; the harness gates its presence and wiring.
- Service-worker cache bumped **`wt-v33` → `wt-v34`**; `errors.js` + `selftest.js`
  added to the offline precache shell.

## [1.4.0] — 2026-08-03

### Added
- **Distinct 2D + 3D object representations.** Every warehouse object type
  now has its **own recognizable schematic** in both views instead of a
  coloured rectangle (top-down) and a plain height-extruded box (2.5D). A new
  **single per-type shape registry** (`shapes.js` → `WT.shapes`, exposing
  `has / draw2D / draw3D / ICONS / meta`) is the **one source of truth** both
  renderers route through:
  - **Top-down glyphs** (`draw2D`): selective racking → shelf-bay grid;
    drive-in → deep lanes + entry depth arrows; double-deep → paired bays +
    two-deep divider; push-back → nested chevrons; pallet-flow/carton-flow →
    roller dots + FIFO flow chevrons; mobile racking → base rail + wheels;
    cantilever → column + projecting arms; AS/RS → tall-rack hatch + crane
    aisle + trolley; shuttle → channels + carts + lift; mezzanine → dashed
    platform + posts + stairs; dock-in/out → door notch + in/out arrow;
    staging → dashed holding area; conveyor → belt rollers + direction;
    push/pull/pack stations → workbench + flow arrow / parcel; block-stack →
    stacked-square pattern; RGV → twin rails + cart; AGV → guide path + robot.
  - **Isometric forms** (`draw3D`): open, **see-through rack frames** (uprights
    + beam levels, not a solid block); a **tall crane tower** for AS/RS; a
    **raised deck on legs** for the mezzanine; a **low belt bed** with rollers
    for the conveyor; **bench furniture** for the stations; small **floor
    vehicles** for RGV/AGV; a **door opening in a low wall** for docks;
    **stacked unit cubes** for block-stack; a **low outlined pad** for staging.
    The 3D forms reuse the **same per-type height** (`domain.heightM` via
    `iso.elementHeight`) the IFC export and the iso projection already agree on.
- Both renderers are wired through `WT.shapes` **fallback-safe**: the top-down
  loop (`app.js`) and the iso scene (`iso.js`) fall back to the previous rect /
  extruded-box draw if a type has no custom shape or the module is absent, so
  nothing breaks. The heatmap, aisle-violation, chain-arrow, compliance,
  reserved-zone, flow-MU and order-pool overlays, selection highlight, labels
  and hit-testing are **unchanged**.
- A **level-of-detail** path keeps large layouts smooth and legible: when a
  footprint is small on screen the glyph simplifies to the already-tinted
  footprint plus a tiny centred icon; at high zoom the full glyph is crisp.
  The module is **pure and deterministic** (a canvas `ctx` + plain geometry/
  colour in, drawing out — no app state, no per-call input mutation), theme-
  aware (light + dark) and **offline** (no external assets).
- These are **illustrative, recognizable schematic** glyphs and forms with
  heights taken from the domain model's **assumed** `heightM` — **not** CAD,
  **not** BIM, **not** a survey and **not** measured geometry. The real
  BIM/geometry path remains the separate **IFC export** (`ifc.js`). No real
  brands, logos or trademarked shapes.

### Engineering
- 27 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_shapes.js`, 13 checks). Because the pixels of a pure-draw feature
  can't be verified headlessly, the harness runs a **mock-context smoke test**
  that draws **every** object type in **both 2D and 3D**, in **light + dark**,
  at **small + large** scale (exercising the LOD path), asserting **no
  non-finite coordinate** and **no throw**; it also asserts `has()` is true for
  every domain type (2D **and** 3D defined — no type left a plain rect), the
  registry covers **exactly** the domain types (no orphans), the 3D forms use
  the domain `heightM` (a taller element rises on screen), neither draw mutates
  its inputs, unknown types are safe, and the honesty labels are present. All
  26 pre-existing harnesses still pass unchanged. Service-worker cache bumped
  to `wt-v33` (precaching `shapes.js`).

## [1.3.0] — 2026-08-03

### Added
- **Live order pool.** The demand side of the plant is now **visible and
  live**. A new bounded order-pool model (`orderpool.js` → `WT.orderpool`)
  mirrors the classic Siemens Plant Simulation spine — *generateOrders →
  DT_tempOrders (SizeOrderPool) → M_selectOrders → consumed*: orders are
  **generated over time** into a **bounded backlog** (a `SizeOrderPool`-style
  cap), **selected/released** into the picking flow at the line rate, and
  marked **completed** as the flow ships them. It is driven from the **same
  `requestAnimationFrame` loop** that steps `WT.flowsim` (no competing loop),
  so the pool's **selected** aligns with handling units entering picking and
  its **completed** with units shipped; the pool's selection/completion rates
  are taken from the flow's realized spawn/retire deltas each frame, and its
  arrival (order-generation) rate is a synthetic demand set a little above the
  modelled pick capacity so a live backlog is visible. When the flow isn't
  playing the pool **holds its last state**.
- A compact **"Order pool"** readout in the Live material flow card shows the
  **backlog + fill bar**, **generated / selected / completed** counts (and
  **dropped** when the cap overflows), live **in / out rates** (orders/hr),
  **in-flight** count, a backlog **sparkline**, and an honest **starving**
  (empty pool while the picker wants work) / **saturating** (backlog at the
  cap, overflowing) flag.
- The model is **pure and deterministic** (seeded mulberry32; no `Date`, no
  `Math.random`) and **count-conserving at every step**: `generated == inPool
  + inFlightSelected + completed + dropped`. Overflow at the cap is counted as
  **dropped** (backpressure) and pool **starvation** is flagged — both
  reported, never hidden. Order generation **reuses the SKU-velocity-weighted
  generator from `wmsdata`** when present (a Zipf/Pareto heuristic, not
  measured demand) and falls back to a simple seeded generator when it is not.
- A transparent **bounded-queue heuristic** — selection tied to the documented
  `wms.js`/`flowsim.js` throughput model — **not** a real discrete-event /
  queueing engine, **not measured**, not a certification. **SYNTHETIC** unless
  you import your own data.

### Engineering
- 26 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_orderpool.js`, 22 checks: determinism, count conservation, the cap +
  honest overflow, backlog grow/drain, the starving/saturating flags, the
  selection-rate tie to WT.wms/WT.flowsim, the wmsdata velocity-weighting +
  fallback, and the honesty labels). Service-worker cache bumped to `wt-v32`
  (precaching `orderpool.js`).

## [1.2.0] — 2026-08-03

### Added
- **Scenario A/B compare.** A new **"Scenario A/B compare"** panel lets you pick
  **two whole set-ups** — the current layout, a built-in example, or one of your
  saved scenarios — and see their key metrics **side-by-side with deltas** in a
  modal, so you can answer *"which layout / strategy is better?"*. Each side's
  numbers are **derived from the same consolidated WMS Report the app shows**
  (`WT.report.build`), which is itself cross-consistent with the WMS, storage,
  automation and compliance modules — so the two sides **can never drift** from
  the app. The table diffs layout capacity/floor-use, WMS operations KPIs
  (throughput, order cycle time, dock-to-stock, picking), storage
  occupancy/placement/A-class pick travel, automation throughput and compliance
  pass/warn/fail, with each delta given as an **absolute and % change (B-vs-A)**.
  A plain-language *"what changed"* summary calls out which side has higher
  throughput, lower pick travel and better compliance. **"Better/worse" colouring
  is shown only where the direction is unambiguous** (lower pick travel = better);
  capacity, utilisation and automation are left **neutral** with an honest
  *"higher isn't always better"* note (more automation ≠ automatically better).
  Comparing runs on the picked snapshots and **never disturbs your current
  floor**. Sources resolve through the **same builders the app uses**
  (`currentLayout` / `WT.examples.build` / `WT.scenarios.load`). The pure,
  deterministic engine lives in `compare.js` (`WT.compare`), covered by the new
  `verify_compare.js` harness (16 checks). This is broader than, and separate
  from, the existing strategy-only *Compare A/B* predictor. **SYNTHETIC** unless
  you imported your own data — a transparent heuristic informed by ISO/DIN/EN/VDI,
  **not a certification, not measured**.

### Engineering
- 25 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_compare.js` added). Service-worker cache bumped to `wt-v31`
  (precaching `compare.js`).

## [1.1.0] — 2026-08-03

### Added
- **Save / load named scenarios.** A compact **"My scenarios"** control (near
  the Layout Save/Export buttons) lets you save the plants **you** build under a
  **name**, then reload, rename or delete them, and **export/import** a JSON
  backup bundle to move them between devices. Saving captures the same
  `serialize()` layout + configuration used by JSON export and share links (and,
  when a real-data bundle is loaded, your imported SKU/order data rides along);
  loading applies it through the **same `deserialize()` loader as JSON import**.
  These are your **own saved work**, stored **only on this device** (browser
  `localStorage`) — nothing is uploaded — and are kept distinct from the
  read-only synthetic example scenarios. Saving under an existing name updates
  that scenario in place. The pure, storage-guarded store lives in
  `scenarios.js` (`WT.scenarios`) with deterministic, sorted-key serialization
  (a bundle round-trips exactly), covered by the new `verify_scenarios.js`
  harness.

### Engineering
- 24 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_scenarios.js` added). Service-worker cache bumped to `wt-v30`
  (precaching `scenarios.js`).

## [1.0.0] — 2026-08-03

First consolidated product release. WarehouseTwin is an offline, browser-based
warehouse / WMS digital twin and plant-flow simulator: draw or generate a
warehouse layout, simulate the material flow and the standard warehouse
operation, read live KPIs, check the layout against public design guidance, and
roll every layer up into one report — all fully offline, with no account and no
server.

### Design & generate
- Interactive HTML5-canvas floor plan: racks, block-stack, docks, staging,
  conveyor and push/pull stations on a 1 m grid, with overlap blocking and a
  DIN 15185-informed minimum working-aisle rule.
- AI Environment Generator: a deterministic rule/heuristic engine plus offline
  plain-language command parsing (no cloud, no trained model).
- 22 synthetic industry example scenarios, one-click loadable.
- Zoom / pan / Fit and a resizable warehouse floor (up to 120 × 80 m).
- Presentation-only 2.5D isometric view.

### Simulate & KPIs
- Seeded, deterministic slotting + pick-travel simulation (Random / ABC 80/20)
  with throughput, pick travel, storage fill and positions KPIs; a pick-travel
  heatmap overlay and a session-only run-history table.
- WMS Operations: the 7-stage receiving→shipping workflow with per-stage
  throughput and a plain-language bottleneck, grounded in the ISO 22400 KPI
  discipline.
- Live material-flow animation with station FIFO servers, conveyor-following
  routing and emergent queue congestion (a teaching animation, not a DES engine).
- Live KPI cockpit: throughput-over-time, seven-stage load-vs-capacity bars and
  in-flight-vs-shipped, with honest 0-based, colourblind-safe dataviz.
- Rule-based advisor, golden-zone layout optimizer (preview before apply) and an
  A/B configuration comparator.

### Data & storage
- SKU master + order pool data layer (seeded synthetic or import your own CSV).
- CSV import for your own article/order data, parsed in-browser with row-numbered
  validation; data stays on the device.
- Floor-plan image underlay with two-point scale calibration.
- Storage & inventory: physical locations from the racking, ABC/velocity slotting
  into the golden zone, occupancy with honest overflow, and a retrieval location
  the flow animation uses.

### Standards, compliance & automation
- Compliance Check (DIN 15185 / ASR A1.8 / ASR A2.3) — a deterministic
  pass/warn/fail design aid with measured + informed-by values and
  click-to-highlight; explicitly not a certification.
- Editable, versioned standards knowledge base (ISO/DIN/EN/VDI/ASR) that every
  engine reads from, with add/reset and JSON import/export.
- Automation systems modeling (AS/RS, shuttle, RGV, AGV, conveyor) as explicit
  per-system throughput contributors with editable VDI-informed cycle times.

### Outputs & demo
- Consolidated WMS Report (print / JSON / CSV) that aggregates every layer and
  pulls each number from its owning module so it cannot drift from the app.
- Dependency-free scoped IFC4 (STEP) BIM export.
- Save / load / export-import JSON, and a share link that carries the whole
  layout in its `#layout=…` URL fragment (nothing uploaded).
- One-click guided demo that sequences the existing features end-to-end, plus an
  honest About panel.
- LSP Planner companion app (network-level planning game) under `lsp/`.

### Added in this release
- **Collapsible side-panel cards.** Each side-panel card header is now a toggle
  (click, or Enter/Space when focused) that folds the card body away; the
  collapsed set persists in `localStorage` (guarded — a safe no-op when storage
  is unavailable). Cards ship **expanded**, so first load is unchanged. The
  collapse-state helper lives in `cards.js` (`WT.cards`) and is covered by the
  new `verify_ui.js` harness.
- **Product-level README** rewritten into one coherent document (what it is,
  grouped feature overview, run-it-locally, honesty & standards, verification).
- **This CHANGELOG.**

### Engineering
- 23 headless verification harnesses via `node test/run-all.mjs`; deterministic,
  ASCII-only, with an offline guard asserting the app references no external
  assets. Service-worker cache bumped to `wt-v29`.

## 2026-09-19 — Placement constraints and stale-preview protection

Added fixed element IDs and reserved rectangles in metres to the warehouse layout
optimizer. Invalid or conflicting starting constraints block proposals; rejection
counts expose search limitations. Applying an outdated proposal is blocked. Removed
claims that no local move proves near-optimality or that preserved warning counts
mean valid aisles. Constraints are currently local to this preview workflow.

## 2026-09-19 — Preserve placement drafts with the layout

Autosave and layout export now retain constraint text, including unfinished drafts.
Loading legacy layouts clears old constraints. Malformed draft field types/size
are rejected before mutation, and editing invalidates the preview. Browser tests
exercise the real serialization/deserialization path and legacy reset.

## 2026-09-19 — Reserved-area form and shared floor overlay

Added numeric area fields, removal controls and a fixed-equipment selector backed
by the saved draft. Both projections show matching labelled amber outlines.
Browser tests exercise add/remove, adverse dimensions and fixed-ID toggling.

## 2026-09-19 — Persistent package-transfer ledger

Added a local SQLite transfer lifecycle tied to completed picks and order contents.
Transactional event identities, expected versions, explicit in-transit location
and exclusive resource assignment prevent duplicate or contradictory updates.
The browser is not connected to this ledger yet. Tests include two concurrent
resource assignments, restart, adverse transitions and idempotent retries.

## 2026-09-19 — Inspect exported SQL package histories offline

Added a consistent, bounded JSON export and a browser viewer linked from the scene
inspector. Select a package and step through its order-linked event history;
blocked reasons and unknown in-transit locations stay explicit. Invalid sequences
are rejected instead of presenting misleading reconstructed states. Separate from
the floor animation and from browser SQL execution.

## 2026-09-19 — Link transfer locations to declared floor equipment

Added planner-layout import and explicit ledger-location/equipment bindings in the
transfer viewer, with metre-based SVG footprints and stationary anchor markers.
Travelling and blocked states do not fabricate coordinates. Geometry validation
rejects duplicate IDs and invalid footprints; bindings reset on replacement.

## 2026-09-19 — Reject backdated resource reuse

Fixed a ledger defect where a delivered package freed a worker for a new task with
an earlier timestamp, creating overlapping historical work. Assignment now checks
the resource's latest recorded time transactionally. Tests prove rejection leaves
both package state and event history unchanged and allow exact-boundary reuse.

## 2026-09-19 — Reject conflicting imported resource histories

Transfer imports now check resource intervals across packages and unique pick
ownership, while retaining microsecond time precision. Tests cover overlaps,
unfinished work, exact boundaries, distinct resources and zero-duration events.
The browser rejects a conflicting import and clears the history display.

## 2026-09-19 — Save and restore geometry-bound location links

Added explicit location-link export/import with canonical floor geometry matching.
Changed geometry and malformed links are rejected without overwriting current
associations. Files remain local; link reuse does not validate real-world identity.

## 2026-09-19 — Directed route screening on declared floor geometry

Added a deterministic shortest-path CLI using explicit access nodes, directed
mode-permitted edges, floor bounds and buffered equipment footprints. Invalid or
unreachable routes produce explicit failures/rejected-edge evidence. Added synthetic
fixtures and primary-source scope notes; no safe-route or real movement claim.

## 2026-09-19 — Route exclusion areas

Directed-route screening now enforces saved placement reserved areas, includes them in graph identity, and rejects malformed drafts. Metre units do not depend on equipment cell size. All 27 Python tests pass; browser playback integration remains pending.

## 2026-09-19 — Assumed route timing

Screened routes can produce explicit constant-speed segment timelines with loading and unloading assumptions. Continuous sampling exposes position, heading and stage without inventing locations for unroutable transfers. CLI/library only; browser and SQL integration remain pending. All 30 Python tests pass.

## 2026-09-19 — Browser route scenario playback

Transfer viewer now previews validated timed route exports with continuous 2D load motion, direction, time scrub and 1x–100x playback. Floor/obstacle and timing checks reject incompatible exports. Recorded SQL history remains separate from the assumed scenario. Cache wt-v96; 57 Node harnesses, 30 Python tests and 159 browser self-tests pass.

## 2026-09-19 — Package-specific route scenarios

Read-only SQL scenario export now carries package/order/pick identity and explicit location-to-access-node declarations. Viewer rejects mismatched or stale package snapshots and clears playback on package changes. This does not execute transfers. Cachewt-v96;32Python/57Node/159browser checks pass.

## 2026-09-19 — Route view and follow camera

Added plan/isometric footprint views, fit/2x/4x follow-load cameras, floor grid, endpoint labels and projected headings to route playback. No heights are invented. Both views use the same time and coordinates. Cachewt-v96;57Node/32Python/159browser tests pass.

## 2026-09-19 — Shared-area reservation model

Added deterministic capacity-limited area scheduling with atomic multi-area claims, exact boundary reuse, blocking explanations and horizon-aware events/work-in-progress. CLI/library only; geometry, shifts, physical resources and browser traffic playback remain separate work.38Python tests pass.

## 2026-09-19 — Reservation-driven route playback

Shared-area schedules can now delay a route preview until its planned allocation, show queue context, and preserve unfinished state at the horizon. Imports validate all area capacities and intervals. Claims cover the whole transfer and are not physical collision checks. Cachewt-v96;57Node/39Python/159browser tests pass.

## 2026-09-19 — Explicit availability windows

Area scheduler supports per-request operating windows, rechecks feasibility after area waits, and reports unscheduled work when a full nonpreemptive transfer cannot fit.42Python tests pass. Availability-aware playback and physical workforce assignment remain pending.

## 2026-09-19 — Availability-aware route preview

Browser playback now validates operating windows, explains window waits and displays unscheduled work without movement or false completion. Timeline export supports these outcomes. Cachewt-v96;57Node/43Python/159browser checks pass.

## 2026-09-19 — One-click transfer example

Added a labelled synthetic worked example that loads SQL history, floor and package-associated availability route together, plus a jump to playback. It uses normal validators, protects newer imports from stale responses, and is bundled in PWA cachewt-v97.57Node/43Python/159browser checks pass.

## 2026-09-19 — Skill-aware resource assignment

Added a deterministic greedy dispatcher with explicit skills, availability and directed reposition times. Reports candidate/rejection reasons and horizon state; does not infer missing travel or claim optimal headcount.47Python tests pass. Shared-area coupling and browser worker playback remain pending.

## 2026-09-19 — Joint resource and area scheduling

Resource candidate evaluation now includes declared shared-area capacities and rechecks availability after area waits. Chosen assignments commit all claims together and export reservations and wait reasons.50Python tests pass; geometric traffic validation and browser worker playback remain pending.

## 2026-09-19 — Resource review exports

Resource dispatcher can export a static HTML timing report plus assignments, rejections and area-claim CSVs alongside full JSON. Escaped HTML and formula-safe CSV identifiers tested;51Python tests pass. Visual rendering remains unverified because local browser preview was blocked by URL policy.

## 2026-09-19 — Resource-use metrics

Resource plans now export horizon-clipped work, repositioning, idle availability and utilization, plus completed jobs per simulated hour. Added resource-use CSV/table; jobs are explicitly not picks or units.53Python tests pass; generated report rendering remains unverified.

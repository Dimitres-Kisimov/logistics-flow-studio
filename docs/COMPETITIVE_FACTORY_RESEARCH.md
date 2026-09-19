# Competitive factory simulation research and implementation contract

Checked 19 September 2026. This is a documented first comparison, not an exhaustive product evaluation or a claim of feature parity. Vendor descriptions are vendor claims; editions and integrations differ. Existing factory standards research remains in FACTORY_PLATFORM_PLAN.md.

## What established products provide

| Product and primary source | Documented capability | Implication for our product |
|---|---|---|
| [Siemens Plant Simulation](https://www.siemens.com/en-us/products/tecnomatix/plant-simulation-software/) | Modelling, simulation and optimization of material flow, throughput, resource utilization and logistics; runtime visualization and parameterized experiments. | A competitive planning product needs repeatable experiments, resource constraints and defensible throughput results, not simply moving packages. |
| [AnyLogic material-handling overview](https://www.anylogic.com/) and [Pedestrian Library documentation](https://anylogic.help/library-reference-guides/pedestrian-library/index.html) | Material-handling and pedestrian libraries; documented pedestrian movement responds to obstacles and other pedestrians. | Worker/vehicle traffic needs routing and interaction rules. Our current illustrative worker poses are not equivalent. Detailed material-handling page retrieval returned 403; database-page retrieval failed, so this audit does not assert connector coverage. |
| [FlexSim Experimenter documentation](https://docs.flexsim.com/en/25.1/Reference/Tools/Experimenter/Experimenter.html) and [official release description](https://www.flexsim.com/news/flexsim-2022-reinforcement-learning-experimenter-improvements/) | Experiment results in SQLite and SQL-based results analysis; experiment jobs and reinforcement-learning interfaces are described. | Store each run's assumptions, seed, events and outcomes. Orders/picks execution is a separate transactional concern from a simulation results database. The documentation redirect could not be fully retrieved; the release article was read. |
| [Visual Components manufacturing simulation](https://www.visualcomponents.com/products/manufacturing-simulation/) | 3D layout configuration, CAD import, component libraries, process modelling, virtual commissioning and controller connectivity. Its FAQ distinguishes piece-goods simulation from continuous processes and says liquid-container levels are supported but fluid flow through the layout is not. | Process/manufacturing integration is a possible differentiation target. Our simple flow-conservation model does not yet close that gap: pressure, temperature, reactions and process safety remain unmodelled. |

Public documentation does not establish that competitors lack explainability, compliance support, IFC workflows or simple UX. Treat those as hypotheses for hands-on benchmark work, not marketing claims. No proprietary models or code were copied, and no licence/trial was purchased.

## Positioning hypothesis and evidence needed

Aim for an accessible, auditable planning workflow that combines spatial evidence, operations and utility balances. Candidate advantages are transparent assumptions, offline use, open exports and a constraint explanation attached to each proposal. These are product goals, not proven competitive advantages.

Benchmark the same small fixtures: warehouse pick/pack, mixed assembly, batch-process material balance, blocked exit, unavailable machine and a late receipt. Compare onboarding effort, model setup time, reproducibility, explainability of infeasibility, export quality and supported scale. Record edition, hardware, data, expert assistance, elapsed setup time and unresolved questions. Do not publish speed/accuracy claims without measurements.

## AI placement: solver-backed proposals

The assistant translates a planner's goal into structured inputs; a deterministic constraint engine and optimizer generate and check positions. A language model must not invent clearances or declare a site safe.

1. **Required inputs:** surveyed shell/IFC revision and units, machinery footprints plus access/maintenance envelopes, columns, doors and actual emergency exits, load limits, utilities/ports, material adjacency, directed worker/vehicle routes, occupancy, jurisdiction and process hazards.
2. **Hard constraints:** no collision or out-of-bound placement; preserve reviewed access and egress; respect approved exclusion/separation areas, structural restrictions and equipment envelopes. Missing required evidence creates an unresolved finding and prevents a verified-safe label.
3. **Optimization:** minimize weighted material travel, unnecessary handling and utility connections; meet capacity/service targets; balance usable space, labour and energy. Show multiple feasible trade-offs. Do not monetarily trade away a mandatory safety constraint.
4. **Proposal evidence:** before/after positions, fixed objects, changed routes, rejected candidates, active rule versions, objective values, uncertainty, missing checks and reversible acceptance.
5. **Validation:** known feasible/infeasible fixtures, narrow passages, turning envelopes, doors opening into routes, machine service zones, multi-floor mappings and deliberately missing evidence. Independent specialist review is required before a real installation is treated as approved.

Current generator and optimizer remain heuristic planning aids. This iteration does not add a certified autonomous placement planner. The next placement increment should add explicit fixed/forbidden polygons and candidate rejection reasons before expanding the optimizer.

## Package transfers that represent operations

Each handling unit needs a persistent ID, order/line association, contents, unit, mass/dimensions where known, source/destination, resource assignment and event history. The transfer lifecycle should include waiting, assigned, loading, travelling, blocked, unloading and delivered; goods cannot teleport or appear at two places at once.

Route on a directed traversable graph with clearances and mode permissions. Workers, forklifts, conveyors and AGVs need distinct movement/service models. Include finite buffers, intersection conflicts, loading/unloading time, equipment failures, recharge/refuelling, shift changes and exceptions. Animate the same state that changes inventory and completes tasks. Replay must derive from the event log, not independent decorative motion.

Calibrate travel/service time distributions against approved observations; preserve sample size and units. Compare held-out order completion and throughput distributions. A smooth picture alone is not evidence of realism. The current flow engine has one-minute buckets and synthetic waypoint movement; the new clock does not change that limitation.

## Timer and simulation semantics

Implemented design: 1x–100x playback; one simulated second per real second at 1x; custom durations in minutes, hours and days; one-minute minimum/resolution and 365-day maximum. Elapsed time is based on animation timestamps, not frame count. The timer caps the exact model horizon; Step is capped to the remaining duration. A hidden tab pauses. Frame stalls longer than one second do not cause an unbounded catch-up burst, so effective speed may fall below the selected multiplier on an overloaded device.

Existing movement still updates in minute buckets. At 1x a package may not move for a real minute. Next work is sub-minute travel interpolation tied to the model state, followed by explicit service and resource events. Interpolation must not change event completion times or fabricate physical accuracy.

## SQL execution and data architecture

The first implementation is a real local SQLite prototype (`tools/order_store.py`), separate from the offline browser app. It has items/base units, orders, lines, stock, reserved pick tasks, completion events and an order-progress view. Reservation and completion are transactional. Stock cannot go below reservations; allocated picks cannot exceed line demand. Repeating an identical completion event is idempotent; reusing its ID with different content is rejected.

[SQLite foreign-key documentation](https://www.sqlite.org/foreignkeys.html) requires explicitly enabling relationship checks on each connection. [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html) informs the use of an immediate transaction for reservation/completion. Parameter binding is used for application writes. A bounded query interface allows read-only SQL and denies mutations/ATTACH/PRAGMA. These choices protect this prototype's invariants, not a claim of production-grade authorization.

Next schema work: locations/bins, lots, reservations and cancellations, replenishment, receiving/dispatch, units conversion, order priority/due dates, resources, shifts, equipment states, transport events, meter readings and run/scenario versions. Add migrations, backups, reconciliation, concurrency tests and audit ownership. PostgreSQL can be evaluated for a multi-user deployment; SQLite is appropriate for the current local prototype. Arbitrary LLM-generated SQL must not be given write access to production data.

Browser integration requires an explicit deployment choice: bundled offline SQLite/WASM with persistence, or an authenticated local/server API. It must be disclosed when data leaves the browser. No real ERP, WMS or plant connection is installed in this increment.

## UX and release gates

Use one planner journey: facility → constraints → orders/resources → proposal → simulate → compare → approve/export. Keep a floor overview, an inspector, one clear run bar, and a findings queue. The user should be able to select a package and see its order, contents, destination and current blocking reason. Explain unavailable actions rather than hiding them behind mode names.

Each increment requires numerical invariants, adverse inputs, deterministic runs, browser interactions and regression testing. Timing: compare 30/60/144 Hz, pause/resume, speed changes, exact horizon, reset, reduced motion and background tabs. SQL: double reservation, overpick, missing relationships, rollback, duplicate completion and read-only enforcement. Placement: infeasible layouts and missing evidence. Performance and multi-user scale remain unverified until benchmarked.

Run a focused competitor/source review at each meaningful design decision and a broader weekly comparison. Keep an evidence log of what changed, what was tested and which user problem it solves. Do not claim all competitor functionality has been implemented.

## Placement implementation evidence — 19 September 2026

The warehouse golden-zone optimizer now accepts fixed IDs and axis-aligned reserved
rectangles in metres, with strict field validation and fail-closed baseline conflict
handling. Candidates report rejection counts. UI constraints affect this preview
only, are not persisted/exported or drawn, and do not cover other optimizers.
Stale Apply is blocked when layout, config or constraints change. This implements
part of the proposal contract, not general polygons, egress, swept paths, utility
coordination or safe placement approval. Tests cover a separating barrier at a
non-unit cell size, fixed objects, invalid fields and unchanged inputs. The BAuA
ASR A1.8 page was requested again for this increment but returned403; no new standard
text or regulatory clearance was inferred from that unsuccessful retrieval.

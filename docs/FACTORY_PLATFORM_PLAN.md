# Factory planning and operations platform

Research baseline: 19 September 2026. Working jurisdiction: Germany/EU, provisional pending user selection. Pilot: assembly plus warehouse, with utilities represented as coordinated assets. This is a staged implementation specification, not a claim that all capabilities already exist.

## Product objective

Answer a concrete question: **Can this facility execute this order mix by the due date, with the available people, machines, stock and utilities, while respecting reviewed constraints?** Show alternatives, their assumptions, uncertainty and reasons. Let a planner edit the model and compare the results before approving a change.

The target is an operational digital twin connected to BIM. Without verified physical data and update mechanisms, the current product is a planning simulator. A moving worker icon must never be presented as an observed worker position.

## Existing baseline and gaps

The inspected logistics-flow-studio code already contains an editable grid, process graphs, deterministic simulation, layout optimization, order archetypes, inventory functions, fluid conservation calculations, exports, heuristic advice and a standards knowledge base. Reuse these rather than duplicate them.

- `ifc.js` currently exports IFC4 proxy solids with assumed heights and process properties. It does not import arbitrary IFC geometry or deliver engineering-grade MEP systems.
- `shift.js` and `workers.js` illustrate activity. They are not measured worker trajectories or a validated labour-allocation model.
- `fluids.js` is a steady-flow capacity graph. It does not calculate gas pressure loss, combustion, leakage or hydraulic safety.
- `advisor.js` is a deterministic heuristic engine. It does not train itself or provide a connected LLM chatbot.
- `compliance.js` checks simplified grid geometry and currently treats docks as exits. Actual exits, door properties, occupancy and fire compartments need explicit modelling before egress findings can be engineering evidence.

## Model architecture

Keep IFC as the building and equipment exchange format; augment it with an operational graph and time-series/event store. IFC alone is not an order scheduler, inventory ledger or live meter database.

| Layer | Required content | Interchange and validation |
|---|---|---|
| Facility | Site, buildings, storeys, spaces, doors, surveyed obstacles, clear heights, floor loads, access and service envelopes | IFC import with preserved GlobalId, units, placements, coordinates and source revision; validate before converting to render meshes |
| Visual scene | Selectable equipment and spaces, section cuts, layers, movement paths and utility overlays | Derived glTF/GLB for rendering; retain mapping to IFC identity; meshes never replace the source model |
| Assets and utilities | Machines, stations, storage, pipe/cable segments, ports, valves, isolation points, meters and system membership | IFC distribution systems where supported; typed operational connections; unsupported objects remain visibly unmapped |
| Operations | Orders, BOM versions, operations, precedence, setup families, yield, rework, skills, shifts, maintenance and resources | Versioned JSON/API records linked to asset IDs; distinguish touch time from automatic machine time |
| Events | Receipts, moves, reservations, issues, production, scrap, dispatch, downtime, worker task changes and energy readings | Append-only events with unique IDs, timestamps/time zones, units, provenance, revision and quality flag |
| Decision support | Simulation runs, constraints, alternatives, objective weights, confidence, findings and approval | Reproducible run ID, input hash, model version, seed, source measurements, comparison and rollback |

Do not access the previously excluded BIM repository. Start IFC work within logistics-flow-studio and only use explicitly supplied or licensed public sample models. No real facility model has yet been supplied for calibration.

## Planner workflow and visual design

1. Import a building or draw a measured shell; display units and coordinate validation before accepting it.
2. Map spaces, machines and utilities. Unmapped IFC objects get a visible review queue.
3. Define access aisles, approved pedestrian routes, vehicle routes, crossings, exits, machine service envelopes and utility exclusion zones as separate layers.
4. Enter/import orders, BOMs, processing times, shifts, skills, opening inventory and interval meter readings.
5. Choose the demand objective: due-date service, cost, energy, lead time or WIP. State which constraints cannot be traded away.
6. Run a baseline and alternatives. Show bottlenecks and infeasibility before improvement percentages.
7. Review a proposal: what moves, who is reassigned, what stock is consumed, which constraints were checked and what remains unknown.
8. Export the decision pack and retain the previous version.

Use a restrained industrial drawing vocabulary: neutral structure, distinct material/person/utility paths, persistent legend, real units, labelled status and progressive detail. Provide 2D for precise edits and 3D for spatial review. Do not place every KPI or moving icon on the floor simultaneously. Keyboard and non-colour cues must remain available.

## Production methods and space optimization

Compare methods on the same orders, machine availability, setup matrix and disturbance seeds:

| Method | Model behaviour | Useful question |
|---|---|---|
| Push / scheduled release | Release according to planned dates and quantities | Does forecast release create excess WIP or overload downstream resources? |
| Kanban pull | Replenishment requires a downstream signal and available cards | What card count meets service without excessive stock? |
| CONWIP | A finished unit releases permission for another job into the controlled loop | What WIP limit balances throughput and lead time? |
| Drum-buffer-rope | Release paced to the constraint with an explicit protective buffer | Does the bottleneck stay supplied without flooding the factory? |
| Hybrid | Forecast upstream, order-driven downstream at a defined decoupling point | Where should postponement and inventory buffers sit? |
| Dispatch rules | FIFO, earliest due date, shortest processing time and setup-family batching | Which rule improves tardiness without starving long jobs? |

Implement release policies as engine behaviour, not palette labels. Test card conservation, WIP caps, starvation, blocking, setups, scrap and deadlock. Use discrete-event simulation for queues and scheduling; use optimization to propose candidates, then evaluate them in the simulation.

Layout objectives include weighted material travel, people/vehicle conflict exposure, usable storage, service access, expansion room and utility connection cost. Hard constraints include approved clearances, structural restrictions, access envelopes, exits and prohibited adjacency. Do not optimize safety violations away with a monetary penalty. Report a Pareto set and infeasible cases rather than claiming a universal optimum.

## Staffing and worker routes

Start with manual, editable task and route data. Every route segment needs direction, allowed transport modes, distance, slope or stairs where relevant, crossings and restrictions. Users can redraw a route, change an assignment and record a reason. Planned movement and observed movement must be separate layers.

Calculate a workload lower bound: total labour minutes divided by available productive minutes per worker, rounded up. This is not an ideal headcount. Then schedule by skill, simultaneous crew size, machine precedence, travel, breaks, handovers and shift boundaries. Machine bottlenecks can make an order infeasible regardless of added workers.

If real tracking is later added, agree purpose, access, retention and worker consultation requirements before rollout. Default to task/zone-level planning and team aggregates. Model calibration should use approved observations, not covert personal surveillance or individual productivity ranking.

## Utilities and inventory accounting

**Electricity:** store import and export separately at the boundary. Net import = import minus export. For each interval, reconcile import + generation + battery discharge against export + load + battery charge + declared losses. A residual is a data-quality finding, not unmetered demand invented by the app. Preserve meter hierarchy to avoid double-counting parent and submeter energy. Keep kW, kWh, kVA and power factor distinct. Include tariffs, peak demand, PV, storage state of charge and time-zone handling in later scheduling work.

**Gas and other services:** model supply, consumers, meters, isolation points, system identity, pressure class, medium, flow units and inspection status. Gas volume requires declared reference conditions; do not mix standard and actual cubic metres. Electricity balancing is not cable sizing; fluid-flow capacity is not gas-pipe design. Specialist calculations and reviewed inputs are required for pressure drops, material compatibility, hazardous zones, protection coordination and emergency isolation.

**Inventory:** opening + receipts + production + returns + adjustments - issues - dispatch - scrap = closing. Maintain SKU, lot, unit, location, quality state and reservations. Check for intermediate stockouts in event order, not only positive closing balances. Prevent negative availability and duplicate event ingestion; never sum unrelated units into one quantity. Add BOM consumption and finished-goods genealogy before calling the model production traceability.

## KPI dictionary and exports

Every metric includes formula, unit, time window, source, quality, denominator and model/measurement status.

- Picks per productive labour hour (Picks pro Stunde), plus picks per paid labour hour; define whether a pick is an order line, item or location visit.
- Good units/hour, orders/hour, on-time completion, late orders, cycle and lead-time percentiles.
- WIP, queue time, blocked/starved time, machine utilisation, setup share, first-pass yield and rework.
- OEE only with explicit availability/performance/quality definitions and non-overlapping losses; do not multiply inconsistent denominators.
- Metres/order, labour minutes/order, replenishment travel, congestion exposure and crossing counts.
- Gross electricity import/export, net exchange, peak kW, kWh/good unit, data coverage and balance residual.
- Opening/closing stock, available/reserved stock, stockouts, ageing, inventory accuracy and loss reasons.

Exports: versioned JSON scenario and results; CSV event, KPI, staffing and meter tables with units; IFC coordination model; BCF issues for mapped model objects; GLB visual snapshot; SVG/PNG floor and charts; a readable HTML/PDF decision pack. XLSX/Parquet and API connectors are later integrations. Test import/export round trips, IDs, units, locale, timestamps, spreadsheet formula injection and provenance.

## Standards and regulatory research register

These are applicability candidates, not a declaration of conformance. Public metadata and guidance were reviewed; licensed full ISO/IEC/DVGW texts were not acquired. Each implemented rule needs jurisdiction, edition, clause reference, input requirements, source access, reviewer, date and status: not assessed / missing evidence / screening finding / professionally reviewed. Missing evidence cannot produce a pass.

| Source checked | Relevance and implementation decision |
|---|---|
| [ISO 23247-2:2021](https://www.iso.org/standard/78743.html) | Manufacturing digital-twin reference architecture. Separate observable assets, data services and applications. Architecture guidance, not a safety certificate. |
| [buildingSMART IFC](https://www.buildingsmart.org/standards/bsi-standards/industry-foundation-classes/) | Official IFC 4.3.2.0 is associated with ISO 16739-1:2024. Support incoming schema versions explicitly; retain existing scoped IFC4 export until a tested migration. |
| [IfcDistributionSystem](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcDistributionSystem.htm) | Utilities belong to connected systems rather than unrelated coloured lines. Geometry, connectivity and operating state are separate validations. |
| [ISO 22400-2:2014](https://www.iso.org/standard/54497.html) | KPI definitions with dimensions and time behaviour; 2017 energy amendment. Published edition is marked for revision and a DIS is listed. Track status changes; do not silently substitute draft formulas. |
| [ISO 12100:2010](https://www.iso.org/standard/51528.html) | Machinery risk assessment and reduction. Catalogue lists confirmation in 2022 and a draft successor. Keep the current published edition distinct from the draft. |
| [ISO 50001:2018](https://www.iso.org/standard/69426.html) | Energy-management framework. Build auditable energy baselines and performance indicators; software alone cannot certify a management system. |
| [BAuA ASR A1.8](https://www.baua.de/DE/Angebote/Regelwerk/ASR/ASR-A1-8) and [coordinated escape/traffic guidance](https://www.baua.de/DE/Angebote/Regelwerk/ASR/Flucht-und-Verkehrswege) | A1.8 page records March 2022 edition, amended 2024. Path requirements depend on use and occupancy; add A2.3, accessibility and building/fire requirements to the applicability review. No universal aisle number. |
| [IEC 60204-1](https://webstore.iec.ch/en/publication/26037) | Machine electrical equipment from its supply connection. Facility electrical installation and utility connection requirements need a separate scope review. Do not extrapolate machine rules to the whole site. |
| [DVGW industrial application](https://www.dvgw.de/themen/gas/installation-und-anwendung/industrielle-anwendung) | Industrial gas infrastructure has its own rule set; page lists G 614-1 (2025-08). Determine scope from gas, pressure, installation and ownership; do not apply domestic TRGI indiscriminately. |
| [BAuA TRGS 720](https://www.baua.de/DE/Angebote/Regelwerk/TRGS/TRGS-720) | Explosive-mixture hazard assessment is an explicit workstream if the process uses relevant media. Add zone documents and equipment suitability evidence, not an automatic gas-line approval. |
| [EU machinery transition](https://single-market-economy.ec.europa.eu/single-market/goods/european-standards/harmonised-standards/machinery-md_en) | Commission guidance states the Machinery Directive is replaced on 20 January 2027. Recheck applicable consolidated legislation and transition provisions when a real installation is specified. |

Further applicability review: occupational risk assessment, national electrical rules, fire/building permissions, pressure equipment, ATEX where applicable, ergonomics, machine-specific type-C standards, industrial cybersecurity and worker-data governance. These are unresolved work items, not completed checks.

## Research programme: modern factories

Research must produce a testable hypothesis, baseline, data requirement and acceptance gate.

1. **Connected standards-based twins.** [NIST use cases](https://www.nist.gov/publications/use-case-scenarios-digital-twin-implementation-based-iso-23247) inform a modular architecture: no one twin solves every production problem. Benchmark the order-to-asset identity chain before adding richer graphics.
2. **Human-centred immersive review.** The [2025 ISO 23247/VR study](https://arxiv.org/abs/2508.14580) demonstrates integration and discusses AI/environmental KPIs as further stages. Treat it as integration evidence, not proof of autonomous factory optimization. Test whether 3D review exposes errors missed in 2D.
3. **Continual validation before continual learning.** A [July 2026 preprint](https://arxiv.org/abs/2607.18164) studies drift detection, model updating and validation in additive manufacturing. Its reported case studies do not establish general factory reliability. Adopt the evaluation discipline first: detect drift, hold out data, compare versions, roll back regressions.
4. **Trustworthy decisions.** [NIST validation work](https://www.nist.gov/digital-twins/validating-and-advancement) supports explicit validation as a development concern. For this product, replay historical shifts and report prediction error by order family, not just a single attractive average.

Next targeted research: energy-aware job-shop scheduling, robust layout optimization, human/AMR shared-space planning, semantic IFC-to-operations mapping and pull-policy performance under variable demand. Do not label an algorithm state of the art solely because it uses AI.

## Inbuilt assistant

The assistant should use a governed tool layer: query the current scenario, retrieve permitted source documents, calculate KPIs, run alternatives and return a proposed change with evidence. A response such as “add two workers” must cite the workload, skills, bottleneck and objective used.

Retain user-approved goals, constraints, definitions and corrections as versioned project memory. This is controlled adaptation, not automatic training on every conversation. Keep source documents and telemetry separate from instructions. Permit users to inspect, edit, delete and export memory. No cloud transmission of facility data is assumed.

Phase A: offline calculated explanations and explicit missing-data questions. Phase B: local or server-side model adapter, retrieval with access controls, tool schemas and execution logging. Never put provider secrets into the browser. Phase C: evaluate grounded responses, wrong-unit handling, stale data, malicious document instructions, unsafe recommendations and reversibility. The model cannot approve electrical/gas safety or issue machine-control commands; a planner accepts a reviewed proposal through the product workflow.

Model/provider, deployment location, data-sharing permission and cost limit remain to be selected before an external model connection. Existing rule-based advice must retain its honest label until that connection and its tests actually work.

## Delivery stages and acceptance gates

| Stage | Deliverable | Required acceptance |
|---|---|---|
| 1 | Resource accounting kernel, synthetic example, JSON/CSV/HTML report | Hand-checkable staffing bound; shortages by SKU; electricity conservation; reject invalid/duplicate inputs; deterministic outputs |
| 2 | Integrated editable resource panel and linked order/asset IDs | Browser edits change the same engine; import/export round trip; offline and accessibility checks |
| 3 | IFC import and 2D/3D mapping | Known fixture geometry/units/placements/IDs; explicit unsupported entities; no silent geometry repair |
| 4 | Directed worker/vehicle paths and staffing scheduler | Skills, breaks, concurrency and route restrictions; feasible/infeasible cases; manual override history |
| 5 | Push/pull/CONWIP/constraint-paced comparison | Release-policy invariants, same demand and disturbance scenarios; uncertainty and service/WIP trade-offs |
| 6 | Utility topology and reviewed safety screening | Typed connections, isolation/access layers, explicit unknowns; specialist evidence before engineering claims |
| 7 | Connected assistant and measured-data validation | Provider works; tool-grounded answers; memory controls; no unexplained actions; held-out accuracy and rollback |

Every cycle: check relevant primary sources and source revisions, inspect current features, implement one bounded improvement, run regression and conservation tests, compare baseline/candidate, inspect the UI, publish a review branch and log limitations. Weekly standards review is a proposed cadence; the existing hourly programme remains bounded by its current deadline unless extended by the user.

## Current implementation checkpoint

Two selectable operating profiles are required: assembly/warehouse and process manufacturing. Germany/EU remains a provisional jurisdiction, not a confirmed site. The user extended the programme to daily work until stopped; the old 24-hour deadline no longer applies.

Stage 1 now exists as `tools/resource_plan.py`, selected with `--profile assembly-warehouse` or `--profile process-manufacturing`, or supplied with a versioned `--input` JSON file. It exports human-readable HTML, complete JSON and four CSV tables. Synthetic fixtures expose a stock shortage and an unreconciled energy interval. Staffing results are skill-specific workload lower bounds, not an optimal roster. There is no live IFC import, measured tracking, full scheduler or connected AI assistant in this increment.

The next product step is an integrated browser mode selector and editable resource panel using the same validated model contract. The process profile additionally needs batch/continuous selection, recipe and yield versions, vessel capacity, hold/quality-release states, cleaning/changeover time, lot genealogy, utility demand and reviewed process hazards. Assembly/warehouse needs BOM/kit availability, picking/replenishment, takt, skills, handling routes and order dispatch. Both need real data calibration before predictions are described as accurate.

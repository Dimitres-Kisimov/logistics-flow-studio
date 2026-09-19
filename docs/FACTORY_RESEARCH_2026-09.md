# From a moving picture to a useful planning tool

Research reviewed 2026-09-19. Sources below inform design decisions; they do not validate this simulator, supply site-specific rates, or establish certification. Proposals are explicitly separated from implemented behaviour.

## What the current implementation actually establishes

The v3.25 model already contains order recipes, station queues, a returns split, multi-way factory flow and deterministic material animation. Adding more animated objects would not by itself close the operational gap.

The first inspection found a subtler problem: five legacy anchors can resolve to zone centres or fallback coordinates with no matching equipment. A route can therefore be drawable on an empty floor. The v3.26 route review retains this backward-compatible animation but exposes missing physical evidence. It also presents every required operation, including unsupported steps, and both returns outcomes. It does not change the simulation, assign capacity, or switch the playback recipe.

## Industrial findings and their product implications

### A route needs both movement and control

HSE recommends separating pedestrians and vehicles, controlling access, and providing appropriate crossing points, visibility and barriers. Painted lines are only one measure. Source: [HSE, Separating pedestrians and vehicles](https://www.hse.gov.uk/workplacetransport/separating.htm).

**Design inference:** a plausible line on a floor plan cannot count as a verified safe route. A later transport model needs explicit permitted edges, crossing conflicts, direction, clearance and waiting rules. Until those exist, label movement schematic. Do not imply that drawing a green line or animating a forklift proves safe access. The new review explicitly excludes safe-access verification.

### A dock is a controlled work area, not just a destination

HSE's loading guidance covers exclusion of unrelated traffic and people, load stability, brakes/stabilisers, a suitable loading surface and a safe waiting place for drivers. Source: [HSE, Safe driving: loading and unloading](https://www.hse.gov.uk/workplacetransport/factsheets/loading.htm).

**Design inference:** a future dock state machine should separate arrival, bay allocation, securing, permission to load, loading, release and departure. Guards must prevent incompatible activities; queues must retain truck identities. A drawn trailer currently proves none of this. Do not derive truck capacity or loading times from a visual footprint.

### Quality exceptions must change the flow

Toyota describes jidoka as stopping when an abnormality is detected; its Just-in-Time explanation connects downstream consumption with replenishment by upstream processes. Source: [Toyota, Toyota Production System](https://global.toyota/en/company/vision-and-philosophy/production-system/).

**Design inference:** quality checking should eventually create held material with an explicit release or disposition, not a decorative pause. The existing recipe's goods-in QC is a pass-through, and replenishment is embedded in an order sequence. Those limits remain. A genuine extension needs stock eligibility, holds, release events and independent replenishment requests with conservation tests. An andon should name the cause and required response, without claiming that a warning colour itself implements quality control.

### Traceability follows events and identities

GS1 distinguishes Critical Tracking Events such as receiving, transforming, packing and shipping from the data describing each event, including who, what, where, when and why. Source: [GS1 Global Traceability Standard, section 3.1](https://ref.gs1.org/standards/global-traceability/).

**Design inference:** the next evidence layer should record stable handling-unit identity, operation, location, model tick, status and parent/child relationships. Keep model time distinct from measured timestamps. A pallet changing its drawing into cartons is not proof of a real split or conservation across quantities. First expose the existing operation sequence; then build quantity-aware transformations. Do not label a bespoke event export EPCIS-compliant without an implementation and validation of that specification.

### Shifts are resource calendars

BAuA discusses health and social effects of night/shift work and the importance of shift scheduling. Its working-time checklist covers breaks, rest periods and schedule constraints. Sources: [BAuA, Night and shift work](https://www.baua.de/DE/Themen/Arbeitsgestaltung/Arbeitszeit/Nacht-und-Schichtarbeit), [BAuA, Working-time checklist](https://www.baua.de/DE/Themen/Arbeitsgestaltung/Arbeitszeit/Checkliste-Arbeitszeit). These pages were available as search-index extracts; direct retrieval of the first page was blocked during this review.

**Design inference:** animation poses are not staffing capacity. Model machine calendars and qualified labour calendars separately; then define cover during breaks, handovers and shared tasks. No legally compliant schedule or fatigue score is implied. Site-specific agreements and assessments remain outside this teaching model.

### Faster machines do not remove changeovers

Lean Enterprise Institute's discussion of setup reduction connects changeovers with batching and flow. Source: [Art Byrne / LEI, Why Does Setup Time Reduction Matter So Much?](https://www.lean.org/the-lean-post/articles/ask-art-why-does-setup-time-reduction-matter-so-much/).

**Design inference:** product families and sequence-dependent setups should be explicit inputs, with setup time separated from productive time, downtime and starvation. Compare policies under the same demand and calendar. Do not copy published success stories into estimated savings. First inventory process.js and the existing optimisers to avoid replacing already-tested calculations.

### Verification is not site validation

NIST's manufacturing digital-twin programme treats validation and quantified uncertainty as central to trustworthy models and describes interoperability and traceable results as ongoing research concerns. Source: [NIST, Digital Twins for Advanced Manufacturing](https://www.nist.gov/programs-projects/digital-twins-advanced-manufacturing), updated July 2026.

**Design inference:** deterministic tests prove that implementation follows its specified model; they do not establish that site behaviour is predicted accurately. Calibration inputs need units, provenance, observation windows and held-out comparisons. Keep measured, imported and illustrative inputs visibly distinct. Preserve counterexamples and sensitivity ranges in the review and exported report.

## Implementation order and acceptance conditions

| Decision | Existing foundation | Proposed next capability | Evidence required before claiming completion |
|---|---|---|---|
| Can this order follow its recipe? | routing.js and flowsim.js anchors | **Implemented:** route review with placed/shared/fallback/missing/unsupported states | Empty-floor counterexample, missing outbound dock, returns branches, deterministic output, live selector |
| Where did the order stop? | Per-unit routes and station queues | Operation/event trace | No lost or duplicated identities; exact terminal disposition |
| Can blocked stock be picked? | Pass-through QC and returns split | Hold/release state machine | Held quantity never eligible; conservation across release, rework and scrap |
| Can the shift finish the demand? | Existing capacity and factory models | Resource calendars and setup losses | Zero-resource cases, hand calculations, no double subtraction of losses |
| Can a vehicle reach the station? | Schematic waypoint geometry | Permitted movement graph and conflict rules | Obstacle cases, no simultaneous exclusive crossing use, deterministic contention |
| Does the model match a site? | Imported SKU/order data and deterministic results | Provenance and validation workflow | Documented observations and independent comparison; no inferred measurements |

All rows after route review are proposals, not delivered features. Prioritise a complete decision loop over a longer feature list.

## Visual direction

Use the existing concrete-and-steel palette. Keep the rail and drawers. Give a planner one question, one clear result, then ordered evidence and an actionable gap. Reserve amber/red for named conditions; never communicate status through colour alone. Keep provenance near decisions while moving implementation history out of product copy. An unsupported operation stays visible rather than disappearing from the flow.

## Reproduction and limits

Run `node verify_route_review.js` and `node test/run-all.mjs`. Serve the app and open `index.html?selftest=1&onboarding=0&tour=off` for the real UI checks. In Simulate, expand Live material flow and choose an order route.

Equipment evidence is only as specific as the existing anchor taxonomy: generic station/dock classes can satisfy legacy anchors, and multiple operations can share an element. No new throughput estimate, staffing calculation, safety approval or production-readiness claim is introduced. The new panel reviews recipes; the playback remains the default teaching spine.

# Shared-route simulation: research and acceptance contract

Reviewed 19 September 2026. This is a design contract, not implemented traffic control.
Current route playback is one constant-speed scenario. It does not resolve interacting
workers/vehicles, schedule shifts or reserve intersections. The SQL ledger protects
resource history consistency but does not predict route occupancy.

## Primary-source evidence

| Source and retrieval | Documented capability or scope | Product implication |
|---|---|---|
| [Autodesk FlexSim 2027 Control Area panel](https://help.autodesk.com/view/FLEXSIMIN/2027/ENU/?guid=FlexSim_User_Manual_reference_propertiespanels_agvpanels_controlarea_html), full page read | Area capacity limits simultaneous AGV claims. Allocation/release is tied to network participation and configured release behaviour. A* release uses traveller centre position; its treatment differs from AGV release types. | Keep capacity, entry and release semantics explicit. A point crossing the exit must not automatically imply that an entire vehicle or train cleared it. This is competitor functionality, not an identified competitive gap. |
| [AnyLogic path-guided navigation](https://anylogic.help/library-reference-guides/material-handling-library/path-guided-navigation.html), search-index text available; direct retrieval returned 403 | Indexed official text describes network navigation, collision waiting, crossroads and custom routing. It also identifies geometry/configuration-dependent collision limitations. | Treat this as provisional evidence pending a directly inspectable version. Do not infer guaranteed collision avoidance or compare accuracy from a feature description. |
| [NIST Digital twins](https://www.nist.gov/digital-twins), full page read | Manufacturing twin work includes requirements, data management, model development, validation and maintenance. | Define intended use and measured validation targets before advertising predictive accuracy. Our static checks and synthetic tests establish only their tested invariants. |
| [NIST Digital Twin Standardization](https://www.nist.gov/digital-twins/digital-twin-standardization), full page read; page updated 13 February 2026 | Describes ISO 23247 as a framework for shared terminology, reference models and interfaces, and links manufacturing use-case publications. | Map facility, operations, observations and services explicitly. This source is not a factory safety clearance rule or evidence of ISO conformity. |

The old FlexSim 23.1 AGV-network link now leads to a legacy-documentation notice.
Its offered latest-network link returned a page-not-found screen. The Control Area
page above was retrieved separately and identifies itself as 2027 documentation;
this review makes no claim about availability of a specific installed product edition.
No trial, licensed standard or hands-on competitor benchmark was obtained.

## Proposed operational model

Separate four concepts in the data model:

- **Physical resource:** stable ID, transport mode, dimensions, load capability,
  skills, shift/break calendar, speed/acceleration assumptions and current assignment.
- **Transport request:** package ID, quantity/unit, access-node endpoints, release
  time, due time, priority and loading/unloading requirements.
- **Shared-area claim:** reviewed area/network revision, capacity, entry/exit
  rules, requesting resource, grant/release timestamps and blocking reason.
- **Simulation event:** run ID, sequence, simulated timestamp, resource/request,
  event type and cause. These events belong to a scenario store, never implicitly
  to the actual-execution ledger.

Initial scheduling should use nonpreemptive transfers with explicit shift feasibility
and deterministic ordering by release time, priority and request ID. Allocation must
be atomic across simultaneously required areas, or use an explicit acquisition order
with deadlock detection. Do not introduce a partial-lock scheduler that silently hangs.
This is a proposed baseline policy, not an optimal staffing or dispatch algorithm.

Workers and vehicles need distinct capability and geometry inputs. No invented human
walking speed, forklift safety gap or statutory aisle width is a default. Unavailable
inputs should create findings; time inputs may be explicit synthetic assumptions.
Traffic scheduling is not a substitute for reviewed physical separation or a safety system.

The first traffic fixture should use a capacity-one conflict zone and point-travel
semantics labelled as such. Subsequent body-aware release must account for declared
length and turning envelope. A train's tail clearance cannot be approximated silently
by its leading point. Keep both model versions reproducible and separately labelled.

## Hand-checkable acceptance fixtures

These are specified expected results for future implementation, not passing tests.
All times are synthetic simulation seconds. Boundary reuse uses half-open intervals.

| Case | Given | Required result |
|---|---|---|
| Exclusive crossing | A requests a capacity-one zone at 0 for 4 s; B at 1 for 3 s | A occupies [0,4), B [4,7); B waits 3 s with A/zone as cause. |
| Exact release boundary | A releases at 4; B requests at 4 | B can enter at 4; no artificial extra timestep. |
| Capacity two | A at 0 for 4 s; B at 1 for 3 s; C at 2 for 2 s | A/B overlap as allowed; C enters at 4 and leaves at 6. |
| Same resource | A uses R from 0 to 10; B requests R at 3 | B cannot start before 10, plus declared reposition time. Reposition path absent means unresolved, not zero. |
| Shift boundary | Nonpreemptive 6 s task released at 8; R available [0,10), [20,30) | Start at 20, finish 26. Do not execute through the unavailable interval. |
| Deadlock cycle | R1 holds Z1 and needs Z2; R2 holds Z2 and needs Z1 | Explicit cycle finding or policy-prevented acquisition; never a falsely completed run. |
| Horizon conservation | B remains queued when horizon ends at 3 | Record unfinished work and residual wait; do not count it as delivered. |
| Body release | Lead point exits at 4, declared tail exits at 6 | Body-aware zone remains occupied until 6; point model must identify its different assumption. |
| Playback invariance | Same seed/input at 1x and 100x; browser hidden mid-run | Same simulation event times and outcomes; only wall-clock playback changes. |

## KPIs and validation evidence

Report completed transfers per simulated hour, picks per labour-hour with a declared
denominator, elapsed lead time, queue wait by cause, travel/service/break/idle time,
resource utilization within availability, WIP at horizon and due-date service.
Do not mix completed transfers with picked units or equate worker headcount with
available labour-hours. Use distributions and percentiles alongside totals.

For predictive validation, record source period, sample count, units, clock alignment,
missing observations and calibration/hold-out separation. Compare held-out order lead
times, waiting time and throughput by order family/shift. Report error and uncertainty;
no site data has yet been supplied, so no real-world accuracy figure is available.

The UX should let a planner select a stopped load and see the specific resource or
zone, who holds it, the request time and expected release under current assumptions.
Manual changes create a new scenario revision and invalidate affected reservations.
An assistant may explain or propose alternatives using this state; it cannot override
a hard constraint or issue equipment commands.

## Competitive scope

We have not demonstrated feature parity with AnyLogic, FlexSim, Plant Simulation or
Visual Components. Transparent assumptions, simple imports and explainable waiting
are design objectives, not proven missing features of those products. Compare the
same fixtures, editions, hardware and modelling effort before publishing performance
or usability claims. Genuine 3D, calibrated traffic and IFC import remain open work.

## Implemented area-reservation prototype

Run python tools/traffic_schedule.py --input examples/routes/area-requests.json. The CLI/library accepts factory-area-requests/v1 and exports factory-area-schedule/v1. Areas have integer capacity1–100; each request has unique ID, explicit nonnegative release seconds, positive duration seconds, area IDs and optional integer priority. Limits:100areas/1000requests/365day horizon and individual timing input bounds. No large-scale performance claim has been measured.

Release time ascending, then priority descending, then ID determines reservation order. This is deterministic reservation scheduling, not globally optimal dispatch or an online priority queue. Earlier requests can reserve a future interval; later requests may use a gap only when the entire requested duration fits. All requested areas are acquired together and held for the full duration; there are no partial holdings or intermediate acquisitions. This prevents hold-and-wait cycles in this limited model, but is not a general deadlock detector. Unreviewed geometric crossings are not inferred.

Half-open occupancy permits exact boundary reuse. Explanations list failed candidate starts, blocking area/holder IDs and the next candidate start. A conflict later in a proposed interval can block the whole reservation, so these explanations are search decisions rather than an observed continuous wait trace. Events at equal times order release before request before grant. Events beyond the horizon are excluded; future start/end times remain labelled plans. Not-yet-released requests do not count as unfinished work. Horizon state includes events exactly at the boundary.

Acceptance status: exclusive crossing, exact release boundary, capacity-two and horizon conservation now have passing tests. Atomic multi-area acquisition, future-reservation overlap, priority ties, determinism/nonmutation, invalid inputs and an80-request seeded capacity invariant are also tested. Same-resource repositioning, shifts, body-aware release, browser traffic playback and calibrated measurements remain unimplemented. This does not complete the original traffic contract.

All38Python tests and Ruff pass. CLI sample horizon6s completesA but leavesB occupying until planned7s;Bwait3s is explained byA/CROSSING-A. No SQL writes or browser integration are added in this increment.

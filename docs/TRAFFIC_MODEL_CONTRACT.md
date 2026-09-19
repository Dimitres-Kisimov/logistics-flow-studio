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

## Reservation-driven route preview

The scheduling CLI accepts --timeline examples/routes/timeline.json --request TRANSFER-B together with --input examples/routes/route-area-requests.json. It attaches the full schedule to the chosen timeline only when the request duration equals the full loading/travel/unloading duration. Existing reservation attachments are rejected. Example output is examples/routes/reserved-timeline.json; it remains an unbound synthetic scenario, although package-associated timelines can also carry this attachment.

The browser checks area IDs/capacities, every request interval and half-open simultaneous occupancy before using the selected reservation. It verifies the selected duration against the geometry-derived timeline. It does not independently reproduce the scheduler policy, trust imported explanation strings, authenticate the schedule, or verify which geometric segments cross the named areas. All areas are conservatively held for the whole transfer. These are declared logical claims, not physical collision checks.

Playback uses the schedule horizon as its clock limit. Before release it reports not-released, then queued at the declared route start until planned grant, then plays loading/travel/unloading with that time offset. The queue note identifies other shared-area reservations before entry; those may be future reservations rather than current occupants. At the horizon it preserves unfinished state. One selected load is drawn; other requests are explained but not animated.

Tests cover timeline binding, overlapping capacity rejection, unknown requests, stationary queue positions and horizon clamping. Browser imports showed queued at10s, travelling at30s and still unloading at40s.57Node/39Python/Ruff/159browser tests pass. Generated JSON repeats identically. This completes a limited reservation-to-visual connection, not the full resource/shift/body/traffic model.

## Availability-window screening

Requests may now carry availability_s as up to100 sorted nonoverlapping [start,end] simulation-second windows. The nonpreemptive transfer must fit wholly within one window, including an exact finish at the window end. Adjacent windows are not merged automatically. Area contention triggers another window feasibility check before reserving anything. An empty list means no availability; omission preserves the explicitly unrestricted-time baseline.

If no window fits, planned times/wait are null, no grant/release event is emitted and released work counts as unfinished/unscheduled. Future unreleased work remains not-released. Other requests continue scheduling. These are per-request declared availability constraints, not worker identity, skills, labour law compliance, a resource calendar or an optimal roster.

Run tools/traffic_schedule.py --input examples/routes/availability-requests.json. Its6second task releasedat8 runs20–26; its11second task isunscheduled.42Python tests/Ruff pass, including area delay rechecking, exact window-end completion, malformed/overlapping windows and missing capacity grants. Existing no-window scheduling behaviour remains compatible.

Availability-aware schedules are now supported by the browser contract described below. Physical workforce assignment and calendars remain separate work.

## Availability-aware playback

The timeline binder now accepts both scheduled and unscheduled requests. Browser import checks declared windows for sorted nonoverlap and verifies every allocated transfer lies entirely inside one window. Unscheduled rows require explicit availability and null planned times; they consume no area capacity. Their infeasibility is a scheduler outcome, not independently proven by the browser importer, which does not reproduce scheduling policy.

The selected unscheduled request stays at its declared route start; before release it is not-released and thereafter unscheduled. It never receives fabricated travel or completion. Queue notes list declared windows and planned entry time. These semantics apply in both plan and isometric views.

Generate examples/routes/availability-timeline.json using --input examples/routes/availability-route-requests.json --timeline examples/routes/timeline.json --request NEXT-WINDOW. Select NO-FIT instead to inspect an unscheduled scenario. Browser verified10squeued/30splannedentry,40stravelling7.80/6.00m;NO-FITremained4.00/4.80m at60s.57Node/43Python/Ruff/159browser checks pass. Worker skills, actual staff calendars and measured productivity remain unfinished.

## One-click worked example

The transfer viewer now offers Explore synthetic example, loading one bundle generated by tools/make_transfer_demo.py from the SQL, route, package and availability tools. The example is explicitly synthetic and replaces only the current viewer state, leaving files/SQL unchanged. It loads paused at10x selected playback speed, with a jump link to the route section. Same production import validators check the bundle. Newer user imports or edits cancel an in-flight example load.

The bundled JSON is in the PWA precache for offline use after installation. Initial serving requires localhost/HTTP; direct file-page fetch may be unavailable, where manual file imports remain supported. Actual offline-network disabling was not exercised in this increment. Browser verified buttonload, package/order/pickassociation, jumplink, play and60shorizoncompletion.57Node/43Python/Ruff/159browser checks pass. Demo generation repeated with identical bytes.

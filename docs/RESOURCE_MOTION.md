# Scheduled resource motion

This page describes the base, unbound scenario. For optional SQL package identity
and version-checked snapshots, see [SQL-linked scenarios](PACKAGE_RESOURCE_MOTION.md).

`tools/resource_motion.py` joins directed, footprint-screened geometry to resource dispatch. Previously dispatch accepted travel durations independently of visual route geometry. This adapter derives work and return durations from the same paths used to sample positions.

Run from the repository root:

```text
python tools/resource_motion.py --input examples/routes/resource-motion-input.json --floor examples/routes/floor.json --graph examples/routes/resource-motion-graph.json
```

Add `--at-s 61` to inspect all resource and load positions at one shared simulation time. The default output is a `factory-resource-motion/v1` scenario with the complete dispatch plan, initial resource anchors, screened work paths, and selected return paths. Sampling is for internally generated objects, not validation of arbitrary imported scenarios.

The input explicitly maps operational locations to distinct graph access nodes. All resources currently share one movement mode, speed and clearance. Handling times are entered per job. Duration overrides are rejected. Return legs must be explicitly declared per resource; reverse graph edges are never inferred. The example's separate graph explicitly permits both directions for this synthetic scenario.

The scheduler applies skills, contiguous availability and whole-assignment shared-area capacity after route timing. During a return trip, only the worker moves; the next load remains at its source. During loading, travel and unloading, worker and load share the same route position. Idle resources remain at the last destination. At an exact job-end boundary the load is delivered and the resource is available for the next assignment. Sampling stops at the scenario horizon. An unavailable return declaration leaves the next job unscheduled; a declared but geometrically impossible route rejects scenario construction with a diagnostic.

Example: the first job ends at 20.7 seconds. The second assignment cannot fit in the remaining first availability window, so it starts at 60 seconds. Its return trip takes 12.7 seconds, work starts at 72.7, and delivery occurs at 93.4. At 61 seconds the worker is at (13, 7.5) metres, returning toward picking, while the second load is still at (4, 4.8).

These are planned load IDs, not SQL package identities or telemetry. No acceleration, body collision checks, inferred geometric traffic areas, off-duty movement, safety certification or optimal staffing is claimed. Full-assignment area reservations may be conservative. The route geometry and clearance retain the limitations in DIRECTED_ROUTE_SCREENING.md.

Tests cover hand-calculated outbound/return positions, load/worker separation, exact phase boundaries, calendar waiting, shared-area waiting, absent return declarations, stale or unreachable geometry, input nonmutation and deterministic generation.

## Browser playback

Open `resource-view.html` from the planner's scene inspector or the SQL history viewer. Explore the bundled synthetic example or import an export from the current generator (maximum 5 MB). Older exports without the floor, movement assumptions, skill and initial-location snapshots must be regenerated.

Workers and loads share one scrubber and 1x–100x clock. Plan and isometric views project identical coordinates; cards expose IDs, phase and position, and the assignment table gives planned start and end times. Workers use outlined circles, loads smaller filled squares. Coincident entities retain their real shared position, with separate text cards; markers are not displaced for visual separation. Tab hiding pauses playback.

Import checks each path with the existing geometry/timing validator, then verifies location continuity, return endpoints, skill coverage, exclusive resource intervals, contiguous availability and capacity derived from job area claims. It samples checked jobs and routes rather than imported summary metrics or state labels. Invalid imports clear the old scene. It does not authenticate graph permissions, reconstruct optimal dispatch or prove an unassigned job was infeasible. No live SQL package binding is added.

Validation: 58 Node harnesses, 59 Python tests and Ruff pass. Actual browser checks cover the one-click example, the 61-second return position, matching coordinates after projection changes, 100x completion at exactly 120 seconds, successful file import and rejection of a missing return route. Main-app self-tests pass 159/159. Default desktop rendering was inspected; an attempted viewport override did not change the observed width, so narrow-layout visual validation remains unverified.

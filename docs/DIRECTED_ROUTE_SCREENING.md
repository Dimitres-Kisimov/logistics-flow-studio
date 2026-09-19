# Directed route screening

The route planner is a local CLI/library. Its timed export can now be previewed in the transfer viewer as a separate assumed scenario.
It uses explicit access nodes outside machinery, declared one-way edges and permitted
modes (worker, forklift, agv). No path is inferred through an equipment centre.

```sh
python tools/route_plan.py --floor examples/routes/floor.json --digest
python tools/route_plan.py --floor examples/routes/floor.json --graph examples/routes/graph.json --start PICK-ACCESS --destination PACK-ACCESS --mode worker --clearance-m 0.3
```

The example produces 12.7 m. The entered 0.3 m is a synthetic test assumption, not a
recommended or regulatory clearance. The graph must carry the SHA256 digest of
normalized metre floor dimensions, rectangular equipment footprints and reserved areas. A geometry
change requires a new graph review/digest. This is geometry consistency, not site
identity, signed approval or a verified survey.

Every declared edge is tested against inflated equipment and reserved-area rectangles and the floor
boundary. Equipment contact is rejected. The entered clearance expands each
rectangle in both axes: a conservative rectangular buffer, not a vehicle swept
path. Dijkstra selects the shortest remaining directed route by Euclidean segment
length. No edge is added automatically. Rejected edges retain reasons; a blocked
access node or disconnected graph produces no route rather than a fallback line.

Limits: 1,000 nodes, 2,000 edges and 10,000 rectangular footprints. All equipment footprints are
obstacles; overhead conveyors, walk-through equipment and doors need a richer
geometry/access model. Rotation, turning radius, pedestrian/vehicle interaction,
crossing reservations, visibility, slopes, utilities, hazards, travel times and
regulatory approval are unmodelled. This planner does not change inventory, assign
a worker or move a package. Saved placementConstraintDraft areas are enforced in metres; malformed drafts reject planning. Fixed IDs are validated but do not alter routing because every equipment footprint is already an obstacle. Reserved-area rejection numbers refer to canonical coordinate order. Empty drafts preserve existing graph identities.

## Research and scope

[HSE: Separating pedestrians and vehicles](https://www.hse.gov.uk/workplacetransport/separating.htm)
discusses separation, crossing points and protecting people near vehicle routes.
It supports treating travel permissions and interactions as explicit design inputs;
our mode filter alone does not implement that guidance or establish compliance.
HSE is UK guidance, not a substitute for the project's provisional German/EU rules.

The separate [HSE site traffic control page](https://www.hse.gov.uk/workplacetransport/factsheets/traffic.htm)
discusses one-way systems but explicitly excludes traffic control inside warehouses
and process plant buildings. It was reviewed as background only, not used as an
indoor factory rule source. No numeric clearance was derived from either page.
Both primary pages were read 19 September 2026. Licensed standards and independent
engineering review remain outside this implementation.

## Evidence

Tests cover a hand-computed 12 m detour, a blocked direct edge, reverse one-way travel,
mode denial, exact obstacle contact, insufficient clearance, access inside equipment,
non-unit cell conversion, stale geometry, determinism and nonmutation. All 27 Python
tests pass. The 12.7 m example JSON and SVG were generated twice with identical hashes.
SVG browser inspection was blocked by the browser URL policy; rendered visual QA
is unverified. Geometry and output data checks passed.

## Assumed travel timeline

Add --speed-mps 1 --loading-s 5 --unloading-s 3 to the example command to produce factory-route-timeline/v1. All three inputs are required together; no default industrial speed is implied. The synthetic example takes 20.7 seconds: 5 loading, 12.7 travelling, 3 unloading. These are assumed durations, not observations or safe operating limits.

The timeline contains metre endpoints and simulation-second boundaries for each screened segment. sample_timeline returns continuous position, heading in radians from the positive x axis toward positive y, and loading/travelling/unloading/delivered state. Exact boundaries belong to the next stage. Unroutable transfers have no duration or position. The sampler accepts internally generated timelines; it is not an untrusted-file validator. A future browser importer must validate the full contract and current floor before playback.

Playback multipliers should multiply elapsed simulation time, leaving speed_mps unchanged. Acceleration, deceleration, cornering, congestion, shared resources and measured telemetry remain absent. The timed model can be previewed in the browser; SQL execution is not connected. Tests cover hand-computed durations and positions, corners, boundaries, stationary transfers, missing paths and invalid timing. All 30 Python tests pass.

## Browser route preview

Open transfer-ledger.html, load a ledger and planner floor, then import examples/routes/timeline.json under Preview a timed route. Play/pause, reset, time scrubbing and 1x/5x/10x/25x/50x/100x playback are available. Hiding the tab pauses playback; a delayed frame advances at most one real second. The scenario is independent of the selected package and does not modify SQL events. It renders as a 2D plan or isometric footprint projection; no equipment height or volumetric geometry is inferred.

The importer checks a normalized floor snapshot including reserved areas, obstacle intersections and clearance, segment continuity, entered speed and total timing. Older timeline exports lacking a floor snapshot must be regenerated. Import is bounded at 5 MB, 1000 points and 365 days. Invalid imports hide previous playback; replacing the floor or ledger clears the scenario. It does not authenticate a graph digest, verify directed mode permissions against the original graph, or certify safety. A floor snapshot match is geometry consistency, not a surveyed site identity.

Verification: 57 Node harnesses, 30 Python tests, Ruff and 159 browser self-tests pass. Browser file imports showed 10.00 seconds at (7.80, 6.00) m; 100x playback stopped exactly at 20.70 seconds and (13.00, 8.50) m. Corrupt segment timing was rejected with the preview hidden. Narrow viewport inspected; the map remains small and full 3D integration is pending.

## Package-specific scenario export

Use tools/package_route.py with --database PATH --package PACKAGE-1 --floor examples/routes/floor.json --graph examples/routes/graph.json --access examples/routes/location-access.json --mode worker --clearance-m 0.3 --speed-mps 1 --loading-s 5 --unloading-s 3. The CLI opens SQLite in read-only mode, selects one package manifest, and requires explicit mappings from its source/destination location IDs to distinct graph access nodes. It does not infer an access point from an equipment centre.

The timeline carries package_snapshot and location_access. The viewer checks package, pick, order, line, item, quantity, unit, endpoints, version and update time against the selected ledger manifest; stale or unrelated scenarios are rejected. Changing package clears playback. Bound and unbound scenario exports are both supported. This association is a consistency check, not a database identity signature, permission, resource reservation or execution write. Access declarations still require review; simulated delivery never updates the recorded package state.

Evidence: 32 Python tests,57 Node harnesses and159 browser self-tests pass. The database byte hash was unchanged by CLI export; repeated scenario exports match. Browser accepted PACKAGE-1/version7 and rejected version6 with previous playback hidden. All earlier movement assumptions and limits still apply.

## Route camera and projection

Floor view selects a plan or isometric projection of the same metre coordinates. Fit floor includes all floor corners with margin. Follow-load cameras at2x/4x centre on the simulated load and intentionally crop surrounding geometry. A 10-by-10 visual grid divides floor dimensions; it is not a one-metre survey grid. Start/end labels and heading lines share the projection used for obstacles and route segments. Isometric view has no inferred equipment heights, vertical clearances or volumetric collision checking.

Node tests cover known projection coordinates, fit bounds and follow-camera centring in both views. Browser selection at10seconds retained7.80/6.00m, with inspected isometric and follow2x screenshots and no console errors. Full57Node/32Python/Ruff/159browser gates pass.

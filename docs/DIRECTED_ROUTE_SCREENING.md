# Directed route screening

The current route planner is a local CLI/library, not connected to browser playback.
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

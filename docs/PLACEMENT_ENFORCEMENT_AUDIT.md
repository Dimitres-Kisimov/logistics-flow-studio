# Placement enforcement audit

Reviewed 2026-09-19 against commit 2ea5619. This records current behavior, not completed safety enforcement.

## Finding

Reserved rectangles and fixed equipment are optimizer inputs. They are not currently universal editor constraints. A user can manually place or move equipment into a displayed reserved rectangle. An overlap-free layout therefore cannot be described as compliance-safe.

| Entry point | Current evidence in app.js | Constraint gap |
| --- | --- | --- |
| Library drop / click placement | `placeAt` clamps to floor and checks equipment overlap | Does not check reserved rectangles |
| Pointer drag | `pointermove` accepts in-bounds, non-overlapping candidate | Ignores reserved rectangles and fixed IDs |
| Keyboard movement | `nudgeSelected` checks bounds and overlap | Same bypass as pointer drag |
| Duplicate | `findFreeSpotNear` scans free footprints | Can select a reserved area |
| Dimension edit | Property resize checks bounds and overlap | Can expand into a reserved area; fixed geometry is not protected |
| Rotation | `rotateSelected` checks bounds and overlap | Same gap as resize |
| Floor resize | `setFloorSize` changes footprints and removes non-fitting equipment | Needs an explicit policy for fixed equipment and out-of-floor areas |
| Optimizer | `optimizer.optimize` validates fixed IDs, metre-based rectangles and baseline conflicts | Enforced only within that proposal path |

`readConstraintDraft` validates rectangle shape and floor bounds but is not called by these placement handlers. A drawn rectangle is therefore a draft planning annotation, not a protected traffic corridor. Imports and generated layouts also need explicit whole-layout validation rather than assuming manual editing checks cover them.

## Next implementation contract

Use one candidate validator across placement, drag, nudge, duplicate, rotation and resize. Return a reason and the conflicting equipment/area so the editor can explain rejected positions. Convert metre-based rectangles using the layout cell scale; touching edges may be accepted, positive-area intersection must be rejected. Fixed equipment must retain its geometry until explicitly unlocked. Duplicates receive a new identity and must find a permitted footprint.

Validate constraint drafts before applying them, with a visible distinction between draft and applied rules. Do not silently ignore malformed JSON, stale fixed IDs or areas outside a resized floor. Keep edits recoverable: users must be able to resolve an existing conflict without first declaring the layout safe. Pause active playback when editing geometry and invalidate results derived from the old layout.

Acceptance evidence must include actual pointer drop/move, keyboard nudge, duplicate, rotate and dimension edits against the same reserved area and fixed object. Include non-unit cell size, boundary contact, stale IDs, malformed data, existing conflicts, imports and floor resizing. Rejection must preserve geometry and explain why. Test successful recovery as well as rejection.

## Industrial basis and limits

[HSE guidance on separating pedestrians and vehicles](https://www.hse.gov.uk/workplacetransport/separating.htm), reviewed 2026-09-19, describes separating routes where possible, protecting crossings, visibility, barriers and preventing trapping. This is British guidance; it is not evidence of German or EU regulatory compliance.

Engineering implication: preserving empty rectangles is only a first layer. A factory model also needs typed pedestrian/vehicle routes, crossings, entrances, visibility and vehicle/load envelopes. Static footprint checks do not establish safe traffic operation. No automatic clearance threshold or legal certification is inferred from this source.

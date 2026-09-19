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

## Follow-up: manual edit guards

Manual place, pointer movement, nudge, duplicate candidate search, property resize and rotation now share placementProblem. Valid draft rules apply immediately; malformed drafts block these edits. Fixed IDs prevent movement, size and rotation changes. Duplicating fixed equipment creates an independent object in permitted space. Positive-area intersection is rejected; edge contact is allowed. Existing conflicts may be moved completely out. Accepted manual geometry edits pause playback.

This does not finish the audit contract: deletion, imports, generation, floor resizing, stale-ID lifecycle and full invalidation of derived reports still require work. There is no separate Apply-rules transaction yet. UI text describes immediate draft enforcement and excluded paths. The validator does not add aisle-width, swept-path or regulatory certification checks.

Verification: 59 Node harnesses and 162 live-browser self-tests pass. New Node checks execute the actual app handlers for placement, nudge, size, rotation and duplicate candidate selection, including half-metre cells, malformed/out-of-floor rules, edge contact, fixed geometry and recovery. New browser test exercises real placement, nudge and rotation handlers. Native pointer interaction with these new constraints is not yet independently verified; prior unrestricted drag/drop testing is not treated as proof of that behavior.

### Floor Resize control

The explicit floor Resize button now validates the normalized proposed dimensions before changing anything. It rejects equipment footprints or reserved areas outside the new floor, preserves all geometry on rejection, restores the displayed dimensions, and names the obstruction. Successful resizing pauses playback. This applies to the manual button; the internal setFloorSize helper used by creating a new blank factory retains its separate behavior. Imports/generation and deletion remain outside this protection.

Node tests cover fixed equipment at the edge, metre conversion for reserved areas, exact boundary contact, growth and malformed drafts. A browser self-test clicks the actual Resize button and checks the whole layout is unchanged after a rejected shrink.

### Import identity preflight

Layout loading now rejects duplicate and blank explicit string equipment IDs before rebuilding custom library definitions or changing floor geometry. This prevents ambiguous selection/fixed-ID/tracking references. The rejection names the duplicate and leaves the current layout intact. Missing/non-string IDs retain legacy generated-ID behavior; full deterministic ID allocation is not established by this check.

This does not make imports atomic or constraint-safe in general. The loader still normalizes/clamps geometry, drops unknown types and rebuilds custom definitions before later processing. Reserved-area conflicts, process-block failure rollback and generated layouts need further work. Tests cover identity rejection before mutation; they do not establish full import validity.

### Deterministic legacy identity allocation

Legacy records without string IDs now receive import-N IDs in file order rather than random values. Explicit IDs from the entire file are reserved before assignment, including later entries, and remain unchanged. Reimporting identical input yields identical IDs without mutating the input. Reordering legacy records may change generated IDs; these are file-local identities, not global equipment registry identifiers. Unknown records can reserve/consume IDs before the existing loader drops them. Full geometry/constraint validation and atomic rollback remain unfinished.

# Resource assignment with skills and repositioning

The local `tools/resource_dispatch.py` prototype assigns one declared resource per
job. It is a greedy planning model, not an optimal staffing calculation or a live
workforce management connection.

```sh
python tools/resource_dispatch.py --input examples/routes/resource-jobs.json
```

The input specifies resource IDs, skill IDs, initial locations, explicit availability
windows, directed reposition times and jobs with duration, endpoints, release time,
priority and required skills. Units are simulation seconds; the fixture is synthetic.
The output lists assignments, competing feasible candidates and rejection reasons.

Jobs are considered by release time, descending priority and ID. Eligible resources
must have every required skill. Remaining candidates are ranked by earliest finish,
then assignment start and resource ID. Repositioning and the whole job must fit in
one availability window. No work is split across breaks. Repositioning begins no
earlier than job release; anticipatory repositioning is not modelled.

A resource's next task cannot begin before its previous assignment ends. Its planned
location becomes that job's destination. If the next source differs, a resource-specific
directed travel time must exist; no reverse edge or zero-time jump is inferred. A
resource already at the source needs zero reposition time. Qualification and travel
inputs are user declarations, not verified certification or measured movement.

Assignments append to each resource's plan. The algorithm does not backfill earlier
idle gaps after scheduling future work, optimize the entire job set, calculate a
minimum headcount, or model teams. Optional shared-area capacity claims are now checked jointly with resource assignments; their geometry and physical occupancy remain unverified. Route geometry,
fatigue, labour-law rules, utilities and machine capabilities are outside its scope.
Do not execute these plans as safety-approved factory instructions.

The horizon classifies released jobs as queued, repositioning, working, completed or
unscheduled. Not-yet-released jobs are separate. Future planned completions are not
counted as completed at the horizon. No SQL execution record is written, and no worker
marker is currently driven by these assignments in the browser.

Limits: 100 resources, 1000 jobs, 100 availability windows/skills per resource and
10000 directed reposition entries. Timing inputs and windows are bounded to 365 days.
No performance guarantee has been measured at those limits.

## Verified example and tests

One picking resource completes ORDER-A at second 4 at PACK. ORDER-B needs six seconds
plus two seconds to return to PICK; the remaining first window cannot fit both. Its
assignment starts at 20, repositioning ends at 22 and work ends at 28. ORDER-C requires
welding, which the resource lacks, and remains unscheduled with a missing-skill reason.

Tests cover exclusive assignment, repositioning, window fit, missing skills and travel,
choice between two resources, deterministic/nonmutating inputs, malformed calendars,
and horizon state during repositioning. All 47 Python tests and Ruff pass. The actual
CLI output was generated twice identically. This is synthetic verification, not site
calibration. Browser integration and geometry-aware traffic remain next.

## Joint resource and shared-area claims

Optional top-level areas declare IDs and capacities; jobs name required area IDs. Omitted areas mean no spatial capacity constraints were supplied. Every eligible resource candidate searches for a contiguous calendar interval that also respects already committed area claims. A conflict advances the candidate past a blocking release and then rechecks the calendar. Only the selected candidate commits its resource and all area reservations, so evaluating alternatives consumes no capacity.

Claims cover the full assignment, including repositioning. This deliberately coarse policy may overreserve areas and is not segment-level traffic or vehicle-body collision checking. Areas must be declared to cover all intended conflicts; no geometry inference is performed. Append-only greedy dispatch remains nonoptimal. Output areas include reservations with job/resource IDs and start/end times; selected jobs include candidate wait reasons.

The joint-resource-jobs.json fixture gives ORDER-A to WORKER-1 from0–4 and ORDER-B to WORKER-2 from4–10, despite WORKER-2 being otherwise free earlier; the shared crossing explains the wait. Tests verify capacity1vs2, calendar rechecking after area delay, unknown-area rejection and unchanged earlier cases. All50Python tests and Ruff pass; CLI output repeated identically. No browser worker playback or SQL execution is added.

## HTML and CSV review exports

Add --report-dir PATH to write index.html, plan.json, assignments.csv, rejections.csv and area-claims.csv. The report distinguishes queue, repositioning and work with a shared horizon scale, preserves future planned times as text, and explains area waits and rejected candidates. It is a static review artifact, not browser editing or worker tracking. Re-running overwrites those five named report files in the requested directory.

HTML values are escaped and spreadsheet-dangerous CSV text is apostrophe-prefixed; exact identifiers remain in JSON. Tests verify JSON fidelity, HTML escaping, inert formula-like identifiers, expected CSV assignments and repeatable bytes. All51Python tests and Ruff pass. The CLI generated allfivefiles twice identically.

Rendered visual review was blocked by the browser URL policy for the local report HTML. No alternate-access workaround was attempted; visual QA is unverified. Existing app browser results do not validate this new report layout.

## Resource-use metrics

Exports now include resource_metrics and completed_jobs_per_simulated_hour. Per resource, available seconds come from declared windows clipped to the simulation horizon. Assigned time equals clipped work plus repositioning; idle available time is the remainder. Utilization divides assigned by available time, returning null when availability is zero. Queue time before assignment is excluded from busy time. Completed jobs are counted only when their end lies within the horizon.

Job throughput is completed jobs divided by horizon hours. It is not picks/hour, units/hour, labour productivity or proven steady-state capacity; short horizons extrapolate strongly. The renderer adds a resource-use table and resource-use.csv, bringing report output to six named files. Exact JSON IDs and inert CSV handling remain unchanged.

Hand-check:20available seconds with10work and2reposition yields8idle and60percent utilization. Horizon21clips availabilityto11,workto4,repositionto1;onejobcomplete. Zeroavailabilityyieldsnullutilization. All53Python tests and Ruff pass. Report visual QA remains blocked/unverified under the previously reported browser URL policy; no alternate rendering access was attempted.

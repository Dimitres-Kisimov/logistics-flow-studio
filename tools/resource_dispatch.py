"""Greedy resource assignment with explicit skills, calendars and reposition times."""
import argparse
import json
from pathlib import Path

from route_plan import identity, number


def strings(values):
    if not isinstance(values, list) or len(values) > 100:
        raise ValueError("Expected at most 100 skill IDs")
    result = [identity(value) for value in values]
    if len(set(result)) != len(result):
        raise ValueError("Duplicate skill")
    return set(result)


def dispatch(raw):
    if raw.get("schema") != "factory-resource-jobs/v1":
        raise ValueError("Unsupported resource job schema")
    horizon = number(raw["horizon_s"], True)
    if horizon > 31536000:
        raise ValueError("Maximum horizon is 365 days")
    if not isinstance(raw.get("resources"), list) or len(raw["resources"]) > 100:
        raise ValueError("Expected at most 100 resources")
    resources = {}
    for resource in raw["resources"]:
        key = identity(resource["id"])
        if key in resources:
            raise ValueError("Duplicate resource")
        windows, previous = [], -1
        if not isinstance(resource.get("availability_s"), list) or len(resource["availability_s"]) > 100:
            raise ValueError("Resource requires explicit availability windows")
        for pair in resource["availability_s"]:
            if not isinstance(pair, list) or len(pair) != 2:
                raise ValueError("Window must be [start,end]")
            start, end = number(pair[0]), number(pair[1], True)
            if start >= end or start < previous or end > 31536000:
                raise ValueError("Availability must be ordered and nonoverlapping")
            windows.append((start, end))
            previous = end
        resources[key] = dict(skills=strings(resource["skills"]), windows=windows,
                              location=identity(resource["start_location"]), ready=0.0)
    travel = {}
    if not isinstance(raw.get("reposition"), list) or len(raw["reposition"]) > 10000:
        raise ValueError("Expected at most 10000 explicit reposition times")
    for leg in raw["reposition"]:
        key = (identity(leg["resource_id"]), identity(leg["from"]), identity(leg["to"]))
        duration = number(leg["seconds"], True)
        if key[0] not in resources or key[1] == key[2] or key in travel or duration > 31536000:
            raise ValueError("Unknown resource, duplicate or invalid reposition leg")
        travel[key] = duration
    if not isinstance(raw.get("jobs"), list) or len(raw["jobs"]) > 1000:
        raise ValueError("Expected at most 1000 jobs")
    areas = raw.get("areas", [])
    if not isinstance(areas, list) or len(areas) > 100:
        raise ValueError("Expected at most 100 shared areas")
    capacities, reservations = {}, {}
    for area in areas:
        key, capacity = identity(area["id"]), area["capacity"]
        if key in capacities or type(capacity) is not int or not 1 <= capacity <= 100:
            raise ValueError("Duplicate area or invalid capacity")
        capacities[key], reservations[key] = capacity, []
    jobs, ids = [], set()
    for job in raw["jobs"]:
        key = identity(job["id"])
        release, duration = number(job["release_s"]), number(job["duration_s"], True)
        priority = job.get("priority", 0)
        if key in ids or max(release, duration) > 31536000 or type(priority) is not int or not -1000 <= priority <= 1000:
            raise ValueError("Invalid or duplicate job")
        ids.add(key)
        claims = job.get("areas", [])
        if not isinstance(claims, list) or any(not isinstance(a, str) or a not in capacities for a in claims) or len(set(claims)) != len(claims):
            raise ValueError("Job areas must be unique declared IDs")
        jobs.append(dict(id=key, release_s=release, duration_s=duration, priority=priority, areas=sorted(claims),
                         source=identity(job["source"]), destination=identity(job["destination"]),
                         required_skills=sorted(strings(job["required_skills"]))))
    jobs.sort(key=lambda job: (job["release_s"], -job["priority"], job["id"]))
    output = []
    for job in jobs:
        candidates, rejected = [], []
        for key, resource in sorted(resources.items()):
            missing = sorted(set(job["required_skills"]) - resource["skills"])
            if missing:
                rejected.append(dict(resource_id=key, reason="missing-skills", skills=missing))
                continue
            reposition = 0.0 if resource["location"] == job["source"] else travel.get((key, resource["location"], job["source"]))
            if reposition is None:
                rejected.append(dict(resource_id=key, reason="missing-reposition-time", source=resource["location"], destination=job["source"]))
                continue
            earliest = max(job["release_s"], resource["ready"])
            total = reposition + job["duration_s"]
            waits = []
            while True:
                start = next((max(earliest, a) for a, b in resource["windows"] if max(earliest, a) + total <= b), None)
                if start is None:
                    break
                conflicts = []
                for area in job["areas"]:
                    overlap = [r for r in reservations[area] if r["start_s"] < start + total and r["end_s"] > start]
                    boundaries = sorted({start, *[r["start_s"] for r in overlap if r["start_s"] >= start]})
                    for at in boundaries:
                        active = [r for r in overlap if r["start_s"] <= at < r["end_s"]]
                        if len(active) >= capacities[area]:
                            conflicts.append(dict(area=area, at_s=at, release_s=min(r["end_s"] for r in active),
                                                  holders=sorted(r["job_id"] for r in active)))
                            break
                if not conflicts:
                    break
                earliest = max(c["release_s"] for c in conflicts)
                if earliest <= start:
                    raise RuntimeError("Shared-area candidate did not advance")
                waits.append(dict(candidate_start_s=start, next_start_s=earliest, conflicts=conflicts))
            if start is None:
                rejected.append(dict(resource_id=key, reason="no-contiguous-availability", area_waits=waits))
                continue
            task_start, end = start + reposition, start + total
            if end <= task_start or (reposition > 0 and task_start <= start):
                raise ValueError("Task duration below supported numeric precision")
            candidates.append((end, start, key, task_start, reposition, waits))
        if not candidates:
            output.append(dict(**job, resource_id=None, state_at_horizon="unscheduled" if job["release_s"] <= horizon else "not-released", rejected_resources=rejected))
            continue
        end, start, selected, task_start, reposition, waits = min(candidates)
        origin = resources[selected]["location"]
        resources[selected].update(location=job["destination"], ready=end)
        for area in job["areas"]:
            reservations[area].append(dict(job_id=job["id"], resource_id=selected, start_s=start, end_s=end))
        state = ("not-released" if job["release_s"] > horizon else "queued" if start > horizon else
                 "repositioning" if task_start > horizon else "working" if end > horizon else "completed")
        output.append(dict(**job, resource_id=selected, reposition_from=origin, reposition_s=reposition,
                           assignment_start_s=start, task_start_s=task_start, end_s=end,
                           queue_wait_s=start - job["release_s"], state_at_horizon=state, area_waits=waits,
                           rejected_resources=rejected,
                           feasible_candidates=[dict(resource_id=c[2], end_s=c[0]) for c in sorted(candidates)]))
    return dict(schema="factory-resource-plan/v1", provenance="assumed-resource-dispatch",
                horizon_s=horizon, jobs=output,
                areas=[dict(id=key, capacity=capacities[key], reservations=reservations[key]) for key in sorted(capacities)],
                completed=sum(job["state_at_horizon"] == "completed" for job in output),
                unfinished=sum(job["state_at_horizon"] not in {"completed", "not-released"} for job in output),
                policy="Release/priority/ID job order; earliest finish then start/resource ID. Append-only resource assignments.",
                limitations="Greedy, not optimal staffing. One resource per job; durations and directed reposition times are declared. Requested areas are held atomically for the full assignment including repositioning. No geometry-to-area mapping, vehicle body clearance, fatigue, labour-law validation or SQL execution. Resource states are planned, not telemetry.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--report-dir", type=Path, help="Write an HTML review and CSV tables alongside JSON")
    args = parser.parse_args()
    result = dispatch(json.loads(args.input.read_text(encoding="utf-8-sig")))
    if args.report_dir:
        from resource_report import write_report
        write_report(result, args.report_dir)
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

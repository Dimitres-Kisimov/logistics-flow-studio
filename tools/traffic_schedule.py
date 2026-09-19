"""Deterministic shared-area reservations; simulated point occupancy, not safety control."""
import argparse
import json
from pathlib import Path

from route_plan import identity, number


def schedule(raw):
    if raw.get("schema") != "factory-area-requests/v1":
        raise ValueError("Unsupported area request schema")
    horizon = number(raw["horizon_s"], True)
    if horizon > 31536000:
        raise ValueError("Maximum horizon is 365 days")
    if not isinstance(raw.get("areas"), list) or len(raw["areas"]) > 100:
        raise ValueError("Expected at most 100 areas")
    capacities = {}
    for area in raw["areas"]:
        key = identity(area["id"])
        capacity = area["capacity"]
        if key in capacities or type(capacity) is not int or not 1 <= capacity <= 100:
            raise ValueError("Duplicate area or invalid integer capacity")
        capacities[key] = capacity
    if not isinstance(raw.get("requests"), list) or len(raw["requests"]) > 1000:
        raise ValueError("Expected at most 1000 requests")
    requests, ids = [], set()
    for request in raw["requests"]:
        key = identity(request["id"])
        release, duration = number(request["release_s"]), number(request["duration_s"], True)
        priority, areas = request.get("priority", 0), request["areas"]
        if key in ids or type(priority) is not int or not -1000 <= priority <= 1000:
            raise ValueError("Duplicate request or invalid priority")
        if not isinstance(areas, list) or not areas or any(not isinstance(a, str) or a not in capacities for a in areas) or len(set(areas)) != len(areas):
            raise ValueError("Requests require unique known areas")
        if release > 31536000 or duration > 31536000 or release + duration == release:
            raise ValueError("Unsupported request timing")
        ids.add(key)
        requests.append(dict(id=key, release_s=release, duration_s=duration, priority=priority, areas=sorted(areas)))
    # Earlier release first. Larger priority breaks ties; ID makes remaining ties reproducible.
    requests.sort(key=lambda r: (r["release_s"], -r["priority"], r["id"]))
    reservations = {key: [] for key in capacities}
    results, events = [], []

    def conflict(area, start, end):
        overlaps = [r for r in reservations[area] if r["start_s"] < end and r["end_s"] > start]
        boundaries = sorted({start, *[r["start_s"] for r in overlaps if r["start_s"] >= start]})
        for at in boundaries:
            active = [r for r in overlaps if r["start_s"] <= at < r["end_s"]]
            if len(active) >= capacities[area]:
                return dict(area=area, at_s=at, release_s=min(r["end_s"] for r in active),
                            holders=sorted(r["id"] for r in active))
        return None

    for request in requests:
        start, explanations = request["release_s"], []
        # Each failed candidate advances past at least one finite existing reservation.
        while True:
            if start + request["duration_s"] == start:
                raise ValueError("Scheduled duration is below numeric precision")
            conflicts = [c for area in request["areas"]
                         if (c := conflict(area, start, start + request["duration_s"]))]
            if not conflicts:
                break
            next_start = max(c["release_s"] for c in conflicts)
            if next_start <= start:
                raise RuntimeError("Reservation search did not advance")
            explanations.append(dict(candidate_start_s=start, next_start_s=next_start, conflicts=conflicts))
            start = next_start
        end = start + request["duration_s"]
        for area in request["areas"]:
            reservations[area].append(dict(id=request["id"], start_s=start, end_s=end))
        state = ("not-released" if request["release_s"] > horizon else
                 "queued" if start > horizon else "completed" if end <= horizon else "occupying")
        result = dict(**request, planned_start_s=start, planned_end_s=end,
                      planned_wait_s=start - request["release_s"], state_at_horizon=state,
                      observed_wait_s=max(0.0, min(start, horizon) - request["release_s"]), explanations=explanations)
        results.append(result)
        for at, kind in [(request["release_s"], "requested"), (start, "granted"), (end, "released")]:
            if at <= horizon:
                events.append(dict(at_s=at, kind=kind, request_id=request["id"], areas=request["areas"]))
    order = {"released": 0, "requested": 1, "granted": 2}
    events.sort(key=lambda e: (e["at_s"], order[e["kind"]], e["request_id"]))
    completed = sum(r["state_at_horizon"] == "completed" for r in results)
    return dict(schema="factory-area-schedule/v1", provenance="synthetic-reservation-model",
                horizon_s=horizon, policy="release-ascending/priority-descending/id-ascending; atomic nonpreemptive area claims",
                requests=results, events=events, completed=completed,
                unfinished=sum(r["state_at_horizon"] in {"queued", "occupying"} for r in results),
                limitations="Declared area durations only. All requested areas held for the full duration; waits occur before entry. No geometry, body clearance, resources, shifts, repositioning, stochastic timing or actual execution. Future starts are plans, not horizon completions.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(schedule(json.loads(args.input.read_text(encoding="utf-8-sig"))), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

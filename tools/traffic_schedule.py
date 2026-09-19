"""Deterministic shared-area reservations; simulated point occupancy, not safety control."""
import argparse
import copy
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
        windows = request.get("availability_s")
        if "availability_s" in request:
            if not isinstance(windows, list) or len(windows) > 100:
                raise ValueError("Availability requires at most 100 explicit windows")
            checked, prior = [], -1
            for window in windows:
                if not isinstance(window, list) or len(window) != 2:
                    raise ValueError("Availability windows require [start,end]")
                a, b = number(window[0]), number(window[1], True)
                if a >= b or a < prior or b > 31536000:
                    raise ValueError("Availability windows must be sorted, nonoverlapping and within 365 days")
                checked.append([a, b])
                prior = b
            windows = checked
        ids.add(key)
        requests.append(dict(id=key, release_s=release, duration_s=duration, priority=priority, areas=sorted(areas),
                             **({"availability_s": windows} if windows is not None else {})))
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
            if "availability_s" in request:
                feasible = next((max(start, a) for a, b in request["availability_s"]
                                 if max(start, a) + request["duration_s"] <= b), None)
                if feasible is None:
                    start = None
                    break
                if feasible != start:
                    explanations.append(dict(candidate_start_s=start, next_start_s=feasible, reason="availability-window"))
                    start = feasible
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
        if start is None:
            results.append(dict(**request, planned_start_s=None, planned_end_s=None, planned_wait_s=None,
                                state_at_horizon="unscheduled" if request["release_s"] <= horizon else "not-released",
                                observed_wait_s=max(0.0, horizon - request["release_s"]),
                                reason="No declared availability window can fit the transfer after existing reservations",
                                explanations=explanations))
            if request["release_s"] <= horizon:
                events.append(dict(at_s=request["release_s"], kind="requested", request_id=request["id"], areas=request["areas"]))
            continue
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
                areas=[dict(id=key, capacity=value) for key, value in sorted(capacities.items())],
                requests=results, events=events, completed=completed,
                unfinished=sum(r["state_at_horizon"] in {"queued", "occupying", "unscheduled"} for r in results),
                limitations="Declared area durations only. All requested areas held for the full duration; waits occur before entry. Optional request availability is not a workforce calendar; omitted availability assumes unrestricted time. No geometry, body clearance, resources, repositioning, stochastic timing or actual execution. Future starts are plans, not horizon completions.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--timeline", type=Path, help="Attach this schedule to a route timeline")
    parser.add_argument("--request", help="Reservation request ID associated with that route")
    args = parser.parse_args()
    if (args.timeline is None) != (args.request is None):
        parser.error("Supply both --timeline and --request")
    result = schedule(json.loads(args.input.read_text(encoding="utf-8-sig")))
    if args.timeline is not None:
        result = bind_timeline(json.loads(args.timeline.read_text(encoding="utf-8-sig")), result, args.request)
    print(json.dumps(result, indent=2, allow_nan=False))


def bind_timeline(timeline, result, request_id):
    request = next((r for r in result["requests"] if r["id"] == request_id), None)
    if timeline.get("schema") != "factory-route-timeline/v1" or not timeline.get("route", {}).get("found") or "reservation" in timeline:
        raise ValueError("Use an unreserved, routable timeline")
    if request is None or request["planned_start_s"] is None or timeline.get("duration_s") != request["duration_s"]:
        raise ValueError("Reservation duration must equal the full route timeline duration")
    if any("availability_s" in r for r in result["requests"]):
        raise ValueError("Availability-aware schedules require a future playback contract; export the schedule for review instead")
    output = copy.deepcopy(timeline)
    output["reservation"] = dict(request_id=request_id, schedule=copy.deepcopy(result))
    return output


if __name__ == "__main__":
    main()

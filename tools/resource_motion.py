"""Build resource schedules and continuous positions from the same screened routes."""
import argparse
import copy
import json
from pathlib import Path

import resource_dispatch
import route_plan


def build(raw, floor, graph):
    """Homogeneous movement assumptions; explicit access nodes and return legs."""
    if raw.get("schema") != "factory-resource-motion-input/v1":
        raise ValueError("Unsupported resource motion input")
    request = copy.deepcopy(raw)
    request["schema"] = "factory-resource-jobs/v1"
    for key, limit in (("resources", 100), ("jobs", 1000), ("reposition", 10000)):
        if not isinstance(request.get(key), list) or len(request[key]) > limit:
            raise ValueError(f"Expected at most {limit} {key}")
    access = raw["location_access"]
    if not isinstance(access, dict) or len(access) > 1000:
        raise ValueError("Expected at most 1000 location access nodes")
    for location, node in access.items():
        route_plan.identity(location)
        route_plan.identity(node)
    if len(set(access.values())) != len(access):
        raise ValueError("Distinct locations require distinct access nodes")

    def route(source, destination, loading=0, unloading=0):
        if source not in access or destination not in access:
            raise ValueError("Missing explicit location access node")
        timeline = route_plan.timed_plan(floor, graph, access[source], access[destination],
                                         raw["mode"], raw["clearance_m"], raw["speed_mps"], loading, unloading)
        if not timeline["route"]["found"]:
            raise ValueError(f"No screened directed route: {source} to {destination}")
        return timeline

    # Validate initial anchors even for resources that receive no jobs.
    anchors = {}
    for resource in request["resources"]:
        anchor = route(resource["start_location"], resource["start_location"])["route"]["points"][0]
        anchors[resource["id"]] = dict(x=anchor["x"], y=anchor["y"])
    jobs, returns = {}, {}
    for job in request["jobs"]:
        if "duration_s" in job:
            raise ValueError("Job duration is derived from geometry and handling times")
        timeline = route(job["source"], job["destination"], job.pop("loading_s"), job.pop("unloading_s"))
        jobs[job["id"]] = timeline
        job["duration_s"] = timeline["duration_s"]
    for leg in request["reposition"]:
        if "seconds" in leg:
            raise ValueError("Reposition duration is derived from geometry")
        timeline = route(leg["from"], leg["to"])
        returns[(leg["resource_id"], leg["from"], leg["to"])] = timeline
        leg["seconds"] = timeline["duration_s"]
    plan = resource_dispatch.dispatch(request)
    assignments = []
    for job in plan["jobs"]:
        reposition = None
        if job["resource_id"] is not None and job["reposition_s"] > 0:
            reposition = returns[(job["resource_id"], job["reposition_from"], job["source"])]
        assignments.append(dict(job_id=job["id"], work_route=jobs[job["id"]], reposition_route=reposition))
    return dict(schema="factory-resource-motion/v1", plan=plan, assignments=assignments,
                resources=[dict(id=r["id"], initial_position=anchors[r["id"]], availability_s=r["availability_s"])
                           for r in request["resources"]],
                limitations="Planned motion, not telemetry or SQL execution. Shared homogeneous speed and clearance; instantaneous turns. Area claims cover whole assignments and are not inferred from geometry. No body collisions, regulatory certification or optimal staffing.")


def sample(bundle, elapsed_s):
    """Sample internally built scenarios. No interpolation across missing return routes."""
    elapsed = route_plan.number(elapsed_s)
    elapsed = min(elapsed, bundle["plan"]["horizon_s"])
    paths = {a["job_id"]: a for a in bundle["assignments"]}
    workers, loads = [], []
    for job in bundle["plan"]["jobs"]:
        timeline = paths[job["id"]]["work_route"]
        if elapsed < job["release_s"]:
            phase = "not-released"
        elif job["resource_id"] is None:
            phase = "unscheduled"
        elif elapsed < job["task_start_s"]:
            phase = "waiting"
        else:
            phase = None
        pose = route_plan.sample_timeline(timeline, 0 if phase else elapsed - job["task_start_s"])
        loads.append(dict(job_id=job["id"], resource_id=job["resource_id"],
                          state=phase or pose["state"], position=pose["position"], heading_rad=pose["heading_rad"]))
    for resource in bundle["resources"]:
        pose = dict(position=resource["initial_position"].copy(), heading_rad=None)
        active, state = None, "idle" if any(a <= elapsed < b for a, b in resource["availability_s"]) else "off-shift"
        for job in bundle["plan"]["jobs"]:
            if job["resource_id"] != resource["id"] or elapsed < job["assignment_start_s"]:
                continue
            paths_for_job = paths[job["id"]]
            if elapsed >= job["end_s"]:
                pose = route_plan.sample_timeline(paths_for_job["work_route"], job["duration_s"])
                continue
            active = job["id"]
            if elapsed < job["task_start_s"]:
                pose = route_plan.sample_timeline(paths_for_job["reposition_route"], elapsed - job["assignment_start_s"])
                state = "repositioning"
            else:
                pose = route_plan.sample_timeline(paths_for_job["work_route"], elapsed - job["task_start_s"])
                state = pose["state"]
            break
        workers.append(dict(resource_id=resource["id"], job_id=active, state=state,
                            position=pose["position"], heading_rad=pose["heading_rad"]))
    return dict(elapsed_s=elapsed, resources=workers, loads=loads)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("input", "floor", "graph"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--at-s", type=float, help="Sample the generated scenario at simulation seconds")
    args = parser.parse_args()
    def read(path):
        return json.loads(path.read_text(encoding="utf-8-sig"))
    result = build(read(args.input), read(args.floor), read(args.graph))
    if args.at_s is not None:
        result = sample(result, args.at_s)
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

"""Plan a directed route on declared geometry, not a safety approval or telemetry."""
import argparse
import hashlib
import heapq
import json
import math
from pathlib import Path


def number(value, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or (positive and value == 0):
        raise ValueError("Expected a finite nonnegative number" if not positive else "Expected a finite positive number")
    return float(value)


def identity(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ValueError("IDs must contain 1-200 characters")
    return value


def floor_model(raw):
    if raw.get("version") != "wt-1":
        raise ValueError("Expected a wt-1 planner layout")
    cell = number(raw["cell"], True)
    width, depth = number(raw["gridW"], True) * cell, number(raw["gridH"], True) * cell
    if not math.isfinite(width + depth) or max(width, depth) > 1_000_000:
        raise ValueError("Unsupported floor extent")
    if not isinstance(raw.get("elements"), list) or len(raw["elements"]) > 10000:
        raise ValueError("Expected at most 10000 equipment footprints")
    elements, ids = [], set()
    for item in raw["elements"]:
        key = identity(item["id"])
        if key in ids:
            raise ValueError("Duplicate equipment ID")
        ids.add(key)
        x, y = number(item["x"]) * cell, number(item["y"]) * cell
        w, d = number(item["w"], True) * cell, number(item["d"], True) * cell
        if not all(math.isfinite(v) for v in (x, y, w, d)) or x + w > width or y + d > depth:
            raise ValueError("Equipment footprint outside floor")
        elements.append(dict(id=key, x=x, y=y, w=w, d=d))
    floor = dict(width=width, depth=depth, elements=sorted(elements, key=lambda e: e["id"]))
    if "placementConstraintDraft" in raw:
        draft = raw["placementConstraintDraft"]
        if not isinstance(draft, str) or len(draft) > 32768:
            raise ValueError("Placement draft must be JSON text of at most 32768 characters")
        draft = json.loads(draft)
        if not isinstance(draft, dict) or set(draft) - {"zones", "fixedIds"}:
            raise ValueError("Unsupported placement draft fields")
        fixed = draft.get("fixedIds", [])
        if not isinstance(fixed, list) or any(not isinstance(key, str) or key not in ids for key in fixed):
            raise ValueError("Fixed equipment IDs must exist on this floor")
        zones = draft.get("zones", [])
        if not isinstance(zones, list) or len(zones) > 100:
            raise ValueError("Expected at most 100 reserved areas")
        normalized = []
        for zone in zones:
            if not isinstance(zone, dict) or set(zone) != {"x", "y", "w", "d"}:
                raise ValueError("Reserved areas require exactly x, y, w, d")
            rect = {key: number(zone[key], key in {"w", "d"}) for key in ("x", "y", "w", "d")}
            if rect["x"] + rect["w"] > width or rect["y"] + rect["d"] > depth:
                raise ValueError("Reserved area outside floor")
            normalized.append(rect)
        # Draft areas are already in metres, independent of the equipment cell size.
        # Omit an empty list to preserve existing unconstrained graph identities.
        if normalized:
            floor["reserved_zones"] = sorted(normalized, key=lambda z: (z["x"], z["y"], z["w"], z["d"]))
    return floor


def floor_digest(floor):
    return hashlib.sha256(json.dumps(floor, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def intersects(a, b, rect, clearance):
    """Closed segment vs inflated axis-aligned rectangle; touching is rejected."""
    lo, hi = 0.0, 1.0
    for axis, span in (("x", "w"), ("y", "d")):
        low, high = rect[axis] - clearance, rect[axis] + rect[span] + clearance
        delta = b[axis] - a[axis]
        if delta == 0:
            if a[axis] < low or a[axis] > high:
                return False
        else:
            first, last = sorted(((low - a[axis]) / delta, (high - a[axis]) / delta))
            lo, hi = max(lo, first), min(hi, last)
            if lo > hi:
                return False
    return True


def plan(raw_floor, graph, start, destination, mode, clearance_m):
    floor = floor_model(raw_floor)
    clearance = number(clearance_m)
    if mode not in {"worker", "forklift", "agv"}:
        raise ValueError("Unsupported travel mode")
    if graph.get("schema") != "factory-route-graph/v1" or graph.get("floor_digest") != floor_digest(floor):
        raise ValueError("Route graph does not match this floor geometry")
    if not isinstance(graph.get("nodes"), list) or len(graph["nodes"]) > 1000 or not isinstance(graph.get("edges"), list) or len(graph["edges"]) > 2000:
        raise ValueError("Graph limit: 1000 nodes / 2000 directed edges")
    nodes = {}
    for raw in graph["nodes"]:
        key = identity(raw["id"])
        if key in nodes:
            raise ValueError("Duplicate route node")
        nodes[key] = dict(id=key, x=number(raw["x"]), y=number(raw["y"]))
    if start not in nodes or destination not in nodes:
        raise ValueError("Declare source and destination access nodes explicitly")

    def blocked(a, b):
        if any(p[axis] < clearance or p[axis] > floor[limit] - clearance
               for p in (a, b) for axis, limit in (("x", "width"), ("y", "depth"))):
            return "floor-boundary"
        for element in floor["elements"]:
            if intersects(a, b, element, clearance):
                return "equipment:" + element["id"]
        for index, zone in enumerate(floor.get("reserved_zones", [])):
            if intersects(a, b, zone, clearance):
                return "reserved-area:" + str(index + 1)
        return None

    adjacency = {key: [] for key in nodes}
    rejected, pairs = [], set()
    for edge in graph["edges"]:
        source, target = edge["from"], edge["to"]
        modes = edge.get("modes")
        if source not in nodes or target not in nodes or source == target or (source, target) in pairs:
            raise ValueError("Unknown, duplicate or self-loop edge")
        if not isinstance(modes, list) or not modes or any(m not in {"worker", "forklift", "agv"} for m in modes):
            raise ValueError("Edges require explicit permitted travel modes")
        pairs.add((source, target))
        reason = "mode-not-permitted" if mode not in modes else blocked(nodes[source], nodes[target])
        if reason:
            rejected.append(dict(source=source, destination=target, reason=reason))
        else:
            distance = math.hypot(nodes[source]["x"] - nodes[target]["x"], nodes[source]["y"] - nodes[target]["y"])
            adjacency[source].append((target, distance))
    endpoint_reason = blocked(nodes[start], nodes[start]) or blocked(nodes[destination], nodes[destination])
    distances, previous, queue = {start: 0.0}, {}, [(0.0, start)]
    while queue and not endpoint_reason:
        distance, node = heapq.heappop(queue)
        if distance != distances[node]:
            continue
        if node == destination:
            break
        for target, length in sorted(adjacency[node]):
            candidate = distance + length
            if candidate < distances.get(target, math.inf):
                distances[target], previous[target] = candidate, node
                heapq.heappush(queue, (candidate, target))
    path = []
    if not endpoint_reason and destination in distances:
        node = destination
        while True:
            path.append(nodes[node].copy())
            if node == start:
                break
            node = previous[node]
        path.reverse()
    return dict(schema="factory-route-proposal/v1", found=bool(path), points=path,
                distance_m=distances[destination] if path else None, mode=mode, clearance_m=clearance,
                floor_digest=floor_digest(floor), rejected_edges=rejected,
                reason="candidate-on-declared-graph" if path else endpoint_reason or "no-directed-route",
                limitations="Static rectangular footprint screening only. No turning envelope, traffic conflicts, slopes, doors, utilities, visibility, timing or regulatory approval. Clearance is user supplied, not a prescribed safe value.")


def timed_plan(raw_floor, graph, start, destination, mode, clearance_m,
               speed_mps, loading_s, unloading_s):
    """Generate an assumed constant-speed schedule directly from screened geometry."""
    speed = number(speed_mps, True)
    loading, unloading = number(loading_s), number(unloading_s)
    proposal = plan(raw_floor, graph, start, destination, mode, clearance_m)
    segments, cursor = [], loading
    if proposal["found"]:
        for a, b in zip(proposal["points"], proposal["points"][1:]):
            duration = math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / speed
            end = cursor + duration
            if not math.isfinite(end) or (duration > 0 and end == cursor):
                raise ValueError("Travel timing exceeds supported numeric precision")
            segments.append(dict(source=a.copy(), destination=b.copy(), start_s=cursor, end_s=end))
            cursor = end
        if not math.isfinite(cursor + unloading):
            raise ValueError("Total duration is not finite")
    return dict(schema="factory-route-timeline/v1", provenance="assumed-simulation-not-telemetry",
                floor=floor_model(raw_floor), route=proposal, speed_mps=speed, loading_s=loading, unloading_s=unloading,
                segments=segments, travel_end_s=cursor if proposal["found"] else None,
                duration_s=cursor + unloading if proposal["found"] else None,
                limitations="Constant speed and instantaneous turns; no acceleration, queues, breaks, collisions or resource availability. Timing is entered assumptions, not measured execution.")


def sample_timeline(timeline, elapsed_s):
    """Sample an internally generated timeline; elapsed time is simulation seconds."""
    elapsed = number(elapsed_s)
    route = timeline["route"]
    if not route["found"]:
        return dict(state="unroutable", position=None, heading_rad=None, elapsed_s=elapsed)
    first, last = route["points"][0], route["points"][-1]
    state, position, heading = "loading", dict(x=first["x"], y=first["y"]), None
    if elapsed >= timeline["duration_s"]:
        state, position = "delivered", dict(x=last["x"], y=last["y"])
    elif elapsed >= timeline["travel_end_s"]:
        state, position = "unloading", dict(x=last["x"], y=last["y"])
    elif elapsed >= timeline["loading_s"]:
        for segment in timeline["segments"]:
            if segment["start_s"] <= elapsed < segment["end_s"]:
                a, b = segment["source"], segment["destination"]
                fraction = (elapsed - segment["start_s"]) / (segment["end_s"] - segment["start_s"])
                position = {axis: a[axis] + (b[axis] - a[axis]) * fraction for axis in ("x", "y")}
                state, heading = "travelling", math.atan2(b["y"] - a["y"], b["x"] - a["x"])
                break
    return dict(state=state, position=position, heading_rad=heading, elapsed_s=elapsed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--floor", type=Path, required=True)
    parser.add_argument("--graph", type=Path)
    parser.add_argument("--digest", action="store_true")
    parser.add_argument("--start")
    parser.add_argument("--destination")
    parser.add_argument("--mode", choices=["worker", "forklift", "agv"])
    parser.add_argument("--clearance-m", type=float)
    parser.add_argument("--speed-mps", type=float, help="Enable assumed timed route; also requires both handling times")
    parser.add_argument("--loading-s", type=float)
    parser.add_argument("--unloading-s", type=float)
    args = parser.parse_args()
    raw = json.loads(args.floor.read_text(encoding="utf-8-sig"))
    if args.digest:
        print(floor_digest(floor_model(raw)))
        return
    if args.graph is None or args.start is None or args.destination is None or args.mode is None or args.clearance_m is None:
        parser.error("Graph, start, destination, mode and explicit clearance are required")
    graph = json.loads(args.graph.read_text(encoding="utf-8-sig"))
    timing = (args.speed_mps, args.loading_s, args.unloading_s)
    if any(value is not None for value in timing):
        if any(value is None for value in timing):
            parser.error("Timed routes require explicit speed, loading and unloading times")
        result = timed_plan(raw, graph, args.start, args.destination, args.mode, args.clearance_m, *timing)
    else:
        result = plan(raw, graph, args.start, args.destination, args.mode, args.clearance_m)
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

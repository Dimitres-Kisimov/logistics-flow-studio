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
    return dict(width=width, depth=depth, elements=sorted(elements, key=lambda e: e["id"]))


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--floor", type=Path, required=True)
    parser.add_argument("--graph", type=Path)
    parser.add_argument("--digest", action="store_true")
    parser.add_argument("--start")
    parser.add_argument("--destination")
    parser.add_argument("--mode", choices=["worker", "forklift", "agv"])
    parser.add_argument("--clearance-m", type=float)
    args = parser.parse_args()
    raw = json.loads(args.floor.read_text(encoding="utf-8-sig"))
    if args.digest:
        print(floor_digest(floor_model(raw)))
        return
    if args.graph is None or args.start is None or args.destination is None or args.mode is None or args.clearance_m is None:
        parser.error("Graph, start, destination, mode and explicit clearance are required")
    graph = json.loads(args.graph.read_text(encoding="utf-8-sig"))
    print(json.dumps(plan(raw, graph, args.start, args.destination, args.mode, args.clearance_m), indent=2))


if __name__ == "__main__":
    main()

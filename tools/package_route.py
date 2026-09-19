"""Export an assumed route scenario for a SQL package without changing execution."""
import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import route_plan

FIELDS = ("id", "pick_id", "source_id", "destination_id", "order_id", "line_id",
          "item_id", "quantity", "unit", "version", "updated_at")


def scenario(db, package_id, floor, graph, access, mode, clearance, speed, loading, unloading):
    """Read one manifest snapshot and explicitly resolve its location access nodes."""
    row = db.execute("SELECT * FROM package_manifest WHERE id=?", (package_id,)).fetchone()
    if row is None:
        raise ValueError("Unknown package")
    package = {key: row[key] for key in FIELDS}
    if not isinstance(access, dict) or set(access) != {package["source_id"], package["destination_id"]}:
        raise ValueError("Map exactly the package source and destination locations to access nodes")
    for node in access.values():
        route_plan.identity(node)
    if access[package["source_id"]] == access[package["destination_id"]]:
        raise ValueError("Distinct package locations require distinct access nodes")
    result = route_plan.timed_plan(floor, graph, access[package["source_id"]],
                                   access[package["destination_id"]], mode, clearance, speed, loading, unloading)
    result["package_snapshot"] = package
    result["location_access"] = dict(sorted(access.items()))
    result["association_note"] = "User-declared location access nodes; not measured motion. Package version is a snapshot, not a reservation or execution command."
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--floor", type=Path, required=True)
    parser.add_argument("--graph", type=Path, required=True)
    parser.add_argument("--access", type=Path, required=True, help="JSON object mapping ledger location IDs to graph node IDs")
    parser.add_argument("--mode", choices=["worker", "forklift", "agv"], required=True)
    parser.add_argument("--clearance-m", type=float, required=True)
    parser.add_argument("--speed-mps", type=float, required=True)
    parser.add_argument("--loading-s", type=float, required=True)
    parser.add_argument("--unloading-s", type=float, required=True)
    args = parser.parse_args()
    def read(path):
        return json.loads(path.read_text(encoding="utf-8-sig"))
    # URI read-only prevents accidental database creation and any writes.
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        result = scenario(db, args.package, read(args.floor), read(args.graph), read(args.access),
                          args.mode, args.clearance_m, args.speed_mps, args.loading_s, args.unloading_s)
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

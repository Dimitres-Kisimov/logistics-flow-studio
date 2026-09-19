"""Plan resource motion for SQL package snapshots without changing execution."""
import argparse
import copy
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import package_route
import resource_motion
import transport_store


def build(db, raw, floor, graph):
    if raw.get("schema") != "factory-package-resource-input/v1":
        raise ValueError("Unsupported package resource input")
    request = copy.deepcopy(raw)
    request["schema"] = "factory-resource-motion-input/v1"
    jobs = request.get("jobs")
    if not isinstance(jobs, list) or not 1 <= len(jobs) <= 1000:
        raise ValueError("Expected 1 to 1000 package jobs")
    # This existing exporter reads all manifests/events in one read transaction.
    # Filter after the snapshot so unrelated package records do not enter the artifact.
    ledger = transport_store.export_ledger(db)
    packages = {p["id"]: p for p in ledger["packages"]}
    used, bindings = set(), []
    for job in jobs:
        if "source" in job or "destination" in job:
            raise ValueError("Package endpoints come from SQL, not job overrides")
        package_id = job.pop("package_id")
        version = job.pop("expected_version")
        if package_id not in packages or package_id in used:
            raise ValueError("Unknown or duplicate package")
        package = packages[package_id]
        if type(version) is not int or version != package["version"]:
            raise ValueError("Package version changed; review the current manifest")
        used.add(package_id)
        job.update(source=package["source_id"], destination=package["destination_id"])
        bindings.append(dict(job_id=job["id"], package_snapshot={k: package[k] for k in package_route.FIELDS}))
    ledger["packages"] = [p for p in ledger["packages"] if p["id"] in used]
    ledger["events"] = [e for e in ledger["events"] if e["package_id"] in used]
    result = resource_motion.build(request, floor, graph)
    result.update(source_ledger=ledger, package_bindings=bindings,
                  association_note="What-if movement for package snapshots. Recorded state and planned time are separate. No reservation, execution event, stock change or live database freshness check.")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("database", "input", "floor", "graph"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    def read(path):
        return json.loads(path.read_text(encoding="utf-8-sig"))
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        result = build(db, read(args.input), read(args.floor), read(args.graph))
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

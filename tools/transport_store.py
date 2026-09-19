"""Persistent package-transfer prototype; no telemetry or browser connection.

One package represents one completed pick. Locations/resources are declared IDs,
not surveyed coordinates or verified permissions. Times are supplied observations
or simulated times. Movement events do not claim collision-free or safe routing.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import order_store

SCHEMA = """
CREATE TABLE IF NOT EXISTS transport_location(id TEXT PRIMARY KEY NOT NULL);
CREATE TABLE IF NOT EXISTS transport_resource(id TEXT PRIMARY KEY NOT NULL);
CREATE TABLE IF NOT EXISTS package(
 id TEXT PRIMARY KEY NOT NULL,
 pick_id TEXT NOT NULL UNIQUE REFERENCES pick(id),
 source_id TEXT NOT NULL REFERENCES transport_location(id),
 destination_id TEXT NOT NULL REFERENCES transport_location(id),
 location_id TEXT REFERENCES transport_location(id),
 resource_id TEXT REFERENCES transport_resource(id),
 state TEXT NOT NULL CHECK(state IN ('waiting','assigned','loading','travelling','blocked','unloading','delivered')),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 updated_at TEXT NOT NULL,
 CHECK(source_id<>destination_id));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_package_per_resource
 ON package(resource_id) WHERE resource_id IS NOT NULL AND state<>'delivered';
CREATE TABLE IF NOT EXISTS transport_event(
 id TEXT PRIMARY KEY NOT NULL,
 package_id TEXT NOT NULL REFERENCES package(id),
 version INTEGER NOT NULL,
 state TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 payload TEXT NOT NULL,
 UNIQUE(package_id,version));
CREATE VIEW IF NOT EXISTS package_manifest AS
 SELECT p.*, k.quantity, l.item_id, l.order_id, l.id AS line_id, i.unit
 FROM package p JOIN pick k ON k.id=p.pick_id
 JOIN line l ON l.id=k.line_id JOIN item i ON i.id=l.item_id;
"""
NEXT = {
    "waiting": {"assigned"}, "assigned": {"loading"},
    "loading": {"travelling"}, "travelling": {"blocked", "unloading"},
    "blocked": {"travelling"}, "unloading": {"delivered"}, "delivered": set(),
}


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Timestamp must be an ISO string with timezone")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds")


def identifier(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ValueError("IDs must contain 1-200 characters")
    return value


def initialize(db):
    # Explicit additive setup, rather than changing a database on read/connect.
    if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pick'").fetchone() is None:
        raise ValueError("Initialize the order/pick database first")
    db.executescript(SCHEMA)


def apply_event(db, event_id, package_id, payload, action):
    identifier(event_id)
    identifier(package_id)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    db.execute("BEGIN IMMEDIATE")
    try:
        prior = db.execute("SELECT package_id,payload FROM transport_event WHERE id=?", (event_id,)).fetchone()
        if prior:
            if prior["package_id"] != package_id or prior["payload"] != encoded:
                raise ValueError("Event ID reused with different content")
            db.commit()
            return "already-applied"
        action()
        row = db.execute("SELECT * FROM package WHERE id=?", (package_id,)).fetchone()
        db.execute("INSERT INTO transport_event VALUES(?,?,?,?,?,?)",
                   (event_id, package_id, row["version"], row["state"], row["updated_at"], encoded))
        db.commit()
        return "applied"
    except Exception:
        db.rollback()
        raise


def create_package(db, package_id, pick_id, source_id, destination_id, event_id, occurred_at):
    for value in (pick_id, source_id, destination_id):
        identifier(value)
    at = timestamp(occurred_at)
    payload = dict(kind="created", pick=pick_id, source=source_id, destination=destination_id, at=at)

    def action():
        pick = db.execute("SELECT status FROM pick WHERE id=?", (pick_id,)).fetchone()
        if not pick or pick["status"] != "completed":
            raise ValueError("A package must reference a completed pick")
        picked = db.execute("SELECT occurred_at FROM event WHERE pick_id=?", (pick_id,)).fetchone()
        if not picked or at < timestamp(picked["occurred_at"]):
            raise ValueError("Package creation cannot precede pick completion")
        db.execute("INSERT INTO package VALUES(?,?,?,?,?,NULL,'waiting',0,?)",
                   (package_id, pick_id, source_id, destination_id, source_id, at))

    return apply_event(db, event_id, package_id, payload, action)


def transition(db, package_id, target, expected_version, event_id, occurred_at, resource_id=None, reason=""):
    if target not in NEXT or type(expected_version) is not int or expected_version < 0:
        raise ValueError("Unknown state or invalid expected version")
    if not isinstance(reason, str) or len(reason) > 1000 or (target == "blocked" and not reason.strip()):
        raise ValueError("Blocked events require a reason; maximum 1000 characters")
    if target == "assigned":
        identifier(resource_id)
    elif resource_id is not None:
        raise ValueError("Resource may only be supplied for assignment")
    at = timestamp(occurred_at)
    payload = dict(kind="transition", target=target, expected_version=expected_version,
                   resource=resource_id, reason=reason, at=at)

    def action():
        row = db.execute("SELECT * FROM package WHERE id=?", (package_id,)).fetchone()
        if not row or row["version"] != expected_version:
            raise ValueError("Unknown package or stale expected version")
        if target not in NEXT[row["state"]]:
            raise ValueError(f"Transition {row['state']} -> {target} is not permitted")
        if at < row["updated_at"]:
            raise ValueError("Event time cannot go backwards")
        resource = resource_id if target == "assigned" else row["resource_id"]
        location = (None if target in {"travelling", "blocked"} else
                    row["destination_id"] if target in {"unloading", "delivered"} else row["source_id"])
        db.execute("UPDATE package SET state=?,version=version+1,updated_at=?,resource_id=?,location_id=? WHERE id=?",
                   (target, at, resource, location, package_id))

    return apply_event(db, event_id, package_id, payload, action)


def demo(db):
    order_store.seed(db)
    initialize(db)
    db.executemany("INSERT INTO transport_location VALUES(?)", [("PICK-FACE",), ("PACK-BENCH",)])
    db.execute("INSERT INTO transport_resource VALUES('WORKER-1')")
    order_store.reserve(db, "PICK-1", "LINE-A", 4)
    order_store.complete(db, "PICK-1", "PICK-EVENT", "2026-09-19T10:00:00Z")
    create_package(db, "PACKAGE-1", "PICK-1", "PICK-FACE", "PACK-BENCH", "T0", "2026-09-19T10:00:00Z")
    for version, state in enumerate(["assigned", "loading", "travelling", "blocked", "travelling", "unloading", "delivered"]):
        transition(db, "PACKAGE-1", state, version, f"T{version+1}", f"2026-09-19T10:{version+1:02}:00Z",
                   resource_id="WORKER-1" if state == "assigned" else None,
                   reason="Synthetic aisle wait" if state == "blocked" else "")


def export_ledger(db):
    """One consistent read snapshot. Fail instead of silently truncating history."""
    db.execute("BEGIN")
    try:
        packages = [dict(row) for row in db.execute("SELECT * FROM package_manifest ORDER BY id LIMIT 1001")]
        events = [dict(row) for row in db.execute("SELECT * FROM transport_event ORDER BY package_id,version LIMIT 10001")]
        if len(packages) > 1000 or len(events) > 10000:
            raise ValueError("Viewer export limit exceeded: 1000 packages / 10000 events")
        for event in events:
            event["payload"] = json.loads(event["payload"])
        result = {"schema": "factory-transfer-ledger/v1", "provenance": "Declared ledger data; not independently verified telemetry",
                  "packages": packages, "events": events}
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("command", choices=["demo", "manifest", "events", "export"])
    args = parser.parse_args()
    if args.command == "demo" and args.database.exists():
        parser.error("Demo requires a NEW database path")
    if args.command != "demo" and not args.database.is_file():
        parser.error("Database does not exist")
    args.database.parent.mkdir(parents=True, exist_ok=True)
    db = order_store.connect(args.database)
    try:
        if args.command == "demo":
            demo(db)
        if args.command == "export":
            print(json.dumps(export_ledger(db), indent=2))
            return
        sql = ("SELECT * FROM transport_event ORDER BY package_id,version" if args.command == "events"
               else "SELECT * FROM package_manifest ORDER BY id")
        print(json.dumps(order_store.query(db, sql), indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()

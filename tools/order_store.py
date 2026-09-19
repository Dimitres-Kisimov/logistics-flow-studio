"""Local SQLite order/pick prototype. Integer base units; no live WMS connection."""
import argparse
import json
import sqlite3
from pathlib import Path

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE item(id TEXT PRIMARY KEY NOT NULL, unit TEXT NOT NULL);
CREATE TABLE orders(id TEXT PRIMARY KEY NOT NULL, due_at TEXT NOT NULL);
CREATE TABLE line(id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id),
 item_id TEXT NOT NULL REFERENCES item(id), quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0));
CREATE TABLE stock(item_id TEXT PRIMARY KEY REFERENCES item(id), on_hand INTEGER NOT NULL,
 reserved INTEGER NOT NULL DEFAULT 0,
 CHECK(typeof(on_hand)='integer' AND typeof(reserved)='integer' AND on_hand>=reserved AND reserved>=0));
CREATE TABLE pick(id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES line(id),
 quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0),
 status TEXT NOT NULL CHECK(status IN ('reserved','completed')));
CREATE TABLE event(id TEXT PRIMARY KEY NOT NULL, pick_id TEXT NOT NULL UNIQUE REFERENCES pick(id),
 kind TEXT NOT NULL CHECK(kind='picked'), occurred_at TEXT NOT NULL);
CREATE VIEW order_progress AS
 SELECT l.id AS line_id, l.order_id, l.item_id, l.quantity AS ordered,
 COALESCE(SUM(CASE WHEN p.status='completed' THEN p.quantity ELSE 0 END),0) AS picked,
 COALESCE(SUM(CASE WHEN p.status='reserved' THEN p.quantity ELSE 0 END),0) AS reserved
 FROM line l LEFT JOIN pick p ON p.line_id=l.id GROUP BY l.id;
"""


def connect(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=5)
    db.execute("PRAGMA foreign_keys=ON")
    db.row_factory = sqlite3.Row
    return db


def reserve(db, task_id, line_id, quantity):
    if type(quantity) is not int or quantity <= 0:
        raise ValueError("Pick quantity must be a positive integer in the item's base unit")
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT * FROM order_progress WHERE line_id=?", (line_id,)).fetchone()
        if row is None or quantity > row["ordered"] - row["picked"] - row["reserved"]:
            raise ValueError("Unknown line or quantity exceeds unallocated demand")
        updated = db.execute("UPDATE stock SET reserved=reserved+? WHERE item_id=? AND on_hand-reserved>=?",
                             (quantity, row["item_id"], quantity)).rowcount
        if updated != 1:
            raise ValueError("Insufficient available inventory")
        db.execute("INSERT INTO pick VALUES(?,?,?,'reserved')", (task_id, line_id, quantity))
        db.commit()
    except Exception:
        db.rollback()
        raise


def complete(db, task_id, event_id, occurred_at):
    db.execute("BEGIN IMMEDIATE")
    try:
        existing = db.execute("SELECT * FROM event WHERE id=?", (event_id,)).fetchone()
        if existing:
            if existing["pick_id"] != task_id or existing["occurred_at"] != occurred_at:
                raise ValueError("Event ID reused with different content")
            db.commit()
            return "already-applied"
        row = db.execute("SELECT p.*, l.item_id FROM pick p JOIN line l ON l.id=p.line_id WHERE p.id=?",
                         (task_id,)).fetchone()
        if row is None or row["status"] != "reserved":
            raise ValueError("Pick is missing or already completed")
        db.execute("UPDATE stock SET on_hand=on_hand-?, reserved=reserved-? WHERE item_id=?",
                   (row["quantity"], row["quantity"], row["item_id"]))
        db.execute("UPDATE pick SET status='completed' WHERE id=?", (task_id,))
        db.execute("INSERT INTO event VALUES(?,?,'picked',?)", (event_id, task_id, occurred_at))
        db.commit()
        return "applied"
    except Exception:
        db.rollback()
        raise


def query(db, sql):
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
    count = 0

    def budget():
        nonlocal count
        count += 1
        return int(count > 10000)

    db.set_authorizer(lambda action, *_: sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY)
    db.set_progress_handler(budget, 1000)
    try:
        cursor = db.execute(sql)
        rows = cursor.fetchmany(1001)
        return {"rows": [dict(row) for row in rows[:1000]], "truncated": len(rows) > 1000}
    finally:
        db.set_authorizer(None)
        db.set_progress_handler(None, 0)


def seed(db):
    db.executescript(SCHEMA)
    db.execute("INSERT INTO item VALUES('KIT-A','piece')")
    db.execute("INSERT INTO orders VALUES('ORDER-A','2026-09-20T16:00:00Z')")
    db.execute("INSERT INTO line VALUES('LINE-A','ORDER-A','KIT-A',6)")
    db.execute("INSERT INTO stock VALUES('KIT-A',10,0)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("demo", help="Create a NEW synthetic database and execute a pick")
    read = commands.add_parser("query", help="Execute bounded read-only SQL")
    read.add_argument("sql")
    args = parser.parse_args()
    if args.command == "demo" and args.database.exists():
        parser.error("Demo requires a new database path; existing data is never overwritten")
    if args.command == "query" and not args.database.is_file():
        parser.error("Database does not exist")
    args.database.parent.mkdir(parents=True, exist_ok=True)
    with connect(args.database) as db:
        if args.command == "demo":
            seed(db)
            reserve(db, "PICK-1", "LINE-A", 4)
            complete(db, "PICK-1", "EVENT-1", "2026-09-19T10:00:00Z")
            result = query(db, "SELECT * FROM order_progress ORDER BY line_id")
        else:
            result = query(db, args.sql)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

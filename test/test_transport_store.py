import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import order_store as orders
import transport_store as transport


class TransportStoreTests(unittest.TestCase):
    def setUp(self):
        self.db = orders.connect(":memory:")
        orders.seed(self.db)
        transport.initialize(self.db)
        self.db.executemany("INSERT INTO transport_location VALUES(?)", [("A",), ("B",)])
        self.db.execute("INSERT INTO transport_resource VALUES('R')")
        for task in ("P1", "P2"):
            orders.reserve(self.db, task, "LINE-A", 2)
            orders.complete(self.db, task, "E" + task, "2026-09-19T10:00:00Z")

    def tearDown(self):
        self.db.close()

    def create(self, package="U1", pick="P1"):
        return transport.create_package(self.db, package, pick, "A", "B", "C" + package, "2026-09-19T10:00:00Z")

    def move(self, state, version, package="U1", event=None, **kwargs):
        return transport.transition(self.db, package, state, version, event or f"{package}-{version}",
                                    "2026-09-19T10:01:00Z", **kwargs)

    def test_manifest_lifecycle_and_idempotent_retry(self):
        self.assertEqual(self.create(), "applied")
        self.assertEqual(self.create(), "already-applied")
        for version, state in enumerate(["assigned", "loading", "travelling", "blocked", "travelling", "unloading", "delivered"]):
            kwargs = {"resource_id": "R"} if state == "assigned" else {"reason": "Aisle occupied"} if state == "blocked" else {}
            self.assertEqual(self.move(state, version, **kwargs), "applied")
            self.assertEqual(self.move(state, version, **kwargs), "already-applied")
            row = dict(self.db.execute("SELECT * FROM package_manifest").fetchone())
            self.assertEqual(row["location_id"], None if state in {"travelling", "blocked"} else "B" if state in {"unloading", "delivered"} else "A")
        self.assertEqual((row["quantity"], row["item_id"], row["order_id"], row["version"]), (2, "KIT-A", "ORDER-A", 7))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM transport_event").fetchone()[0], 8)
        self.assertEqual(tuple(self.db.execute("SELECT on_hand,reserved FROM stock").fetchone()), (6, 0))
        self.create("U2", "P2")
        self.assertEqual(self.move("assigned", 0, "U2", resource_id="R"), "applied")

    def test_illegal_stale_backdated_and_changed_retries_roll_back(self):
        self.create()
        for state, version in [("delivered", 0), ("loading", 0), ("assigned", 5)]:
            with self.assertRaises(ValueError):
                self.move(state, version, resource_id="R" if state == "assigned" else None)
        self.move("assigned", 0, resource_id="R")
        with self.assertRaises(ValueError):
            self.move("assigned", 0, resource_id="R", reason="changed payload")
        with self.assertRaises(ValueError):
            transport.transition(self.db, "U1", "loading", 1, "backdated", "2026-09-19T09:00:00Z")
        self.assertEqual(self.db.execute("SELECT version FROM package").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM transport_event").fetchone()[0], 2)

    def test_resource_contention_and_unique_pick(self):
        self.create()
        self.create("U2", "P2")
        self.move("assigned", 0, resource_id="R")
        with self.assertRaises(sqlite3.IntegrityError):
            self.move("assigned", 0, "U2", resource_id="R")
        with self.assertRaises(sqlite3.IntegrityError):
            self.create("duplicate", "P1")
        row = self.db.execute("SELECT state,version FROM package WHERE id='U2'").fetchone()
        self.assertEqual(tuple(row), ("waiting", 0))

    def test_creation_requires_completed_pick_locations_and_valid_time(self):
        orders.reserve(self.db, "P3", "LINE-A", 1)
        with self.assertRaises(ValueError):
            self.create("U3", "P3")
        for source, destination, at, error in [
            ("missing", "B", "2026-09-19T10:00:00Z", sqlite3.IntegrityError),
            ("A", "A", "2026-09-19T10:00:00Z", sqlite3.IntegrityError),
            ("A", "B", "2026-09-19T09:00:00Z", ValueError),
            ("A", "B", "2026-09-19T10:00:00", ValueError),
        ]:
            with self.assertRaises(error):
                transport.create_package(self.db, "U", "P1", source, destination, "X", at)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM package").fetchone()[0], 0)

    def test_restart_and_second_connection_stale_update(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "transport.sqlite"
            first = orders.connect(path)
            transport.demo(first)
            first.close()
            first = orders.connect(path)
            second = orders.connect(path)
            try:
                self.assertEqual(first.execute("SELECT state FROM package").fetchone()[0], "delivered")
                with self.assertRaises(ValueError):
                    transport.transition(second, "PACKAGE-1", "loading", 1, "stale", "2026-09-19T11:00:00Z")
                self.assertEqual(first.execute("SELECT COUNT(*) FROM transport_event").fetchone()[0], 8)
            finally:
                first.close()
                second.close()

    def test_resource_cannot_be_reassigned_before_previous_delivery(self):
        self.create()
        self.create("U2", "P2")
        for version, state in enumerate(["assigned", "loading", "travelling", "unloading", "delivered"]):
            transport.transition(self.db, "U1", state, version, f"past-{version}",
                                 f"2026-09-19T10:{version+1:02}:00Z",
                                 resource_id="R" if state == "assigned" else None)
        with self.assertRaises(ValueError):
            transport.transition(self.db, "U2", "assigned", 0, "overlap", "2026-09-19T10:02:00Z", resource_id="R")
        self.assertEqual(self.db.execute("SELECT state FROM package WHERE id='U2'").fetchone()[0], "waiting")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM transport_event WHERE id='overlap'").fetchone()[0], 0)
        self.assertEqual(transport.transition(self.db, "U2", "assigned", 0, "boundary", "2026-09-19T10:05:00Z", resource_id="R"), "applied")

    def test_export_snapshot_does_not_truncate_or_mutate(self):
        self.create()
        before = self.db.total_changes
        first = transport.export_ledger(self.db)
        self.assertEqual(first, transport.export_ledger(self.db))
        self.assertEqual(first["schema"], "factory-transfer-ledger/v1")
        self.assertEqual(first["packages"][0]["id"], "U1")
        self.assertEqual(first["events"][0]["payload"]["kind"], "created")
        self.assertEqual(self.db.total_changes, before)
        self.assertFalse(self.db.in_transaction)

    def test_concurrent_assignment_has_only_one_winner(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "race.sqlite"
            setup = orders.connect(path)
            self.db.backup(setup)
            for index in (1, 2):
                transport.create_package(setup, f"U{index}", f"P{index}", "A", "B", f"C{index}", "2026-09-19T10:00:00Z")
            setup.close()
            barrier = Barrier(2)

            def assign(index):
                db = orders.connect(path)
                try:
                    barrier.wait(timeout=5)
                    try:
                        return transport.transition(db, f"U{index}", "assigned", 0, f"A{index}",
                                                    "2026-09-19T10:01:00Z", resource_id="R")
                    except sqlite3.IntegrityError:
                        return "resource-busy"
                finally:
                    db.close()

            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertCountEqual(list(pool.map(assign, (1, 2))), ["applied", "resource-busy"])
            check = orders.connect(path)
            try:
                self.assertEqual(check.execute("SELECT COUNT(*) FROM package WHERE state='assigned'").fetchone()[0], 1)
                self.assertEqual(check.execute("SELECT COUNT(*) FROM transport_event").fetchone()[0], 3)
            finally:
                check.close()


if __name__ == "__main__":
    unittest.main()

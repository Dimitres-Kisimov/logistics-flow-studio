import importlib.util
import sqlite3
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("order_store", Path(__file__).resolve().parents[1] / "tools/order_store.py")
store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(store)


class OrderStoreTests(unittest.TestCase):
    def setUp(self):
        self.db = store.connect(":memory:")
        store.seed(self.db)

    def tearDown(self):
        self.db.close()

    def test_pick_and_idempotent_retry(self):
        store.reserve(self.db, "P1", "LINE-A", 4)
        self.assertEqual(store.complete(self.db, "P1", "E1", "2026-09-19T10:00:00Z"), "applied")
        self.assertEqual(store.complete(self.db, "P1", "E1", "2026-09-19T10:00:00Z"), "already-applied")
        self.assertEqual(tuple(self.db.execute("SELECT on_hand,reserved FROM stock").fetchone()), (6, 0))
        with self.assertRaises(ValueError):
            store.complete(self.db, "P1", "E1", "different")

    def test_demand_and_stock_protection(self):
        with self.assertRaises(ValueError):
            store.reserve(self.db, "P1", "LINE-A", 7)
        self.db.execute("UPDATE stock SET on_hand=2")
        with self.assertRaises(ValueError):
            store.reserve(self.db, "P1", "LINE-A", 3)
        self.assertEqual(self.db.execute("SELECT reserved FROM stock").fetchone()[0], 0)

    def test_duplicate_task_rolls_back_stock(self):
        store.reserve(self.db, "P1", "LINE-A", 2)
        with self.assertRaises(sqlite3.IntegrityError):
            store.reserve(self.db, "P1", "LINE-A", 2)
        self.assertEqual(self.db.execute("SELECT reserved FROM stock").fetchone()[0], 2)

    def test_read_only_queries_and_foreign_keys(self):
        self.assertEqual(store.query(self.db, "SELECT * FROM order_progress")["rows"][0]["ordered"], 6)
        for sql in ["DELETE FROM stock", "DROP TABLE stock", "PRAGMA foreign_keys=OFF", "ATTACH ':memory:' AS other"]:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.DatabaseError):
                store.query(self.db, sql)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO line VALUES('bad','missing','KIT-A',1)")


if __name__ == "__main__":
    unittest.main()

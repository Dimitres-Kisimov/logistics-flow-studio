"""Generate the SQL-linked resource example from synthetic SQLite history."""
import json
from pathlib import Path

import order_store
import package_resource_motion
import transport_store


def build():
    root = Path(__file__).resolve().parents[1] / "examples/routes"
    def read(name):
        return json.loads((root / name).read_text(encoding="utf-8-sig"))
    db = order_store.connect(":memory:")
    try:
        transport_store.demo(db)
        return package_resource_motion.build(db, read("package-resource-input.json"), read("floor.json"), read("graph.json"))
    finally:
        db.close()


if __name__ == "__main__":
    print(json.dumps(build(), indent=2, allow_nan=False))

"""Build the bundled synthetic viewer demo from the actual SQL and route tools."""
import json
from pathlib import Path

import order_store
import package_route
import traffic_schedule
import transport_store


def build():
    root = Path(__file__).resolve().parents[1]
    floor = json.loads((root / "examples/routes/floor.json").read_text())
    graph = json.loads((root / "examples/routes/graph.json").read_text())
    access = json.loads((root / "examples/routes/location-access.json").read_text())
    db = order_store.connect(":memory:")
    try:
        transport_store.demo(db)
        timeline = package_route.scenario(db, "PACKAGE-1", floor, graph, access, "worker", .3, 1, 5, 3)
        ledger = transport_store.export_ledger(db)
    finally:
        db.close()
    requests = dict(schema="factory-area-requests/v1", horizon_s=60,
                    areas=[dict(id="DEMO-AISLE", capacity=1)],
                    requests=[dict(id="PACKAGE-1", release_s=8, duration_s=timeline["duration_s"],
                                   areas=["DEMO-AISLE"], availability_s=[[0, 10], [30, 60]])])
    timeline = traffic_schedule.bind_timeline(timeline, traffic_schedule.schedule(requests), "PACKAGE-1")
    return dict(schema="factory-viewer-demo/v1", label="Synthetic worked example; no measured plant data",
                ledger=ledger, floor=floor, timeline=timeline)


if __name__ == "__main__":
    print(json.dumps(build(), indent=2, allow_nan=False))

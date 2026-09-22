# Sample data (synthetic)

`skus.csv` (120 articles) and `orders.csv` (300 orders, 1021 lines) are a **synthetic, seeded**
SKU master and order file written by `tools/make_sample_data.py` (seed 20260922). No real inventory,
no real orders, no personal data - a teaching file to try the planner, the live flow and the run ledger on
"your own data" before you bring yours. `python tools/make_sample_data.py --check` proves the committed
files are what the script writes.

**Headers** (exactly what `wmsdata.js` imports; the importer also accepts common aliases):

```
sku,description,abc_class,velocity,weight_kg,storage_type
order_id,sku,qty
```

`velocity` is picks per week (a rank-based tail: the first article moves most); `abc_class` is by rank
(20 / 30 / 50 %); `storage_type` is left blank so the importer derives it from class and weight; every
order has 1-6 distinct lines of 1-12 eaches, articles drawn in proportion to their velocity.

**Use them:** in the planner, *Data & storage* -> import the SKU master, then the order pool; play the
live flow and open the run in the run-ledger viewer (or `run-ledger.html?example=d`, the recorded run of
the e-commerce floor fed with this file). `node tools/make_run_ledger_fixture.mjs d` records that run
through the same importer. See README "Run it on your own data".

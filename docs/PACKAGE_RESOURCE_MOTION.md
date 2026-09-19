# SQL-linked resource scenarios

`package_resource_motion.py` joins SQL package identity to the scheduled resource view. A job specifies a package ID and expected manifest version. Endpoints, order, pick, item, quantity and unit come from the SQL snapshot; manual source/destination overrides and repeated use of the same package are rejected.

```text
python tools/package_resource_motion.py --database path/to/transfers.sqlite --input examples/routes/package-resource-input.json --floor examples/routes/floor.json --graph examples/routes/graph.json
```

The database must already exist with the order/transport schema. The CLI opens SQLite with `mode=ro`. The existing ledger exporter obtains manifests and event histories in one explicit read transaction; only selected packages and their history are included in the final artifact. Its existing limits still apply to the entire ledger: 1,000 packages and 10,000 events. The adapter does not write inventory, picks, assignments or events. A version mismatch rejects generation and requires reviewing current data.

The artifact contains the checked motion scenario, `package_bindings` (job to 11-field package snapshot) and `source_ledger`. Browser import validates the ledger's event sequences and manifest consistency, then matches every job to exactly one unique package, including source/destination, contents, version and updated timestamp. Missing histories, altered versions, unknown jobs and duplicate associations reject the scene. This is internal consistency, not cryptographic authenticity or a live freshness check.

Open the resource view and choose **Explore SQL-linked example**, or import the CLI JSON. The recorded snapshot table displays package/order/pick IDs, contents, recorded state, version and timestamp. The animation and assignment table remain a separate what-if plan. The bundled example deliberately plans a package already recorded as delivered: it demonstrates alternative resource movement, not a new execution. Its planned resource can differ from the recorded resource. No link to a real worker is inferred from a matching name.

## Research basis and limits

[SQLite's official isolation documentation](https://www.sqlite.org/isolation.html), reviewed 2026-09-19, explains that separate connections normally see committed transactions, and a WAL read transaction retains its snapshot while other writes commit. It also explains that a fresh transaction is needed to observe subsequent changes. This supports the adapter's use of one read transaction and the explicit distinction between an exported snapshot and current operational truth. The CLI does not enable shared-cache dirty reads or change journal mode. This is a database consistency design, not industrial safety certification.

Remaining work includes live order execution, resource reservation against the current database, stale-plan reconciliation, multi-user authorisation, calibration and measured physical movement. Imported quantities do not become a throughput claim; a package is tied to its completed pick and may contain several units.

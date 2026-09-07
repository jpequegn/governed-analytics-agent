# Architecture and boundaries

```text
token -> server-mapped principal
question -> bounded resolver -> typed intent
catalog + source timestamps + principal -> gates
intent + contract -> parameterized SELECT -> exact AST validation
plan + user + snapshot + expiry -> approval hash
explicit approval -> repeat gates -> pinned read-only DuckDB
rows + catalog + snapshot + SQL + freshness -> receipt
refusal -> requester/owner review queue
```

## SQL and identity

HTTP callers cannot supply roles, catalog changes, raw SQL, source files or
timestamps. Catalog authors are trusted operators. Identifiers come from
validated contracts and are quoted; values are positional parameters.
All joins are forbidden.

AST comparison requires the exact contract-derived SELECT. Execution regenerates
SQL rather than executing caller serialization. This is not a general-purpose
SQL sanitizer. New operations require compiler and adversarial test changes.

## Snapshots

Import is a separate trusted operation using synthetic CSV. It validates complete,
finite nonnegative rows and unique IDs, then creates a new database and manifest.
Source updatedAt and import createdAt are distinct; freshness uses updatedAt.

Open verifies source/database hashes, copies the database into a private temporary
directory, and opens that pinned copy read-only with external access and automatic
extensions disabled. It checks the DuckDB version against the manifest.
The copy remains fixed for the server lifetime.

Limits: 16 MB CSV, 64 MB database, 100,000 imported rows, one DuckDB thread,
128 MB query memory, two-second interrupt timer, and 100 returned groups.
The query fetches 101 groups to detect excess and refuses rather than truncates.
These local bounds are not a complete denial-of-service defense.

Hashes detect accidental changes, not a malicious operator replacing all files.
The upstream truth of a timestamp is outside this synthetic demo.

## Evidence

Receipts embed catalog, metric definition, SQL, parameters, rows, lineage,
snapshot identity and freshness. JSON-stable hashes survive serialization.
Replay validates receipt/plan, matches the exact snapshot, reexecutes and compares
rows. It checks historical arithmetic, not current permissions or freshness.
Only a local operator invokes replay.

## Reviews and telemetry

The JSON review ledger uses a single-writer lock, serialized updates, fsynced
temporary files and atomic rename. Limits are 1,000 records and 4 MB.
It is not an append-only audit log or multi-host database. Keep it outside
synced folders. An unclean shutdown may leave a lock for operator recovery.

Requesters see their own items; owners with reviewer roles see assigned items.
Independent owner resolution records status, note and self-reported effort.
Accepted proposals never mutate the active catalog.

OpenTelemetry retains the latest 1,000 completed stage spans locally.
The demo exports traces.json. Spans contain no questions, tokens or result rows,
and there is no network exporter.


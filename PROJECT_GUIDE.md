# Capabilities, usage and extensions

## What this project demonstrates

A question must pass a metric definition, permission decision, freshness check
and SQL plan approval before execution. The receipt records those choices beside
the result. This complements #254's bounded RDF/SPARQL translator without
reimplementing it.

## First session

1. Run the demo and inspect plan.json, receipt.json and traces.json.
2. Find the cancelled NYC order in fixtures/orders.csv and confirm its exclusion.
3. Ask for unit price. Verify the formula is 720 / 7, not an average of row ratios.
4. Ask for revenue last month and observe refusal instead of an all-time answer.
5. Start the API with analyst and owner tokens; inspect and resolve a review.
6. Accept a draft proposal and confirm the metric remains unavailable until a
   separate catalog change is deployed.
7. Replay a receipt, then change one saved result and observe verification fail.

An API client sending an approval hash is not proof that a human read the plan.
The demo auto-approves only its fixed synthetic example.

## Typical uses

**P3 operations analytics.** Add an export adapter for episode counts, ingestion
failures and processing latency. Preserve the actual source watermark rather
than stamping old data with server startup time. V1 does not connect to Castflow.

**Business-metric experiments.** Compare question interpretations while holding
metric definitions constant. Keep misleading denominator and filtering examples.

**Agent regression tests.** Test candidate typed intents through the same gates.
Measure answer correctness, safe abstentions and review effort separately.
Reducing refusals alone is not an improvement.

**Evidence-backed decisions.** Attach a receipt and its exact snapshot to a
decision record. Content hashes allow change detection; identity requires a
separate signing or authentication mechanism.

## Stack choices

TypeScript, Fastify and Zod define the runtime/API boundaries. DuckDB Neo runs
the aggregates. node-sql-parser validates PostgreSQL-compatible ASTs for the
small supported subset. Execution uses regenerated SQL, not arbitrary submitted
statements. Python's standard library generates CSV and summarizes evaluations.
OpenTelemetry records bounded local stage timings/status without tokens, user
questions or row values.

No hosted model is required. The resolver is deliberately bounded. It provides a
testable starting point for a future model planner, not measured LLM capability.

## Extensions

**P3 evidence adapter.** Export read-only snapshots with episode watermarks and
approved operational metrics. Add separate field/row permissions before querying
sensitive transcript data.

**LLM planner comparison.** Compare typed-intent proposals, the bounded resolver
and a raw text-to-SQL baseline on a frozen corpus with held-out paraphrases.
Report semantic errors and review minutes, not just successful SQL execution.

**Filtered employee MCP App.** Add an approved employee-list operation and render
its typed filter state in an MCP App. The LLM could request NYC and open an
already-filtered view. Salary/address data need row and field controls beyond
this aggregate-only demo.

**Query budgets.** Integrate the planned Agent Budget Proxy for quotas and cost
estimates. V1's local size/time/result bounds are not a distributed budget service.

**Signed archive.** Sign receipts and retain exact snapshots/catalogs. Hashes do
not stop an operator replacing all artifacts.

**Owner-reviewed catalog PRs.** Convert accepted proposals into draft GitHub PRs
with semantic tests. Keep owner approval separate from deployment.

## Limits

Synthetic order data only. Double precision is educational, not production
currency accounting; a real finance adapter needs decimal units and rounding.
No joins, date filters, arbitrary SQL, personal-data import, browser UI, hosted
deployment, PostgreSQL adapter or automatic catalog promotion are included.
Local token mapping is not enterprise identity management.

Null means no matching values or an undefined denominator, not a measured zero.
Replay is historical verification and does not renew stale evidence.
The local operator and catalog author are trusted; this is not an OS sandbox for
hostile database files.

## References

- [DuckDB Node Neo](https://duckdb.org/docs/lts/clients/node_neo/overview)
- [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)


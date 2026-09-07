# Implementation plan

Source: https://github.com/jpequegn/project-ideas/issues/268

1. Scaffold TypeScript tooling and deterministic fixtures: Set up strict TypeScript, Fastify, Zod, DuckDB Neo, Vitest, CI and a Python standard-library synthetic CSV generator. Add locked dependencies, a smoke test, and a documented eight-task plan. Verify build, tests and reproducible fixtures.

2. Define approved metric contracts and catalog validation: Create strict metric, source, principal and request schemas. Validate owner, grain, source columns, lineage, freshness SLA, approved status, dimensions and mandatory filters. Version and hash the catalog. Reject duplicate identifiers and invalid references with tests.

3. Resolve bounded questions and enforce evidence gates: Parse a documented whole-question grammar to typed intents. Detect metric alias collisions and unsupported questions. Enforce trusted principal permissions, source freshness, owner and approval checks. Test stale/future data, ambiguity, unauthorized dimensions and missing context.

4. Compile and validate read-only SQL plans: Compile typed metric operations and allowlisted dimensions to parameterized SQL. Use a SQL AST parser to validate exactly the expected plan; reject writes, joins, external relations and expression changes. Include row counts and correct ratio denominators. Test injection, unsafe SQL and required filters.

5. Execute pinned DuckDB snapshots within a read-only boundary: Build a synthetic database from CSV; produce a manifest with source timestamp and database hash. Open read-only with external access disabled and resource bounds. Verify snapshot integrity, run only regenerated approved plans and return serializable rows. Test real DuckDB results, writes, external reads, tampering and denominator edge cases.

6. Require plan approval and produce reproducible evidence packets: Implement question-to-plan and explicit approval-to-execution flow with principal-bound expiring plans. Recheck all gates at execution. Capture catalog, snapshot, plan, SQL, parameters and freshness in receipts with OpenTelemetry spans. Test changed contracts, expired plans, permissions and reproducibility.

7. Expose authenticated local APIs and a durable human review queue: Add loopback Fastify API and CLI demo. Use server-side bearer-token principal mapping, no caller-selected roles. Add bounded durable review records, owner-only resolution and metric proposals without automatic catalog promotion. Test route authentication, approval workflow, persistence and review access.

8. Complete adversarial evaluation and project usage guide: Build a reproducible question corpus and Python eval analysis with correctness, permission/freshness safety, abstention, definition adherence and review burden. Add fresh-checkout smoke, documentation, example commands, limitations and extensions. Verify all acceptance criteria and CI.

## Scope decisions

Synthetic order data only. The initial resolver accepts a small documented grammar, not arbitrary natural language. Metric operations are count, sum and ratio-of-sums. All joins are prohibited. User questions never become SQL fragments. The SQL parser checks generated plans against the expected AST; DuckDB read-only mode and disabled external access provide another boundary. The server binds loopback and authenticates configured local tokens. Catalog edits remain an operator action after review. No hosted model, PostgreSQL adapter or web UI in V1.


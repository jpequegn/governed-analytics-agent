# Governed Analytics Agent

Ask a bounded analytics question, review its SQL plan, and approve execution
against a pinned read-only DuckDB snapshot. Answers include metric definitions,
lineage, freshness checks and replayable evidence. Refusals enter a review queue.

Source: [project-ideas #268](https://github.com/jpequegn/project-ideas/issues/268).
Read the [project guide](PROJECT_GUIDE.md), [architecture](docs/ARCHITECTURE.md),
and [evaluation results](docs/EVALUATION.md).

## Quick start

Requires Node.js 22+, npm and Python 3.12 for fixture/evaluation scripts.
Tested on macOS ARM64 and Linux x64. No API key, GPU or personal data needed.

```sh
git clone https://github.com/jpequegn/governed-analytics-agent.git
cd governed-analytics-agent
npm ci
npm run check
npm test
npm run demo -- data/my-demo
npx tsx src/cli.ts verify data/my-demo/receipt.json data/my-demo/snapshot
```

The demo asks for paid revenue by city within the US: Boston is 200 and NYC is
400. The cancelled NYC order is excluded. It saves plan.json, receipt.json and
traces.json. Output directories must be new. The demo explicitly auto-approves
its fixed synthetic plan; the API requires a separate approval request.

Replay checks the saved catalog, snapshot, SQL and result. It is historical
verification, not renewed freshness or proof of the producer's identity.

## Local API

```sh
npx tsx src/cli.ts init data/local
npm start -- data/local/snapshot data/reviews.json
```

The server binds http://127.0.0.1:4318 and prints an ephemeral analyst bearer token.
Set PORT to another free port if needed. Stop with Ctrl-C.
Set TOKEN to that token in another terminal:

```sh
curl -s http://127.0.0.1:4318/plans \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"question":"show revenue by city where country = \"US\""}'
```

Review plan.sql, plan.params, plan.explanation, snapshot identity and expiry.
Use the returned id and approvalHash in a separate request:

```sh
curl -s http://127.0.0.1:4318/execute \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"RETURNED-UUID","approvalHash":"RETURNED-HASH"}'
```

Plans expire after five minutes and belong to the requesting principal. They are
consumed after a correctly identified approval attempt; failed execution needs
a new plan. Planning does not run the requested analytics SQL.

## Supported questions

```text
show <metric> [by <dimension>] [where <dimension> = "<value>"]
```

The whole question must match. "show" and a final question mark are optional.
Metric and dimension names are case-insensitive; filter values retain case.

- Metrics: revenue / sales, order count / orders, average unit price / unit price.
- Dimensions: city, country.
- Examples: `order count where city = "NYC"`, `unit price by country`.
- Refusals: `revenue last month`, `revenue by status`.

V1 is a deterministic agent workflow, not unrestricted LLM chat. A future model
can propose typed intents but must still pass the same gates and approval flow.

## Contracts and review

fixtures/catalog.json defines owners, versions, grain, units, operations, mandatory
filters, dimensions, roles, lineage and freshness SLAs. All joins are prohibited.
Ratios use a ratio of sums, not an average of per-row ratios.

The default token is analyst-only. Set GA_AUTH_FILE to a private JSON file to
configure separate analyst and independent owner credentials:

```json
[
  {"token":"REPLACE-WITH-RANDOM-ANALYST-TOKEN","principal":{"id":"alice","roles":["analyst"],"dimensions":["city","country"]}},
  {"token":"REPLACE-WITH-RANDOM-OWNER-TOKEN","principal":{"id":"analytics","roles":["reviewer"],"dimensions":[]}}
]
```

Generate each token with
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
Keep credentials under ignored data/, restrict file permissions and never commit
them. Restart to reload credentials and invalidate pending plans.

| Endpoint | Purpose |
| --- | --- |
| GET /health | Minimal unauthenticated health check |
| POST /plans | Question to plan or review-linked refusal |
| POST /execute | Exact plan approval and execution |
| GET /reviews | Own requests or assigned owner reviews |
| POST /reviews/:id/resolve | Record status, note and effortMinutes |
| POST /proposals | Submit a full draft metric contract |

Resolution status is accepted or rejected. Only the designated owner with the
reviewer role can resolve a review, and never their own submission.
Accepted proposals still need an operator-reviewed catalog edit and restart.
Set GA_CATALOG to the new catalog path. No API edits approved definitions.

HTTP 401 means unauthenticated, 403 permission denied, 400 malformed input,
422 a gate/refusal or invalid operation, and 500 an unexpected failure.
Plan refusals include a stable code and reviewId.

## Verification

```sh
npm run fixtures
npm run check
npm test
npm run build
node dist/src/cli.js --help
npm run evaluate -- reports/evaluation
python3 scripts/analyze_evals.py reports/evaluation/evaluation.json
```

CI also runs the compiled CLI demo and receipt replay. Generated data, reports,
credentials and traces are ignored by Git. Keep the single-process review ledger
outside cloud-synced folders. After an unclean shutdown, confirm no process is
using it before removing its .lock file.

# Evaluation results

Initial local fixed-corpus results:

| Measure | Result |
| --- | ---: |
| Exact expected outcome | 22 / 22 |
| Answer correctness | 8 / 8 |
| Required abstentions | 14 / 14 |
| False abstentions | 0 |
| Permission-denial cases | 2 / 2 |
| Freshness-refusal cases | 3 / 3 |
| Definition adherence with correct results | 8 / 8 |
| Review items created | 14 |
| Human review minutes | Not measured |

Corpus hash: 827ac7e6a320e81f897eea0aafd941c842010a11471af6967922eae44174241b.

These are regression counts, not general natural-language accuracy estimates.
The hand-authored corpus is visible to the implementation. V1 has no held-out
model comparison, statistical confidence claim or raw text-to-SQL baseline.
Human time requires reviewer input and is not inferred from queue age.

Answer cases cover paid-order exclusion, ratio-of-sums, filters, grouping,
empty results and injection-shaped strings bound as data. Refusals cover
unsupported wording, SQL-shaped input, ambiguous names, draft metrics,
unauthorized roles/dimensions, and stale/future/missing source timestamps.

An initial expectation classified "revenue by employee department" as a dimension
error. The whole-question parser instead refuses it as an unknown metric because
multiword dimensions are outside the grammar. The case now checks that refusal;
no authorization or freshness rule was relaxed.

Additional tests cover SQL mutations, database read-only/external-read rejection,
expired/reused approvals, changed contracts, source tampering, result limits,
numeric overflow, receipt replay, persistent reviews and independent ownership.

```sh
npm run evaluate -- reports/my-evaluation
python3 scripts/analyze_evals.py reports/my-evaluation/evaluation.json
```

Each run saves expected/actual outcomes, answer receipts and a summary.
Failures produce a nonzero exit. CI also runs a compiled CLI demo and replay.

## Example arithmetic

US paid revenue is Boston 200 from one row and NYC 400 from two rows.
The cancelled NYC amount of 999 is excluded by the metric contract.
Across all paid rows, revenue is 720 and units are 7; unit price is 720/7.
The zero-unit row remains in the source-row count but adds zero to the denominator.

An empty sum returns null with zero source rows. A zero-denominator ratio also
returns null. Neither is reported as a measured zero.


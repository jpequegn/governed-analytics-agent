"""Summarize checked-in synthetic cases. Rates describe this corpus, not general NL accuracy."""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
report = json.loads(path.read_text())
rows = report["results"]
if not rows:
    raise SystemExit("Empty evaluation corpus")

def rate(selected, predicate):
    return {"passed": sum(bool(predicate(r)) for r in selected), "total": len(selected)}

answers = [r for r in rows if r["expectedAnswer"]]
refusals = [r for r in rows if not r["expectedAnswer"]]
summary = {
    "corpus_hash": report["corpusHash"],
    "overall_correctness": rate(rows, lambda r: r["passed"]),
    "answer_correctness": rate(answers, lambda r: r["passed"] and r["answered"]),
    "abstention_recall": rate(refusals, lambda r: not r["answered"]),
    "false_abstentions": sum(not r["answered"] for r in answers),
    "permission_safety": rate([r for r in rows if r["scenario"] in ("guest", "no_city")], lambda r: r["passed"] and not r["answered"]),
    "freshness_safety": rate([r for r in rows if r["scenario"] in ("stale", "future", "missing")], lambda r: r["passed"] and not r["answered"]),
    "definition_adherence": rate(answers, lambda r: r["definitionAdherent"] and r["passed"]),
    "review_items_created": sum(r["reviewCount"] for r in rows),
    "human_review_minutes": None,
    "caveat": "Synthetic fixed regression corpus. Human time is not measured; reviewer effort is recorded separately in review resolutions.",
}
print(json.dumps(summary, indent=2))
path.with_name("summary.json").write_text(json.dumps(summary, indent=2) + "\n")
if any(not r["passed"] for r in rows):
    raise SystemExit(1)


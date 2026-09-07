"""Generate a tiny reproducible synthetic analytics corpus, without personal data."""
import csv
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "fixtures"
root.mkdir(exist_ok=True)
rows = [
    (1, "NYC", "US", "paid", 100, 1),
    (2, "NYC", "US", "paid", 300, 3),
    (3, "Boston", "US", "paid", 200, 2),
    (4, "London", "UK", "paid", 120, 1),
    (5, "NYC", "US", "cancelled", 999, 9),
    (6, "London", "UK", "paid", 0, 0),
]
with (root / "orders.csv").open("w", newline="") as stream:
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(["id", "city", "country", "status", "amount", "units"])
    writer.writerows(rows)


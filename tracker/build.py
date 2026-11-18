"""Pipeline step 2: build data/history.csv from the raw files alone.

    python -m tracker.build

Day by day (date folders in order) and source by source, every raw file
data/raw/<date>/<source>.<format>.gz is converted to one row per item with
the common columns (convert.py) and added to the history. A date with no raw
file for a source has no rows from that source. If a source lists the same
item twice on one day, the first listing is kept. Rows are sorted by date,
then by item_id.

Nothing else is read, so building again from the same raw files writes the
same file byte for byte, and a change to a conversion rule reaches every day.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from . import config
from .convert import COLUMNS, COUNTS, DECIMAL, convert
from .fetch import read_raw

_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def raw_files(raw_dir: Path) -> list[tuple[str, str, Path]]:
    """[(date, source, path)] for every raw file, in date then source order."""
    if not raw_dir.exists():
        return []
    out = []
    for folder in sorted(p for p in raw_dir.iterdir() if p.is_dir() and _DAY.match(p.name)):
        for path in sorted(folder.glob("*.gz")):
            out.append((folder.name, path.name.split(".")[0], path))
    return out


def raw_dates(raw_dir: Path) -> list[str]:
    """Every date that has at least one raw file."""
    return sorted({day for day, _, _ in raw_files(raw_dir)})


def day_rows(day: str, files: list[tuple[str, Path]]) -> list[dict]:
    """One day's rows from that day's raw files (source, path)."""
    rows: dict[str, dict] = {}
    for source, path in files:
        for row in convert(source, read_raw(path), day):
            rows.setdefault(row["item_id"], row)
    return [rows[k] for k in sorted(rows)]


def build_history(raw_dir: Path) -> list[dict]:
    by_day: dict[str, list[tuple[str, Path]]] = {}
    for day, source, path in raw_files(raw_dir):
        by_day.setdefault(day, []).append((source, path))
    history = []
    for day in sorted(by_day):
        history.extend(day_rows(day, by_day[day]))
    return history


def cell(column: str, value) -> str:
    if value is None or value == "":
        return ""
    if column in DECIMAL:
        return f"{float(value):.1f}"
    return str(value)


def write_history(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow([cell(c, row[c]) for c in COLUMNS])


def read_history(path: Path) -> list[dict]:
    """history.csv back as dicts, numbers parsed (empty -> None)."""
    if not path.exists():
        return []
    rows = []
    with open(path, encoding="utf-8", newline="") as f:
        for raw in csv.DictReader(f):
            row = dict(raw)
            for c in DECIMAL | COUNTS:
                v = row.get(c, "")
                row[c] = None if v in ("", None) else (float(v) if c in DECIMAL else int(v))
            rows.append(row)
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, default=config.DATA_DIR)
    args = ap.parse_args(argv)
    rows = build_history(args.data_dir / "raw")
    write_history(rows, args.data_dir / "history.csv")
    days = len({r["date"] for r in rows})
    items = len({r["item_id"] for r in rows})
    print(f"history.csv: {len(rows)} rows, {items} items, {days} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())

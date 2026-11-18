"""Pipeline step 3: write data/status.json, which describes the latest run.

    python -m tracker.status

Reads the latest run log (data/runs/<date>.json, written by fetch.py), the raw
folders and data/history.csv. Keys:

  run_time           UTC time of the latest run (YYYY-MM-DDTHH:MM:SSZ)
  run_date           its UTC date
  first_run_date     date of the earliest raw file
  days_with_success  number of different dates with a raw file
  items              items in the latest run (rows on run_date)
  new_today          items that appeared since their source's previous run
  gone_today         items that disappeared since their source's previous run
  sources            one entry per source: name, ok, count, format, error
  previous           {source: date of its previous run}
  new_items, gone_items  the items behind new_today and gone_today
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config
from .build import raw_dates, read_history
from .moves import compare


def latest_log(data_dir: Path) -> dict:
    logs = sorted((data_dir / "runs").glob("*.json"))
    if not logs:
        raise SystemExit("no run log in data/runs; run `python -m tracker.fetch` first")
    return json.loads(logs[-1].read_text(encoding="utf-8"))


def _brief(r: dict) -> dict:
    return {"item_id": r["item_id"], "item": r["item"], "team": r["team"], "source": r["source"]}


def build_status(data_dir: Path) -> dict:
    log = latest_log(data_dir)
    rows = read_history(data_dir / "history.csv")
    days = raw_dates(data_dir / "raw")
    day = log["date"]
    cmp = compare(rows, day)
    return {
        "run_time": log["run_time"],
        "run_date": day,
        "first_run_date": days[0] if days else None,
        "days_with_success": len(days),
        "items": sum(r["date"] == day for r in rows),
        "new_today": len(cmp["appeared"]),
        "gone_today": len(cmp["gone"]),
        "sources": [{"name": s["name"], "ok": s["ok"], "count": s["count"],
                     "format": s.get("format", ""), "error": s.get("error", "")}
                    for s in log["sources"]],
        "previous": dict(sorted(cmp["previous"].items())),
        "new_items": [_brief(r) for r in cmp["appeared"]],
        "gone_items": [_brief(r) for r in cmp["gone"]],
    }


def write_status(status: dict, path: Path) -> None:
    path.write_text(json.dumps(status, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, default=config.DATA_DIR)
    args = ap.parse_args(argv)
    status = build_status(args.data_dir)
    write_status(status, args.data_dir / "status.json")
    ok = sum(s["ok"] for s in status["sources"])
    print(f"status.json: run {status['run_time']}, {ok}/{len(status['sources'])} sources ok, "
          f"{status['items']} items, +{status['new_today']} new, -{status['gone_today']} gone, "
          f"{status['days_with_success']} days with a successful run")
    return 0


if __name__ == "__main__":
    sys.exit(main())

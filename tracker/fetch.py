"""Pipeline step 1: call every source and save what it returns.

    python -m tracker.fetch                       # today's UTC date
    python -m tracker.fetch --only espn_teams     # re-fetch one source

Each source is one GET request. The answer is saved byte for byte, gzip-
compressed, to data/raw/<date>/<source>.<format>.gz (e.g. espn_players.json.gz).
Before it is saved it must convert to at least MIN_ITEMS items; otherwise the
source counts as failed and writes no raw file that day.

Every source's result (ok, count, error, ...) is recorded in
data/runs/<date>.json, success or failure; status.py turns it into the status
file. One source failing never stops the others.

A second run on the same date replaces that date's raw files and run log, so
each date counts once.
"""
from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import requests

from . import config
from .convert import convert


class SourceError(Exception):
    """The source answered, but not with a usable list of items."""


def download(src: dict, timeout: int = 60, tries: int = 4) -> bytes:
    """GET the source's URL and return the body as sent. Retries on throttling,
    server errors and dropped connections."""
    headers = {"User-Agent": config.USER_AGENT, "Accept": "application/json"}
    for attempt in range(1, tries + 1):
        try:
            resp = requests.get(src["url"], params=src.get("params"), headers=headers, timeout=timeout)
        except (requests.ConnectionError, requests.Timeout):
            if attempt == tries:
                raise
            time.sleep(2 ** attempt)
            continue
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < tries:
            time.sleep(2 ** attempt)
            continue
        resp.raise_for_status()
        return resp.content
    raise SourceError("no answer")  # not reached


def raw_path(data_dir: Path, day: str, src: dict) -> Path:
    return data_dir / "raw" / day / f"{src['name']}.{src['format']}.gz"


def write_raw(raw: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # mtime=0 keeps the file identical when the source sends identical bytes.
    path.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))


def read_raw(path: Path) -> bytes:
    return gzip.decompress(path.read_bytes())


def fetch_source(src: dict, day: str, get: Callable[[dict], bytes] = download) -> tuple[dict, bytes | None]:
    """Fetch one source. Returns (result for the run log, raw bytes or None)."""
    started = time.monotonic()
    result = {"name": src["name"], "format": src["format"], "url": src["url"],
              "ok": False, "count": 0, "bytes": 0, "error": ""}
    raw = None
    try:
        raw = get(src)
        count = len(convert(src["name"], raw, day))
        if count < config.MIN_ITEMS:
            raise SourceError(f"only {count} items (fewer than {config.MIN_ITEMS})")
        result.update(ok=True, count=count, bytes=len(raw))
    except Exception as exc:  # one source failing must not stop the run
        raw = None
        result["error"] = f"{type(exc).__name__}: {exc}"[:300]
    result["seconds"] = round(time.monotonic() - started, 1)
    return result, raw


def run(data_dir: Path = config.DATA_DIR, sources: list[dict] | None = None,
        now: datetime | None = None, get: Callable[[dict], bytes] = download,
        whole_day: bool = True) -> dict:
    """Fetch the sources and write that day's raw files and run log.

    whole_day=True (the daily run) first clears everything saved for the date,
    so a rerun leaves no stale file behind. whole_day=False (--only) replaces
    just the named sources and keeps the rest of the day.
    """
    sources = config.SOURCES if sources is None else sources
    now = now or datetime.now(timezone.utc)
    run_time = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    day = now.date().isoformat()

    outcomes = [(src, *fetch_source(src, day, get)) for src in sources]

    day_dir = data_dir / "raw" / day
    log_path = data_dir / "runs" / f"{day}.json"
    kept = []
    if whole_day:
        if day_dir.exists():
            shutil.rmtree(day_dir)
    else:
        names = {s["name"] for s in sources}
        for path in day_dir.glob("*.gz") if day_dir.exists() else []:
            if path.name.split(".")[0] in names:
                path.unlink()
        if log_path.exists():
            old = json.loads(log_path.read_text(encoding="utf-8"))["sources"]
            kept = [r for r in old if r["name"] not in names]
    for src, result, raw in outcomes:
        if raw is not None:
            write_raw(raw, raw_path(data_dir, day, src))

    order = {s["name"]: i for i, s in enumerate(config.SOURCES)}
    results = sorted(kept + [r for _, r, _ in outcomes], key=lambda r: order.get(r["name"], len(order)))
    log = {"run_time": run_time, "date": day, "sources": results}
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    return log


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, default=config.DATA_DIR)
    ap.add_argument("--only", help="comma-separated source names; replaces only their files for the day")
    args = ap.parse_args(argv)
    sources = config.SOURCES
    if args.only:
        wanted = set(args.only.split(","))
        sources = [s for s in sources if s["name"] in wanted]
    log = run(args.data_dir, sources, whole_day=not args.only)
    ok = sum(r["ok"] for r in log["sources"])
    print(f"{log['run_time']}: {ok}/{len(log['sources'])} sources ok")
    for r in log["sources"]:
        mark = "ok  " if r["ok"] else "FAIL"
        print(f"  {mark} {r['name']:14} {r['count']:5} items  {r['bytes']:>9,} bytes  "
              f"{r['seconds']:5}s  {r['error']}")
    return 0  # failed sources are recorded, not fatal


if __name__ == "__main__":
    sys.exit(main())

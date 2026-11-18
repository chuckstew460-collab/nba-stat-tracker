"""Pipeline step 4: open the day's GitHub Issue and close the previous one.

    python -m tracker.issue             # needs GITHUB_TOKEN and GITHUB_REPOSITORY
    python -m tracker.issue --dry-run   # print the issue instead

The issue is titled with the run date (YYYY-MM-DD). It lists the 15 biggest
moves under the move rule (moves.py) with the old and new points per game,
every item that appeared or disappeared, the status of each source, and the
current leader in each category. It is opened every day, even with no
changes. A second run on the same date edits that date's issue instead of
opening another. Every other open daily issue is closed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

from . import config
from .build import read_history
from .moves import LEADER_STATS, MOVE_LIMIT, MOVE_MIN_GAMES, compare, leaders, moves

LABEL = "daily-report"
API = "https://api.github.com"
BODY_LIMIT = 60000  # GitHub rejects issue bodies over 65,536 characters
LIST_CAP = 60       # appeared / gone items listed by name before "...and N more"


def _md(text: str) -> str:
    return str(text).replace("\\", "\\\\").replace("|", "\\|").replace("[", "\\[").replace("]", "\\]")


def _num(x) -> str:
    return "–" if x is None else f"{x:.1f}"


def _signed(x: float) -> str:
    return f"+{x:.1f}" if x > 0 else f"−{abs(x):.1f}"


def _who(r: dict) -> str:
    team = f" ({r['team']})" if r.get("team") and r.get("kind") == "player" else ""
    return f"{_md(r['item'])}{team}"


def _items(heading: str, items: list[dict]) -> list[str]:
    out = [f"## {heading} ({len(items)})", ""]
    if not items:
        return out + ["_None._", ""]
    out += [f"- {_who(r)} · `{r['item_id']}`" for r in items[:LIST_CAP]]
    if len(items) > LIST_CAP:
        out.append(f"- …and {len(items) - LIST_CAP} more on the site")
    return out + [""]


def render(status: dict, rows: list[dict], site_url: str) -> str:
    day = status["run_date"]
    cmp = compare(rows, day)
    top = moves(cmp)
    today = [r for r in rows if r["date"] == day]
    ok = [s for s in status["sources"] if s["ok"]]
    prev = sorted({d for d in cmp["previous"].values() if d})

    out = [
        f"Run at **{status['run_time'].replace('T', ' ').replace('Z', ' UTC')}** · "
        f"{len(ok)}/{len(status['sources'])} sources ok · {status['items']} items · "
        f"+{status['new_today']} new · −{status['gone_today']} gone · "
        f"[Today]({site_url}) · [Browse]({site_url}browse.html) · [Trends]({site_url}trends.html)",
        "",
        "| Source | Format | Status | Items |",
        "|---|---|---|---:|",
    ]
    for s in status["sources"]:
        state = "ok" if s["ok"] else f"**failed**: {_md(s['error'])}"
        out.append(f"| {s['name']} | {s.get('format', '')} | {state} | {s['count']} |")
    out.append("")

    out += [f"## Biggest moves in points per game ({len(top)})", ""]
    if not prev:
        out += ["_First run: there is no previous run to compare with._", ""]
    elif not top:
        out += [f"_No item with at least {MOVE_MIN_GAMES} games changed its points per game "
                f"since the previous run ({', '.join(prev)})._", ""]
    else:
        out += [f"Compared with the previous run ({', '.join(prev)}). Move = new points per game − "
                f"old points per game, items with at least {MOVE_MIN_GAMES} games, the "
                f"{MOVE_LIMIT} largest by size.", "",
                "| # | Item | Old PPG | New PPG | Move | Games |",
                "|---:|---|---:|---:|---:|---:|"]
        for i, m in enumerate(top, 1):
            out.append(f"| {i} | {_who(m)} | {_num(m['old'])} | {_num(m['new'])} | "
                       f"**{_signed(m['change'])}** | {m['old_games']} → {m['new_games']} |")
        out.append("")

    out += _items("Appeared", cmp["appeared"])
    out += _items("Disappeared", cmp["gone"])

    out += ["## League leaders", "",
            "Qualified players only (NBA minimums, prorated to games played so far).", "",
            "| Category | Leader | Value |", "|---|---|---:|"]
    for stat, label in LEADER_STATS:
        best = leaders(today, stat, 1)
        if best:
            out.append(f"| {label} | {_who(best[0])} | {_num(best[0][stat])} |")
        else:
            out.append(f"| {label} | – | – |")
    body = "\n".join(out).rstrip() + "\n"
    return body[:BODY_LIMIT]


class GitHub:
    def __init__(self, repo: str, token: str, session: requests.Session | None = None):
        self.repo = repo
        self.s = session or requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}",
                               "Accept": "application/vnd.github+json",
                               "X-GitHub-Api-Version": "2022-11-28"})

    def req(self, method: str, path: str, **kw):
        r = self.s.request(method, f"{API}/repos/{self.repo}{path}", timeout=30, **kw)
        if r.status_code >= 400 and not (method == "POST" and path == "/labels" and r.status_code == 422):
            r.raise_for_status()
        return r.json() if r.content else None

    def publish(self, day: str, body: str) -> str:
        self.req("POST", "/labels", json={"name": LABEL, "color": "e8702a",
                                          "description": "Daily NBA stat tracker report"})
        issues = self.req("GET", "/issues", params={"labels": LABEL, "state": "all",
                                                    "per_page": 100, "sort": "created"})
        today = next((i for i in issues if i["title"] == day and "pull_request" not in i), None)
        if today:
            self.req("PATCH", f"/issues/{today['number']}", json={"body": body, "state": "open"})
            action, number = "updated", today["number"]
        else:
            made = self.req("POST", "/issues", json={"title": day, "body": body, "labels": [LABEL]})
            action, number = "opened", made["number"]
        for i in issues:
            if i["state"] == "open" and i["number"] != number:
                self.req("PATCH", f"/issues/{i['number']}",
                         json={"state": "closed", "state_reason": "completed"})
                print(f"closed issue #{i['number']} ({i['title']})")
        return f"{action} issue #{number} ({day})"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, default=config.DATA_DIR)
    ap.add_argument("--dry-run", action="store_true", help="print the issue body; touch nothing")
    args = ap.parse_args(argv)
    status = json.loads((args.data_dir / "status.json").read_text(encoding="utf-8"))
    rows = read_history(args.data_dir / "history.csv")
    body = render(status, rows, config.SITE_URL)
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if args.dry_run or not (token and repo):
        sys.stdout.reconfigure(encoding="utf-8")
        print(f"# {status['run_date']}\n\n{body}")
        return 0
    print(GitHub(repo, token).publish(status["run_date"], body))
    return 0


if __name__ == "__main__":
    sys.exit(main())

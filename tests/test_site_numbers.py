"""The site's numbers agree with the history file.

scripts/site_numbers.mjs runs the site's own assets/js/stats.js on a history
file and prints every number the Today and Trends pages compute. Each one is
recomputed here in Python, straight from history.csv, and compared. This runs
on a made-up history and on the real data/history.csv. Needs Node (GitHub's
runners have it); skipped without it.
"""
import json
import math
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from tracker import config
from tracker.build import build_history, read_history, write_history
from tracker.moves import LEADER_STATS, compare, leaders, moves

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def js_round1(x: float) -> float:
    """Math.round(x * 10) / 10, as the site rounds."""
    return math.floor(x * 10 + 0.5) / 10


def site_numbers(csv_path: Path) -> dict:
    out = subprocess.run([NODE, str(ROOT / "scripts" / "site_numbers.mjs"), str(csv_path)],
                         capture_output=True, text=True, check=True, encoding="utf-8")
    return json.loads(out.stdout)


def python_numbers(rows: list[dict]) -> dict:
    dates = sorted({r["date"] for r in rows})
    by_day = {d: [r for r in rows if r["date"] == d] for d in dates}
    out: dict = {"dates": dates, "rows": len(rows)}

    day = dates[-1] if dates else None
    if day:
        cmp = compare(rows, day)
        out["today"] = {
            "previous": cmp["previous"],
            "appeared": [r["item_id"] for r in cmp["appeared"]],
            "gone": [r["item_id"] for r in cmp["gone"]],
            "moves": [[m["item_id"], m["old"], m["new"], m["change"]] for m in moves(cmp)],
            "leaders": {s: [[r["item_id"], r[s]] for r in leaders(by_day[day], s, 5)] for s, _ in LEADER_STATS},
        }

    # 1. scoring race
    per_day = []
    for d in dates:
        top = leaders(by_day[d], "points", 1)
        if top:
            per_day.append([d, top[0]["item_id"], top[0]["points"]])
    last_id = per_day[-1][1] if per_day else None
    latest = by_day[per_day[-1][0]] if per_day else []
    out["race"] = {"perDay": per_day, "daysLed": sum(p[1] == last_id for p in per_day),
                   "top5": [r["item_id"] for r in leaders(latest, "points", 5)]}

    # 2. risers and fallers, first date vs latest date
    if len(dates) >= 2:
        first, last = dates[0], dates[-1]
        old = {r["item_id"]: r for r in by_day[first] if r["kind"] == "player"}
        lst = []
        for r in by_day[last]:
            o = old.get(r["item_id"])
            if r["kind"] != "player" or not o or o["points"] is None or r["points"] is None:
                continue
            if (o["games"] or 0) < 5 or (r["games"] or 0) < 5:
                continue
            lst.append([r["item_id"], o["points"], r["points"], round(r["points"] - o["points"], 1)])
        lst.sort(key=lambda m: (-m[3], m[0]))
        out["risers"] = {"first": first, "last": last, "list": lst}
    else:
        out["risers"] = {"first": dates[0] if dates else None, "last": dates[0] if dates else None, "list": []}

    # 3. largest move of each day
    daily, best, best_size = [], None, -1.0
    for d in dates[1:]:
        cmp = compare(rows, d)
        ms = [m for m in moves(cmp, limit=None) if m["kind"] == "player"]
        played = sum(1 for o, n in cmp["pairs"] if n["kind"] == "player" and (n["games"] or 0) > (o["games"] or 0))
        top = ms[0] if ms else None
        daily.append([d, top and top["item_id"], top and top["change"], len(ms), played])
        if top and abs(top["change"]) > best_size:
            best, best_size = d, abs(top["change"])
    out["daily"] = {"perDay": daily, "best": best}

    # 4. league shooting from team rows
    shooting = []
    for d in dates:
        teams = [r for r in by_day[d] if r["kind"] == "team"]
        if not teams:
            continue
        s = {k: sum(r[k] or 0 for r in teams) for k in ("fg3m", "fg3a", "fgm", "fga", "games")}
        shooting.append([d, len(teams), s["fg3m"], s["fg3a"],
                         js_round1(100 * s["fg3m"] / s["fg3a"]) if s["fg3a"] else None,
                         js_round1(100 * s["fgm"] / s["fga"]) if s["fga"] else None,
                         js_round1(s["fg3a"] / s["games"]) if s["games"] else None, s["games"]])
    out["shooting"] = shooting

    # 5. team scoring on the latest date with team rows
    team_dates = sorted({r["date"] for r in rows if r["kind"] == "team"})
    if team_dates:
        f, l = team_dates[0], team_dates[-1]
        first_pts = {r["item_id"]: r["points"] for r in by_day[f] if r["kind"] == "team"}
        lst = sorted((r for r in by_day[l] if r["kind"] == "team" and r["points"] is not None),
                     key=lambda r: (-r["points"], r["item_id"]))
        out["teams"] = {"date": l, "list": [[r["item_id"], r["points"], first_pts.get(r["item_id"])] for r in lst]}
    else:
        out["teams"] = {"date": None, "list": []}
    return out


def assert_same(csv_path: Path):
    js = site_numbers(csv_path)
    py = json.loads(json.dumps(python_numbers(read_history(csv_path))))  # same number types as JSON
    assert js.keys() == py.keys()
    for key in py:
        assert js[key] == py[key], key


def made_up_history(put):
    random.seed(4)
    teams = ["ATL", "BOS", "LAL", "NY"]
    players = [{"id": i, "name": f"Player {i}", "team": teams[i % 4], "pos": "GFC"[i % 3]} for i in range(1, 41)]
    days = ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]
    for n, day in enumerate(days):
        ps = []
        for p in players:
            if p["id"] > 36 and n < 2:   # four players appear on day 3
                continue
            if p["id"] == 5 and n >= 3:  # one disappears
                continue
            g = 8 + n + (p["id"] % 3 == 0) * -2
            ps.append({**p, "games": g, "points": round(random.uniform(4, 32), 1),
                       "rebounds": round(random.uniform(1, 13), 1), "assists": round(random.uniform(0.5, 10), 1),
                       "steals": round(random.uniform(0, 2.5), 1), "blocks": round(random.uniform(0, 3), 1),
                       "fgm": random.randint(10, 120), "fg3m": random.randint(0, 40), "ftm": random.randint(0, 60),
                       "fg_pct": round(random.uniform(35, 65), 1), "fg3_pct": round(random.uniform(25, 45), 1),
                       "ft_pct": round(random.uniform(60, 95), 1)})
        ts = None if n == 2 else [  # the team source fails on day 3
            {"abbr": t, "name": f"Team {t}", "games": 9 + n, "points": round(random.uniform(105, 122), 1),
             "fg3m": 100 + 13 * n + i, "fg3a": 300 + 37 * n + 3 * i, "fgm": 380 + 40 * n, "fga": 840 + 88 * n}
            for i, t in enumerate(teams)]
        put(day, players=ps, teams=ts)


def test_site_numbers_match_python_on_a_made_up_history(put, data_dir):
    made_up_history(put)
    csv_path = data_dir / "history.csv"
    write_history(build_history(data_dir / "raw"), csv_path)
    assert_same(csv_path)
    numbers = site_numbers(csv_path)
    assert len(numbers["dates"]) == 5 and numbers["today"]["appeared"] == []
    assert numbers["today"]["gone"] == []           # player-5 left on day 4, not today
    assert numbers["daily"]["best"] is not None and len(numbers["shooting"]) == 4


@pytest.mark.skipif(not (config.DATA_DIR / "history.csv").exists(), reason="no history yet")
def test_site_numbers_match_python_on_the_real_history():
    assert_same(config.DATA_DIR / "history.csv")

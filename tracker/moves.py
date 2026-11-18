"""What changed since the previous run: new and gone items, the move rule,
and the league leaders. Used by status.py and issue.py; the site does the same
calculations in assets/js/stats.js.

Previous run. For each source with rows on a date, its previous run is the
latest earlier date on which that source has rows. Items are compared only
within their own source, so a source that failed yesterday is compared with
the last day it worked, and a source that failed today makes nothing "gone".

Move rule. An item's move is its points per game now minus its points per
game at the previous run, rounded to 0.1. Items with fewer than 5 games
played now are left out (one game swings a short average too much), and so
are moves of 0. Moves are ranked by size (absolute value), largest first,
ties broken by item_id; the daily issue lists the top 15.

Leaders. Per-game leaders must have played in at least 70% of their team's
games (the NBA's 58-of-82 rule). Shooting leaders must have the NBA's season
minimum of makes, prorated to their team's games so far: 300 field goals,
82 threes, 125 free throws per 82 games. A team's games come from its
espn_teams row, or, on a day without one, the most games any of its players
has played.
"""
from __future__ import annotations

from collections import defaultdict

MOVE_STAT = "points"
MOVE_MIN_GAMES = 5
MOVE_LIMIT = 15

SEASON_GAMES = 82
PER_GAME_SHARE = 0.70
PCT_MINIMUMS = {"fg_pct": ("fgm", 300), "fg3_pct": ("fg3m", 82), "ft_pct": ("ftm", 125)}
LEADER_STATS = [
    ("points", "Points per game"),
    ("rebounds", "Rebounds per game"),
    ("assists", "Assists per game"),
    ("steals", "Steals per game"),
    ("blocks", "Blocks per game"),
    ("fg_pct", "Field goal %"),
    ("fg3_pct", "3-point %"),
    ("ft_pct", "Free throw %"),
]


def by_date(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        out[r["date"]].append(r)
    return out


def latest_date(rows: list[dict]) -> str | None:
    return max((r["date"] for r in rows), default=None)


def previous_dates(rows: list[dict], day: str) -> dict[str, str | None]:
    """{source: its previous run date or None} for every source with rows on `day`."""
    today = {r["source"] for r in rows if r["date"] == day}
    prev: dict[str, str | None] = {s: None for s in today}
    for r in rows:
        s = r["source"]
        if s in prev and r["date"] < day and (prev[s] is None or r["date"] > prev[s]):
            prev[s] = r["date"]
    return prev


def compare(rows: list[dict], day: str) -> dict:
    """Pairs (old, new) of items in both runs, plus the items that appeared
    and disappeared, each source against its own previous run."""
    prev = previous_dates(rows, day)
    now = {r["item_id"]: r for r in rows if r["date"] == day}
    before = {r["item_id"]: r for r in rows if prev.get(r["source"]) == r["date"]}
    had_previous = {s for s, d in prev.items() if d}
    pairs = [(before[i], now[i]) for i in sorted(now) if i in before]
    appeared = [now[i] for i in sorted(now) if i not in before and now[i]["source"] in had_previous]
    gone = [before[i] for i in sorted(before) if i not in now]
    return {"day": day, "previous": prev, "pairs": pairs, "appeared": appeared, "gone": gone}


def moves(cmp: dict, stat: str = MOVE_STAT, min_games: int = MOVE_MIN_GAMES,
          limit: int | None = MOVE_LIMIT) -> list[dict]:
    out = []
    for old, new in cmp["pairs"]:
        if (new["games"] or 0) < min_games:
            continue
        a, b = old.get(stat), new.get(stat)
        if a is None or b is None:
            continue
        change = round(b - a, 1)
        if change == 0:
            continue
        out.append({"item_id": new["item_id"], "item": new["item"], "kind": new["kind"],
                    "team": new["team"], "source": new["source"],
                    "old": a, "new": b, "change": change,
                    "old_date": old["date"], "old_games": old["games"], "new_games": new["games"]})
    out.sort(key=lambda m: (-abs(m["change"]), m["item_id"]))
    return out[:limit] if limit else out


def team_games(day_rows: list[dict]) -> dict[str, int]:
    games: dict[str, int] = {}
    for r in day_rows:
        if r["kind"] == "team" and r["games"] is not None:
            games[r["team"]] = r["games"]
    fallback: dict[str, int] = {}
    for r in day_rows:
        if r["kind"] == "player" and r["team"] and r["games"] is not None:
            fallback[r["team"]] = max(fallback.get(r["team"], 0), r["games"])
    for team, g in fallback.items():
        games.setdefault(team, g)
    return games


def qualifies(row: dict, stat: str, tgames: dict[str, int]) -> bool:
    g = tgames.get(row["team"]) or row["games"] or 0
    if stat in PCT_MINIMUMS:
        col, season_total = PCT_MINIMUMS[stat]
        return (row[col] or 0) >= season_total / SEASON_GAMES * g
    return (row["games"] or 0) >= PER_GAME_SHARE * g


def leaders(day_rows: list[dict], stat: str, n: int = 5) -> list[dict]:
    """The top n qualified players in `stat` on one day."""
    tg = team_games(day_rows)
    pool = [r for r in day_rows
            if r["kind"] == "player" and r.get(stat) is not None and qualifies(r, stat, tg)]
    pool.sort(key=lambda r: (-r[stat], r["item_id"]))
    return pool[:n]

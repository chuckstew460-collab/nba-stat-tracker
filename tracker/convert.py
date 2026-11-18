"""Convert one raw file into rows with the common columns.

    rows = convert("espn_players", raw_bytes, "2026-11-18")

Every source has one converter, keyed by source name. A converter takes the
bytes exactly as the source sent them and returns one row per item for that
day, each a dict with every column in COLUMNS (None for a value the source
does not report).

ESPN's stats API sends each item's numbers as unnamed lists; the names of the
list positions are given once, at the top of the answer, per category
("general", "offensive", "defensive"). The converters look every value up by
its ESPN name, never by position, so a reordered answer still converts right.
"""
from __future__ import annotations

import json

# history.csv columns. The first four are fixed by the assignment.
COLUMNS = [
    "date", "item_id", "item", "source",
    "kind", "team", "position",
    "games", "minutes",
    "points", "rebounds", "assists", "steals", "blocks", "turnovers",
    "fg_pct", "fg3_pct", "ft_pct",
    "fgm", "fga", "fg3m", "fg3a", "ftm", "fta",
    "double_doubles", "triple_doubles",
]

# Columns written with one decimal (per-game averages and percentages); the
# other numeric columns are whole counts.
DECIMAL = {"minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers",
           "fg_pct", "fg3_pct", "ft_pct"}
COUNTS = {"games", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "double_doubles", "triple_doubles"}
NUMERIC = [c for c in COLUMNS if c in DECIMAL or c in COUNTS]

# A shooting percentage is left empty when the item has no attempts of that
# kind (ESPN reports 0.0, which would read as "missed every shot").
PCT_ATTEMPTS = {"fg_pct": "fga", "fg3_pct": "fg3a", "ft_pct": "fta"}

# (ESPN category, ESPN stat name) -> our column, for each source.
PLAYER_FIELDS = {
    ("general", "gamesPlayed"): "games",
    ("general", "avgMinutes"): "minutes",
    ("general", "avgRebounds"): "rebounds",
    ("general", "doubleDouble"): "double_doubles",
    ("general", "tripleDouble"): "triple_doubles",
    ("offensive", "avgPoints"): "points",
    ("offensive", "avgAssists"): "assists",
    ("offensive", "avgTurnovers"): "turnovers",
    ("offensive", "fieldGoalPct"): "fg_pct",
    ("offensive", "threePointFieldGoalPct"): "fg3_pct",
    ("offensive", "freeThrowPct"): "ft_pct",
    ("offensive", "fieldGoalsMade"): "fgm",
    ("offensive", "fieldGoalsAttempted"): "fga",
    ("offensive", "threePointFieldGoalsMade"): "fg3m",
    ("offensive", "threePointFieldGoalsAttempted"): "fg3a",
    ("offensive", "freeThrowsMade"): "ftm",
    ("offensive", "freeThrowsAttempted"): "fta",
    ("defensive", "avgSteals"): "steals",
    ("defensive", "avgBlocks"): "blocks",
}
TEAM_FIELDS = {
    ("general", "gamesPlayed"): "games",
    ("general", "avgRebounds"): "rebounds",
    ("offensive", "avgPoints"): "points",
    ("offensive", "avgAssists"): "assists",
    ("offensive", "avgTurnovers"): "turnovers",
    ("offensive", "fieldGoalPct"): "fg_pct",
    ("offensive", "threePointFieldGoalPct"): "fg3_pct",
    ("offensive", "freeThrowPct"): "ft_pct",
    ("offensive", "fieldGoalsMade"): "fgm",
    ("offensive", "fieldGoalsAttempted"): "fga",
    ("offensive", "threePointFieldGoalsMade"): "fg3m",
    ("offensive", "threePointFieldGoalsAttempted"): "fg3a",
    ("offensive", "freeThrowsMade"): "ftm",
    ("offensive", "freeThrowsAttempted"): "fta",
    ("defensive", "avgSteals"): "steals",
    ("defensive", "avgBlocks"): "blocks",
}


class ConvertError(ValueError):
    """The raw file is not the shape this source's converter expects."""


def _load(raw: bytes) -> dict:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConvertError(f"not JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("categories"), list):
        raise ConvertError("answer has no 'categories' list")
    return data


def _positions(data: dict) -> dict[str, dict[str, int]]:
    """{category: {stat name: position}} from the answer's header. ESPN lists a
    category twice for teams (own, then opponent); the first, named one is used.
    A name that repeats within a category keeps its first position."""
    out: dict[str, dict[str, int]] = {}
    for cat in data["categories"]:
        names = cat.get("names")
        if not names or cat.get("name") in out:
            continue
        index: dict[str, int] = {}
        for i, name in enumerate(names):
            index.setdefault(name, i)
        out[cat["name"]] = index
    return out


def _own(categories: list[dict]) -> dict[str, list]:
    """{category: values} for an item, the item's own split (not its opponents')."""
    out: dict[str, list] = {}
    for cat in categories:
        name = cat.get("name")
        if name in out:
            continue  # the second "general"/"offensive"/... is the opponents' split
        label = str(cat.get("displayName", ""))
        if label and not label.startswith("Own"):
            continue
        out[name] = cat.get("values") or []
    return out


def _number(value, column: str):
    if value is None or value == "":
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    if column in COUNTS:
        return int(round(x))
    return round(x, 1)


def _stats(item_categories: list[dict], positions: dict, fields: dict) -> dict:
    own = _own(item_categories)
    out = {}
    for (cat, stat), column in fields.items():
        i = positions.get(cat, {}).get(stat)
        values = own.get(cat)
        out[column] = _number(values[i], column) if values is not None and i is not None and i < len(values) else None
    for pct, attempts in PCT_ATTEMPTS.items():
        if not out.get(attempts):
            out[pct] = None
    return out


def _row(date: str, source: str, **values) -> dict:
    row = {c: None for c in COLUMNS}
    row.update(date=date, source=source)
    row.update(values)
    return row


def espn_players(raw: bytes, date: str, source: str = "espn_players") -> list[dict]:
    data = _load(raw)
    athletes = data.get("athletes")
    if not isinstance(athletes, list):
        raise ConvertError("answer has no 'athletes' list")
    pages = (data.get("pagination") or {}).get("pages", 1)
    if pages and pages > 1:
        raise ConvertError(f"answer is page 1 of {pages}; raise the limit")
    positions = _positions(data)
    rows = []
    for entry in athletes:
        a = entry.get("athlete") or {}
        if not a.get("id"):
            continue
        rows.append(_row(
            date, source,
            item_id=f"player-{a['id']}",
            item=a.get("displayName") or a.get("shortName") or "",
            kind="player",
            team=a.get("teamShortName") or "",
            position=(a.get("position") or {}).get("abbreviation") or "",
            **_stats(entry.get("categories") or [], positions, PLAYER_FIELDS)))
    return rows


def espn_teams(raw: bytes, date: str, source: str = "espn_teams") -> list[dict]:
    data = _load(raw)
    teams = data.get("teams")
    if not isinstance(teams, list):
        raise ConvertError("answer has no 'teams' list")
    positions = _positions(data)
    rows = []
    for entry in teams:
        t = entry.get("team") or {}
        abbr = t.get("abbreviation")
        if not abbr:
            continue
        rows.append(_row(
            date, source,
            item_id=f"team-{abbr}",
            item=t.get("displayName") or abbr,
            kind="team",
            team=abbr,
            position="",
            **_stats(entry.get("categories") or [], positions, TEAM_FIELDS)))
    return rows


CONVERTERS = {
    "espn_players": espn_players,
    "espn_teams": espn_teams,
}


def convert(source: str, raw: bytes, date: str) -> list[dict]:
    """Rows for one source's raw file on one date."""
    try:
        fn = CONVERTERS[source]
    except KeyError:
        raise ConvertError(f"no converter for source {source!r}") from None
    return fn(raw, date, source)

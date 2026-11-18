"""Helpers that write small ESPN-shaped raw files into a temp data folder.

The fixtures in tests/fixtures/ are trimmed real answers (see make_fixtures.py).
For history and move tests, players_raw()/teams_raw() build answers with the
same header as those fixtures but with made-up items and numbers.
"""
import json
from pathlib import Path

import pytest

from tracker.convert import PLAYER_FIELDS, TEAM_FIELDS
from tracker.fetch import write_raw

FIX = Path(__file__).parent / "fixtures"

PLAYER_DEFAULTS = {"games": 10, "minutes": 30.0, "points": 10.0, "rebounds": 5.0, "assists": 3.0,
                   "steals": 1.0, "blocks": 0.5, "turnovers": 2.0, "fg_pct": 45.0, "fg3_pct": 35.0,
                   "ft_pct": 80.0, "fgm": 40, "fga": 90, "fg3m": 10, "fg3a": 30, "ftm": 20, "fta": 25,
                   "double_doubles": 0, "triple_doubles": 0}
TEAM_DEFAULTS = {**PLAYER_DEFAULTS, "games": 10, "points": 110.0, "fgm": 400, "fga": 880,
                 "fg3m": 130, "fg3a": 370, "ftm": 180, "fta": 230}


def fixture_bytes(source: str) -> bytes:
    return (FIX / f"{source}.json").read_bytes()


def _values(header_cat: dict, fields: dict, item: dict, defaults: dict) -> list:
    out = []
    for name in header_cat["names"]:
        col = fields.get((header_cat["name"], name))
        out.append(float(item.get(col, defaults[col])) if col else 0.0)
    return out


def players_raw(players: list[dict]) -> bytes:
    """players: dicts with id, name and any stat columns (others take defaults)."""
    data = json.loads(fixture_bytes("espn_players"))
    header = [c for c in data["categories"] if c.get("names")]
    data["athletes"] = [{
        "athlete": {"id": str(p["id"]), "displayName": p["name"],
                    "teamShortName": p.get("team", "LAL"),
                    "position": {"abbreviation": p.get("pos", "G")}},
        "categories": [{"name": c["name"], "displayName": f"Own {c['name'].title()}",
                        "values": _values(c, PLAYER_FIELDS, p, PLAYER_DEFAULTS)} for c in header],
    } for p in players]
    data["pagination"] = {"count": len(players), "limit": 1000, "page": 1, "pages": 1}
    return json.dumps(data).encode()


def teams_raw(teams: list[dict]) -> bytes:
    """teams: dicts with abbr, name and any stat columns. Each team also gets an
    opponents' split full of 999s, which the converter must ignore."""
    data = json.loads(fixture_bytes("espn_teams"))
    header = [c for c in data["categories"] if c.get("names")]
    out = []
    for t in teams:
        cats = []
        for c in header:
            cats.append({"name": c["name"], "displayName": f"Own {c['name'].title()}", "splitId": "0",
                         "values": _values(c, TEAM_FIELDS, t, TEAM_DEFAULTS)})
            cats.append({"name": c["name"], "displayName": f"Opponent {c['name'].title()}",
                         "splitId": "900", "values": [999.0] * len(c["names"])})
        out.append({"team": {"id": t["abbr"], "abbreviation": t["abbr"],
                             "displayName": t.get("name", t["abbr"])}, "categories": cats})
    data["teams"] = out
    return json.dumps(data).encode()


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    (d / "raw").mkdir(parents=True)
    return d


@pytest.fixture
def put(data_dir):
    """put(day, players=[...], teams=[...]) writes that day's raw files.
    Leave one out (None) to simulate that source failing that day."""
    def _put(day, players=None, teams=None):
        if players is not None:
            write_raw(players_raw(players), data_dir / "raw" / day / "espn_players.json.gz")
        if teams is not None:
            write_raw(teams_raw(teams), data_dir / "raw" / day / "espn_teams.json.gz")
    return _put


@pytest.fixture
def log(data_dir):
    """log(day, [(name, ok, count), ...]) writes the run log fetch.py would write."""
    def _log(day, results, run_time=None):
        entries = [{"name": n, "format": "json", "url": "https://example.com", "ok": ok,
                    "count": count, "bytes": 1, "error": "" if ok else "HTTPError: 503",
                    "seconds": 0.1} for n, ok, count in results]
        path = data_dir / "runs" / f"{day}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"run_time": run_time or f"{day}T11:30:00Z", "date": day,
                                    "sources": entries}), encoding="utf-8")
    return _log

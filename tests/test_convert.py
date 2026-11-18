"""Each source converts to the common columns."""
import json

import pytest

from tracker.convert import COLUMNS, ConvertError, convert
from conftest import fixture_bytes, players_raw, teams_raw

DAY = "2026-11-18"


def by_id(rows):
    return {r["item_id"]: r for r in rows}


def test_every_row_has_exactly_the_common_columns():
    for source in ("espn_players", "espn_teams"):
        rows = convert(source, fixture_bytes(source), DAY)
        assert rows
        for r in rows:
            assert list(r) == COLUMNS
            assert r["date"] == DAY and r["source"] == source


def test_first_four_columns_are_fixed():
    assert COLUMNS[:4] == ["date", "item_id", "item", "source"]


def test_espn_players_values():
    rows = by_id(convert("espn_players", fixture_bytes("espn_players"), DAY))
    assert set(rows) == {"player-3945274", "player-4278073", "player-4433136"}
    luka = rows["player-3945274"]
    assert luka["item"] == "Luka Doncic"
    assert (luka["kind"], luka["team"], luka["position"]) == ("player", "LAL", "G")
    assert luka["games"] == 12 and luka["minutes"] == 35.9
    assert (luka["points"], luka["rebounds"], luka["assists"]) == (39.0, 7.2, 7.8)
    assert (luka["steals"], luka["blocks"], luka["turnovers"]) == (1.9, 0.7, 4.8)
    assert (luka["fg_pct"], luka["fg3_pct"], luka["ft_pct"]) == (48.6, 40.6, 86.5)
    assert (luka["fgm"], luka["fga"], luka["fg3m"], luka["fg3a"], luka["ftm"], luka["fta"]) == \
        (144, 296, 65, 160, 115, 133)
    assert (luka["double_doubles"], luka["triple_doubles"]) == (4, 0)
    assert isinstance(luka["games"], int) and isinstance(luka["fgm"], int)


def test_percentage_is_empty_without_attempts():
    kessler = by_id(convert("espn_players", fixture_bytes("espn_players"), DAY))["player-4433136"]
    assert kessler["fg3a"] == 0
    assert kessler["fg3_pct"] is None  # ESPN says 0.0; no attempts means no percentage
    assert kessler["fg_pct"] == 68.0


def test_espn_teams_values_use_the_teams_own_split():
    rows = by_id(convert("espn_teams", fixture_bytes("espn_teams"), DAY))
    assert set(rows) == {"team-LAL", "team-OKC", "team-UTAH"}
    lal = rows["team-LAL"]
    assert (lal["item"], lal["kind"], lal["team"], lal["position"]) == ("Los Angeles Lakers", "team", "LAL", "")
    assert lal["games"] == 14
    assert lal["points"] == 122.8  # own; the opponents' split says 114.9
    assert (lal["rebounds"], lal["assists"], lal["steals"], lal["blocks"]) == (40.8, 24.7, 11.0, 6.4)
    assert (lal["fg_pct"], lal["fg3_pct"], lal["ft_pct"]) == (50.3, 38.3, 80.4)
    assert (lal["fgm"], lal["fga"], lal["fg3m"], lal["fg3a"]) == (590, 1173, 199, 519)
    # not reported for teams: left empty
    assert lal["minutes"] is None and lal["double_doubles"] is None and lal["triple_doubles"] is None


def test_built_teams_ignore_the_opponents_split():
    rows = convert("espn_teams", teams_raw([{"abbr": "BOS", "points": 117.3}]), DAY)
    assert rows[0]["points"] == 117.3
    assert all(v != 999 for v in rows[0].values())


def test_values_are_found_by_name_not_position():
    data = json.loads(fixture_bytes("espn_players"))
    for cat in data["categories"]:
        cat["names"] = cat["names"][::-1]
    for a in data["athletes"]:
        for c in a["categories"]:
            c["values"] = c["values"][::-1]
    reordered = convert("espn_players", json.dumps(data).encode(), DAY)
    assert reordered == convert("espn_players", fixture_bytes("espn_players"), DAY)


def test_rounding_and_counts():
    rows = convert("espn_players", players_raw([{"id": 1, "name": "A", "points": 24.666666,
                                                  "fgm": 41.0, "fg_pct": 48.64899}]), DAY)
    assert rows[0]["points"] == 24.7 and rows[0]["fg_pct"] == 48.6
    assert rows[0]["fgm"] == 41 and isinstance(rows[0]["fgm"], int)


@pytest.mark.parametrize("raw", [b"<!doctype html><html>blocked</html>", b"{}", b'{"categories": []}', b"\xff\xfe"])
def test_unusable_answers_raise(raw):
    with pytest.raises(ConvertError):
        convert("espn_players", raw, DAY)
    with pytest.raises(ConvertError):
        convert("espn_teams", raw, DAY)


def test_a_second_page_is_refused():
    data = json.loads(fixture_bytes("espn_players"))
    data["pagination"]["pages"] = 2
    with pytest.raises(ConvertError, match="page 1 of 2"):
        convert("espn_players", json.dumps(data).encode(), DAY)


def test_unknown_source_raises():
    with pytest.raises(ConvertError):
        convert("nope", fixture_bytes("espn_players"), DAY)

"""The history build: one row per item per day, from the raw files alone, and reruns."""
import gzip
import json
from datetime import datetime, timezone

import tracker.convert as convert_mod
from tracker import fetch
from tracker.build import build_history, read_history, write_history
from tracker.convert import COLUMNS
from conftest import players_raw, teams_raw

D1, D2, D3 = "2026-11-18", "2026-11-19", "2026-11-20"


def P(i, points=10.0, **kw):
    return {"id": i, "name": f"Player {i}", "points": points, **kw}


def test_one_row_per_item_per_day_sorted_by_date_then_item_id(put, data_dir):
    put(D2, players=[P(30), P(4)], teams=[{"abbr": "BOS"}])
    put(D1, players=[P(4), P(30), P(100)], teams=[{"abbr": "BOS"}, {"abbr": "ATL"}])
    h = build_history(data_dir / "raw")
    keys = [(r["date"], r["item_id"]) for r in h]
    assert keys == [
        (D1, "player-100"), (D1, "player-30"), (D1, "player-4"), (D1, "team-ATL"), (D1, "team-BOS"),
        (D2, "player-30"), (D2, "player-4"), (D2, "team-BOS"),
    ]
    assert len(keys) == len(set(keys))


def test_a_day_without_a_sources_raw_file_has_no_rows_from_it(put, data_dir):
    put(D1, players=[P(1)], teams=[{"abbr": "BOS"}])
    put(D2, players=[P(1)])  # teams failed on D2
    h = build_history(data_dir / "raw")
    assert [(r["date"], r["source"]) for r in h] == [
        (D1, "espn_players"), (D1, "espn_teams"), (D2, "espn_players")]


def test_a_repeated_item_keeps_its_first_listing(data_dir):
    raw = players_raw([P(1, 20.0), P(1, 5.0)])
    fetch.write_raw(raw, data_dir / "raw" / D1 / "espn_players.json.gz")
    h = build_history(data_dir / "raw")
    assert len(h) == 1 and h[0]["points"] == 20.0


def test_empty_values_are_written_as_empty_cells(put, data_dir, tmp_path):
    put(D1, teams=[{"abbr": "BOS"}])
    out = tmp_path / "history.csv"
    write_history(build_history(data_dir / "raw"), out)
    header, line = out.read_text(encoding="utf-8").splitlines()
    assert header.split(",") == COLUMNS
    cells = dict(zip(COLUMNS, line.split(",")))
    assert cells["minutes"] == "" and cells["double_doubles"] == "" and cells["position"] == ""
    assert cells["points"] == "110.0" and cells["games"] == "10"


def test_rebuilding_gives_the_same_file_byte_for_byte(put, data_dir, tmp_path):
    put(D1, players=[P(1), P(2, 7.25)], teams=[{"abbr": "BOS"}])
    put(D2, players=[P(1, 11.0)], teams=[{"abbr": "BOS"}])
    a, b = tmp_path / "a.csv", tmp_path / "b.csv"
    write_history(build_history(data_dir / "raw"), a)
    write_history(build_history(data_dir / "raw"), b)
    assert a.read_bytes() == b.read_bytes()
    assert b"\r\n" not in a.read_bytes()
    back = read_history(a)
    assert [(r["date"], r["item_id"], r["points"]) for r in back] == \
        [(r["date"], r["item_id"], r["points"]) for r in build_history(data_dir / "raw")]


def test_a_rule_change_reaches_every_day(put, data_dir, monkeypatch):
    put(D1, players=[P(1)])
    put(D2, players=[P(1)])
    original = convert_mod.CONVERTERS["espn_players"]

    def shouting(raw, date, source="espn_players"):
        return [dict(r, item=r["item"].upper()) for r in original(raw, date, source)]

    monkeypatch.setitem(convert_mod.CONVERTERS, "espn_players", shouting)
    assert {r["item"] for r in build_history(data_dir / "raw")} == {"PLAYER 1"}


# ----------------------------------------------------------- a second run on the same day
SOURCES = [{"name": "espn_players", "format": "json", "url": "https://example.com/p"},
           {"name": "espn_teams", "format": "json", "url": "https://example.com/t"}]
TEAMS = [{"abbr": a} for a in ("ATL", "BOS", "LAL", "NY", "OKC", "SA", "GS", "MIA", "DEN", "PHX")]


def players(points):
    return [P(i, points) for i in range(1, 13)]


def run_at(data_dir, when, answers):
    def get(src):
        a = answers[src["name"]]
        if isinstance(a, Exception):
            raise a
        return a
    return fetch.run(data_dir, SOURCES, now=when, get=get)


def test_a_second_run_on_the_same_day_replaces_that_day(data_dir):
    morning = datetime(2026, 11, 18, 11, 30, tzinfo=timezone.utc)
    evening = datetime(2026, 11, 18, 17, 30, tzinfo=timezone.utc)
    run_at(data_dir, morning, {"espn_players": players_raw(players(10.0)), "espn_teams": teams_raw(TEAMS)})
    run_at(data_dir, evening, {"espn_players": players_raw(players(12.0)), "espn_teams": teams_raw(TEAMS)})

    day_dir = data_dir / "raw" / D1
    assert sorted(p.name for p in day_dir.iterdir()) == ["espn_players.json.gz", "espn_teams.json.gz"]
    h = build_history(data_dir / "raw")
    assert len(h) == 12 + 10                       # the day counts once
    assert {r["points"] for r in h if r["kind"] == "player"} == {12.0}  # the second run's values
    log = json.loads((data_dir / "runs" / f"{D1}.json").read_text())
    assert log["run_time"] == "2026-11-18T17:30:00Z"
    assert len(list((data_dir / "runs").iterdir())) == 1


def test_a_second_run_where_a_source_fails_leaves_no_stale_file(data_dir):
    morning = datetime(2026, 11, 18, 11, 30, tzinfo=timezone.utc)
    evening = datetime(2026, 11, 18, 17, 30, tzinfo=timezone.utc)
    run_at(data_dir, morning, {"espn_players": players_raw(players(10.0)), "espn_teams": teams_raw(TEAMS)})
    run_at(data_dir, evening, {"espn_players": players_raw(players(12.0)), "espn_teams": ConnectionError("down")})
    assert sorted(p.name for p in (data_dir / "raw" / D1).iterdir()) == ["espn_players.json.gz"]
    h = build_history(data_dir / "raw")
    assert {r["source"] for r in h} == {"espn_players"}


def test_runs_on_two_days_keep_both(data_dir):
    run_at(data_dir, datetime(2026, 11, 18, 11, tzinfo=timezone.utc),
           {"espn_players": players_raw(players(10.0)), "espn_teams": teams_raw(TEAMS)})
    run_at(data_dir, datetime(2026, 11, 19, 11, tzinfo=timezone.utc),
           {"espn_players": players_raw(players(11.0)), "espn_teams": teams_raw(TEAMS)})
    h = build_history(data_dir / "raw")
    assert sorted({r["date"] for r in h}) == [D1, D2]
    assert len(h) == 2 * 22
    # what is saved is exactly what the source sent
    saved = gzip.decompress((data_dir / "raw" / D2 / "espn_players.json.gz").read_bytes())
    assert saved == players_raw(players(11.0))

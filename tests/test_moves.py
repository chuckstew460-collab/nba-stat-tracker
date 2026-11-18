"""The move rule, new/gone items against each source's previous run, and leaders."""
from tracker.build import build_history
from tracker.moves import compare, leaders, moves, previous_dates, qualifies, team_games

D1, D2, D3 = "2026-11-18", "2026-11-19", "2026-11-20"


def P(i, points=10.0, games=10, **kw):
    return {"id": i, "name": f"Player {i}", "points": points, "games": games, **kw}


def rows(data_dir):
    return build_history(data_dir / "raw")


def test_moves_are_ranked_by_size_with_old_and_new_values(put, data_dir):
    put(D1, players=[P(1, 20.0), P(2, 15.0), P(3, 8.0), P(4, 12.0)])
    put(D2, players=[P(1, 21.5, 11), P(2, 12.0, 11), P(3, 8.0, 11), P(4, 12.4, 11)])
    top = moves(compare(rows(data_dir), D2))
    assert [m["item_id"] for m in top] == ["player-2", "player-1", "player-4"]
    m = top[0]
    assert (m["old"], m["new"], m["change"]) == (15.0, 12.0, -3.0)
    assert (m["old_games"], m["new_games"], m["old_date"]) == (10, 11, D1)
    assert top[1]["change"] == 1.5 and top[2]["change"] == 0.4


def test_zero_moves_are_left_out(put, data_dir):
    put(D1, players=[P(1, 20.0)])
    put(D2, players=[P(1, 20.0)])
    assert moves(compare(rows(data_dir), D2)) == []


def test_items_with_fewer_than_five_games_are_left_out(put, data_dir):
    put(D1, players=[P(1, 10.0, 3), P(2, 10.0, 4)])
    put(D2, players=[P(1, 30.0, 4), P(2, 11.0, 5)])
    assert [m["item_id"] for m in moves(compare(rows(data_dir), D2))] == ["player-2"]


def test_ties_are_broken_by_item_id_and_the_list_is_capped(put, data_dir):
    put(D1, players=[P(i, 10.0) for i in range(1, 21)])
    put(D2, players=[P(i, 12.0 if i % 2 else 8.0) for i in range(1, 21)])
    top = moves(compare(rows(data_dir), D2))
    assert len(top) == 15
    ids = [m["item_id"] for m in top]
    assert ids == sorted(ids)  # every move is 2.0 in size
    assert len(moves(compare(rows(data_dir), D2), limit=None)) == 20


def test_moves_work_for_any_stat(put, data_dir):
    put(D1, players=[P(1, rebounds=5.0), P(2, rebounds=9.0)])
    put(D2, players=[P(1, rebounds=7.5), P(2, rebounds=9.1)])
    top = moves(compare(rows(data_dir), D2), stat="rebounds")
    assert [(m["item_id"], m["change"]) for m in top] == [("player-1", 2.5), ("player-2", 0.1)]


def test_appeared_and_gone(put, data_dir):
    put(D1, players=[P(1), P(2)], teams=[{"abbr": "LAL"}])
    put(D2, players=[P(2), P(3)], teams=[{"abbr": "LAL"}])
    cmp = compare(rows(data_dir), D2)
    assert [r["item_id"] for r in cmp["appeared"]] == ["player-3"]
    assert [r["item_id"] for r in cmp["gone"]] == ["player-1"]
    assert [new["item_id"] for _, new in cmp["pairs"]] == ["player-2", "team-LAL"]


def test_first_run_has_nothing_new_or_gone(put, data_dir):
    put(D1, players=[P(1), P(2)])
    cmp = compare(rows(data_dir), D1)
    assert cmp["appeared"] == [] and cmp["gone"] == [] and cmp["pairs"] == []
    assert cmp["previous"] == {"espn_players": None}


def test_each_source_is_compared_with_its_own_previous_run(put, data_dir):
    put(D1, players=[P(1, 10.0)], teams=[{"abbr": "LAL", "points": 110.0}])
    put(D2, players=[P(1, 11.0)])                                     # teams failed on D2
    put(D3, players=[P(1, 12.0)], teams=[{"abbr": "LAL", "points": 113.0}])
    h = rows(data_dir)
    assert previous_dates(h, D3) == {"espn_players": D2, "espn_teams": D1}
    by_id = {m["item_id"]: m for m in moves(compare(h, D3))}
    assert (by_id["player-1"]["old"], by_id["player-1"]["old_date"]) == (11.0, D2)
    assert (by_id["team-LAL"]["old"], by_id["team-LAL"]["old_date"]) == (110.0, D1)
    assert compare(h, D3)["gone"] == []


def test_a_source_that_failed_today_makes_nothing_gone(put, data_dir):
    put(D1, players=[P(1)], teams=[{"abbr": "LAL"}, {"abbr": "BOS"}])
    put(D2, players=[P(1)])  # teams failed
    cmp = compare(rows(data_dir), D2)
    assert cmp["gone"] == [] and cmp["previous"] == {"espn_players": D1}


def test_per_game_leaders_need_70_percent_of_team_games(put, data_dir):
    put(D1, players=[P(1, 30.0, games=6, team="BOS"), P(2, 25.0, games=7, team="BOS"),
                     P(3, 20.0, games=10, team="BOS")],
        teams=[{"abbr": "BOS", "games": 10}])
    day = rows(data_dir)
    assert [r["item_id"] for r in leaders(day, "points")] == ["player-2", "player-3"]


def test_shooting_leaders_need_the_prorated_minimum_of_makes(put, data_dir):
    # 41 team games: minimums are 150 FGM, 41 3PM, 62.5 FTM
    put(D1, players=[P(1, fg_pct=70.0, fgm=149, fg3_pct=50.0, fg3m=40, ft_pct=99.0, ftm=62, games=41),
                     P(2, fg_pct=60.0, fgm=150, fg3_pct=45.0, fg3m=41, ft_pct=90.0, ftm=63, games=41)],
        teams=[{"abbr": "LAL", "games": 41}])
    day = rows(data_dir)
    for stat in ("fg_pct", "fg3_pct", "ft_pct"):
        assert [r["item_id"] for r in leaders(day, stat)] == ["player-2"], stat


def test_team_games_fall_back_to_the_teams_players(put, data_dir):
    put(D1, players=[P(1, games=12, team="NY"), P(2, games=9, team="NY")])  # no team rows
    day = rows(data_dir)
    tg = team_games(day)
    assert tg == {"NY": 12}
    p2 = next(r for r in day if r["item_id"] == "player-2")
    assert qualifies(p2, "points", tg)          # 9 >= 0.7 * 12 = 8.4
    assert not qualifies({**p2, "games": 8}, "points", tg)

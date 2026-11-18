"""status.json and the daily issue (render + open/update/close)."""
from tracker.build import build_history, write_history
from tracker.issue import GitHub, render
from tracker.status import build_status

D1, D2 = "2026-11-18", "2026-11-19"
SITE = "https://example.github.io/nba-stat-tracker/"


def P(i, points=10.0, games=10, **kw):
    return {"id": i, "name": f"Player {i}", "points": points, "games": games, **kw}


def setup_two_days(put, log, data_dir):
    put(D1, players=[P(1, 20.0), P(2, 15.0), P(3, 9.0)], teams=[{"abbr": "LAL"}])
    put(D2, players=[P(1, 22.0, 11), P(2, 15.0, 11), P(4, 6.0, 1)])  # teams failed on D2
    log(D1, [("espn_players", True, 3), ("espn_teams", True, 1)])
    log(D2, [("espn_players", True, 3), ("espn_teams", False, 0)])
    rows = build_history(data_dir / "raw")
    write_history(rows, data_dir / "history.csv")
    return rows


def test_status_has_every_required_key(put, log, data_dir):
    setup_two_days(put, log, data_dir)
    s = build_status(data_dir)
    for key in ("run_time", "first_run_date", "days_with_success", "items", "new_today",
                "gone_today", "sources"):
        assert key in s
    assert s["run_time"] == "2026-11-19T11:30:00Z" and s["run_date"] == D2
    assert s["first_run_date"] == D1 and s["days_with_success"] == 2
    assert s["items"] == 3
    assert s["new_today"] == 1 and s["gone_today"] == 1
    assert [i["item_id"] for i in s["new_items"]] == ["player-4"]
    assert [i["item_id"] for i in s["gone_items"]] == ["player-3"]
    assert s["sources"] == [
        {"name": "espn_players", "ok": True, "count": 3, "format": "json", "error": ""},
        {"name": "espn_teams", "ok": False, "count": 0, "format": "json", "error": "HTTPError: 503"}]


def test_days_with_success_counts_dates_with_a_raw_file(put, log, data_dir):
    put(D1, players=[P(1)])
    log(D1, [("espn_players", True, 1)])
    log(D2, [("espn_players", False, 0)])  # D2: everything failed, no raw file
    write_history(build_history(data_dir / "raw"), data_dir / "history.csv")
    s = build_status(data_dir)
    assert s["run_date"] == D2 and s["days_with_success"] == 1 and s["items"] == 0


def test_issue_lists_moves_with_old_and_new_values(put, log, data_dir):
    rows = setup_two_days(put, log, data_dir)
    body = render(build_status(data_dir), rows, SITE)
    assert "| 1 | Player 1 (LAL) | 20.0 | 22.0 | **+2.0** | 10 → 11 |" in body
    assert "Player 2 (LAL) | 15.0" not in body  # no move
    assert "## Appeared (1)" in body and "player-4" in body
    assert "## Disappeared (1)" in body and "player-3" in body
    assert "| espn_teams | json | **failed**: HTTPError: 503 | 0 |" in body
    assert "## League leaders" in body and "| Points per game | Player 1 (LAL) | 22.0 |" in body


def test_issue_on_the_first_run_says_so(put, log, data_dir):
    put(D1, players=[P(1)])
    log(D1, [("espn_players", True, 1)])
    rows = build_history(data_dir / "raw")
    write_history(rows, data_dir / "history.csv")
    body = render(build_status(data_dir), rows, SITE)
    assert "First run" in body and "## Appeared (0)" in body


def test_issue_with_no_changes_is_still_written(put, log, data_dir):
    put(D1, players=[P(1)])
    put(D2, players=[P(1)])
    log(D2, [("espn_players", True, 1)])
    rows = build_history(data_dir / "raw")
    write_history(rows, data_dir / "history.csv")
    body = render(build_status(data_dir), rows, SITE)
    assert "No item with at least 5 games changed" in body


class FakeResponse:
    def __init__(self, data, code=200):
        self.data, self.status_code = data, code
        self.content = b"x" if data is not None else b""

    def json(self):
        return self.data

    def raise_for_status(self):
        pass


class FakeSession:
    """Just enough of the GitHub issues API."""
    def __init__(self, issues):
        self.headers = {}
        self.issues = issues
        self.calls = []

    def request(self, method, url, **kw):
        path = url.split("/repos/o/r", 1)[1]
        self.calls.append((method, path, kw.get("json")))
        if method == "GET" and path == "/issues":
            return FakeResponse(self.issues)
        if method == "POST" and path == "/issues":
            made = {"number": 99, "title": kw["json"]["title"], "state": "open"}
            self.issues.append(made)
            return FakeResponse(made)
        return FakeResponse({})


def test_a_new_day_opens_an_issue_and_closes_the_previous_one():
    s = FakeSession([{"number": 7, "title": D1, "state": "open"}, {"number": 3, "title": "2026-11-17", "state": "closed"}])
    msg = GitHub("o/r", "token", s).publish(D2, "body")
    assert msg == f"opened issue #99 ({D2})"
    assert ("POST", "/issues", {"title": D2, "body": "body", "labels": ["daily-report"]}) in s.calls
    assert ("PATCH", "/issues/7", {"state": "closed", "state_reason": "completed"}) in s.calls
    assert not any(c[1] == "/issues/3" for c in s.calls)


def test_a_second_run_on_the_same_day_updates_that_days_issue():
    s = FakeSession([{"number": 8, "title": D2, "state": "open"}, {"number": 7, "title": D1, "state": "closed"}])
    msg = GitHub("o/r", "token", s).publish(D2, "new body")
    assert msg == f"updated issue #8 ({D2})"
    assert ("PATCH", "/issues/8", {"body": "new body", "state": "open"}) in s.calls
    assert not any(m == "POST" and p == "/issues" for m, p, _ in s.calls)

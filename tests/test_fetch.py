"""Fetching: a failing source is recorded and never stops the run."""
import gzip
import json
from datetime import datetime, timezone

import pytest
import requests

from tracker import config, fetch
from conftest import players_raw, teams_raw

NOW = datetime(2026, 11, 18, 11, 30, tzinfo=timezone.utc)
DAY = "2026-11-18"
TEAMS = [{"abbr": a} for a in ("ATL", "BOS", "LAL", "NY", "OKC", "SA", "GS", "MIA", "DEN", "PHX")]
PLAYERS = [{"id": i, "name": f"Player {i}"} for i in range(1, 13)]


def getter(answers):
    def get(src):
        a = answers[src["name"]]
        if isinstance(a, Exception):
            raise a
        return a
    return get


def test_the_configured_sources_have_converters_and_formats():
    from tracker.convert import CONVERTERS
    assert len(config.SOURCES) >= 2
    for src in config.SOURCES:
        assert src["name"] in CONVERTERS
        assert src["format"] == "json"
        assert src["url"].startswith("https://")


def test_one_failing_source_does_not_stop_the_run(data_dir):
    log = fetch.run(data_dir, now=NOW, get=getter({
        "espn_players": requests.HTTPError("503 Server Error"),
        "espn_teams": teams_raw(TEAMS)}))
    results = {r["name"]: r for r in log["sources"]}
    assert results["espn_players"]["ok"] is False
    assert "503" in results["espn_players"]["error"]
    assert results["espn_teams"]["ok"] is True and results["espn_teams"]["count"] == 10
    files = sorted(p.name for p in (data_dir / "raw" / DAY).iterdir())
    assert files == ["espn_teams.json.gz"]  # the failed source wrote no raw file
    saved = json.loads((data_dir / "runs" / f"{DAY}.json").read_text())
    assert saved == log and saved["run_time"] == "2026-11-18T11:30:00Z" and saved["date"] == DAY


def test_every_source_failing_still_records_every_result(data_dir):
    log = fetch.run(data_dir, now=NOW, get=getter({
        "espn_players": requests.ConnectionError("no route"),
        "espn_teams": requests.Timeout("slow")}))
    assert [r["ok"] for r in log["sources"]] == [False, False]
    assert not (data_dir / "raw" / DAY).exists()
    assert (data_dir / "runs" / f"{DAY}.json").exists()


@pytest.mark.parametrize("answer, message", [
    (b"<html><body>Access denied</body></html>", "not JSON"),
    (players_raw(PLAYERS[:3]), "only 3 items"),
])
def test_unusable_answers_count_as_failures(data_dir, answer, message):
    log = fetch.run(data_dir, now=NOW, get=getter({"espn_players": answer, "espn_teams": teams_raw(TEAMS)}))
    players = log["sources"][0]
    assert players["name"] == "espn_players" and players["ok"] is False
    assert message in players["error"]
    assert not (data_dir / "raw" / DAY / "espn_players.json.gz").exists()


def test_raw_file_is_the_answer_byte_for_byte_gzipped(data_dir):
    answer = players_raw(PLAYERS)
    fetch.run(data_dir, now=NOW, get=getter({"espn_players": answer, "espn_teams": teams_raw(TEAMS)}))
    path = data_dir / "raw" / DAY / "espn_players.json.gz"
    assert gzip.decompress(path.read_bytes()) == answer
    first = path.read_bytes()
    fetch.run(data_dir, now=NOW, get=getter({"espn_players": answer, "espn_teams": teams_raw(TEAMS)}))
    assert path.read_bytes() == first  # same answer, same file


def test_only_replaces_just_the_named_source(data_dir):
    fetch.run(data_dir, now=NOW, get=getter({"espn_players": players_raw(PLAYERS), "espn_teams": teams_raw(TEAMS)}))
    teams_src = [s for s in config.SOURCES if s["name"] == "espn_teams"]
    log = fetch.run(data_dir, teams_src, now=NOW, whole_day=False,
                    get=getter({"espn_teams": requests.HTTPError("500")}))
    assert [(r["name"], r["ok"]) for r in log["sources"]] == [("espn_players", True), ("espn_teams", False)]
    assert sorted(p.name for p in (data_dir / "raw" / DAY).iterdir()) == ["espn_players.json.gz"]


def test_download_retries_server_errors(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, code, body=b"{}"):
            self.status_code, self.content = code, body

        def raise_for_status(self):
            if self.status_code >= 400:
                raise requests.HTTPError(str(self.status_code))

    answers = [Resp(503), Resp(200, b'{"ok": 1}')]
    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: calls.append(1) or answers.pop(0))
    monkeypatch.setattr(fetch.time, "sleep", lambda s: None)
    assert fetch.download({"url": "https://example.com"}) == b'{"ok": 1}'
    assert len(calls) == 2

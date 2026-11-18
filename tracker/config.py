"""Sources and shared settings.

Both sources are ESPN's public stats API, which answers a plain HTTP GET with
no login or key. Each source is one request and one raw file a day.

  espn_players  every NBA player who has played this regular season (~470),
                season totals and per-game averages
  espn_teams    all 30 teams, the same team totals and per-game averages

The `name` is the source key used in raw file names and in the history's
`source` column. A source taken out of SOURCES must keep its converter in
convert.py, so the build can still read the raw files it left behind.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

REPO = "chuckstew460-collab/nba-stat-tracker"
REPO_URL = f"https://github.com/{REPO}"
SITE_URL = "https://chuckstew460-collab.github.io/nba-stat-tracker/"
USER_AGENT = f"nba-stat-tracker/1.0 (+{REPO_URL})"

ESPN_STATS = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics"

SOURCES = [
    {"name": "espn_players", "format": "json", "kind": "player",
     "url": f"{ESPN_STATS}/byathlete",
     # isqualified=false lists every player, not just those meeting ESPN's
     # leaderboard minimums; limit=1000 puts the whole league on one page.
     "params": {"region": "us", "lang": "en", "contentorigin": "espn",
                "isqualified": "false", "limit": "1000", "page": "1"}},
    {"name": "espn_teams", "format": "json", "kind": "team",
     "url": f"{ESPN_STATS}/byteam",
     "params": {"region": "us", "lang": "en", "contentorigin": "espn", "limit": "50"}},
]

# A source that converts to fewer items than this is treated as failed, so a
# truncated or empty answer never wipes a day of the history.
MIN_ITEMS = 10

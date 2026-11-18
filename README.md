# NBA Stat Tracker

[![Tests](https://github.com/chuckstew460-collab/nba-stat-tracker/actions/workflows/tests.yml/badge.svg)](https://github.com/chuckstew460-collab/nba-stat-tracker/actions/workflows/tests.yml)
[![Daily pipeline](https://github.com/chuckstew460-collab/nba-stat-tracker/actions/workflows/daily.yml/badge.svg)](https://github.com/chuckstew460-collab/nba-stat-tracker/actions/workflows/daily.yml)

**Live site:** https://chuckstew460-collab.github.io/nba-stat-tracker/

Every day, on its own, this tool downloads the season stats of every NBA player
and team from ESPN. It adds them to a history with one row per item per day,
opens a GitHub Issue with the biggest moves, and publishes a website. The site
shows the league leaders (points, rebounds, assists, steals, blocks, field goal %,
3-point % and free throw %), lets you browse and star players, and reports trends
across the history.

Unofficial fan project; not affiliated with the NBA or ESPN.

## Items and sources

**Items** are every NBA player who has played in the current regular season
(about 470 in mid-November, more as players make their debuts) plus all 30 teams.
The source updates their numbers after every game night.

| Source | URL | Format | Items | What is kept |
|---|---|---|---|---|
| `espn_players` | `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&limit=1000&page=1` | JSON | every player with a game this season | The raw answer is saved whole. The build keeps each player's ID, name, team, position and the 19 stats in the columns below. It drops the rest: headshots, links, ranks, fouls, technicals and ejections. |
| `espn_teams` | `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byteam?region=us&lang=en&contentorigin=espn&limit=50` | JSON | the 30 teams | The raw answer is saved whole. The build keeps the team's own per-game averages and season totals. It drops the opponents' split, the differentials, logos and ranks. |

Both are public endpoints that answer a plain GET with no login or key. Each
source is **one request a day**. `isqualified=false` makes ESPN list every
player, not just those meeting its leaderboard minimums. `limit=1000` puts the
whole league on one page; the converter refuses an answer that says there is a
second page.

**Item key (`item_id`).** `player-<ESPN athlete id>` for players (for example
`player-3945274` is Luka Dončić). `team-<ESPN team abbreviation>` for teams (for
example `team-LAL`, `team-GS`). The ESPN athlete ID never changes, even when a
player is traded, so the same player lines up day after day.

## Data files

Both files live at fixed paths, and the pipeline commits them every day.

### `data/history.csv`

One row per item per day, sorted by `date`, then `item_id`. A value the source
does not report for an item on a day is left empty.

| Column | Meaning | Unit |
|---|---|---|
| `date` | UTC date of the run that fetched the row | `YYYY-MM-DD` |
| `item_id` | the item's key (see above) | text |
| `item` | player name, or team name (for example `Los Angeles Lakers`) | text |
| `source` | the source the row came from: `espn_players` or `espn_teams` | text |
| `kind` | `player` or `team` | text |
| `team` | the player's team, or the team itself, as ESPN's abbreviation (`LAL`, `NY`, `UTAH`, …) | text |
| `position` | player position: `G`, `F` or `C` (empty for teams) | text |
| `games` | games played this season | games |
| `minutes` | minutes per game (empty for teams) | minutes per game |
| `points` | points per game | points per game |
| `rebounds` | rebounds per game | rebounds per game |
| `assists` | assists per game | assists per game |
| `steals` | steals per game | steals per game |
| `blocks` | blocks per game | blocks per game |
| `turnovers` | turnovers per game | turnovers per game |
| `fg_pct` | field goal percentage (empty with no field goal attempts) | percent, 0–100 |
| `fg3_pct` | 3-point percentage (empty with no 3-point attempts) | percent, 0–100 |
| `ft_pct` | free throw percentage (empty with no free throw attempts) | percent, 0–100 |
| `fgm` | field goals made this season | count |
| `fga` | field goals attempted this season | count |
| `fg3m` | 3-pointers made this season | count |
| `fg3a` | 3-pointers attempted this season | count |
| `ftm` | free throws made this season | count |
| `fta` | free throws attempted this season | count |
| `double_doubles` | double-doubles this season (empty for teams) | count |
| `triple_doubles` | triple-doubles this season (empty for teams) | count |

Per-game averages and percentages are written with one decimal place, the
precision ESPN shows. Counts are whole numbers. ESPN reports a percentage of
0.0 for a player with no attempts, but that would read as "missed every shot",
so it is left empty.

### `data/status.json`

Describes the latest run.

| Key | Meaning |
|---|---|
| `run_time` | UTC time of the latest run (`YYYY-MM-DDTHH:MM:SSZ`) |
| `run_date` | its UTC date |
| `first_run_date` | date of the earliest raw file |
| `days_with_success` | number of different dates with a raw file |
| `items` | number of items (rows) in the latest run |
| `new_today` | number of items that appeared since their source's previous run |
| `gone_today` | number of items that disappeared since their source's previous run |
| `sources` | one entry per source: `name`, `ok` (true/false), `count` (items), `format`, `error` |
| `previous` | each source's previous run date (what "since the previous run" compares with) |
| `new_items`, `gone_items` | the items behind `new_today` and `gone_today` |

The pipeline also writes `data/raw/<date>/<source>.json.gz`, the answers exactly
as ESPN sent them, gzip-compressed. It records every source's result, success or
failure, in `data/runs/<date>.json`.

## The move rule

**Previous run.** Each source has its own previous run: the latest earlier date
on which that source has rows. Items are compared only within their own source.
If a source failed yesterday, it is compared with the last day it worked, and a
source that failed today makes nothing "gone".

**Move.** An item's move is its **points per game now minus its points per game
at the previous run**, rounded to 0.1. Two kinds of item are left out: those
with **fewer than 5 games** played now, because one game swings a short average
too much, and moves of 0. Moves are ranked by size (absolute value), largest
first, with ties broken by `item_id`.

**The daily issue** is titled with the run date. It lists the **15 largest
moves** with the old and new points per game and the games played on each date.
It also lists every item that appeared or disappeared, each source's status, and
the current leader in each category. It is opened every day, even with no
changes, and the previous day's issue is closed.

The Today page's "biggest moves" table uses the same rule. It can switch to any
other stat, or to players or teams only.

**Appeared / disappeared.** An item appears when its source lists it and did not
list it at the source's previous run. That is usually a player's first game of
the season. It disappears when its source stops listing it. Nothing appears on a
source's first run.

## Leader rules (Today page, issue, Trends)

Leaders follow the NBA's qualification rules, prorated to the games played so far:

- **Per-game stats** (points, rebounds, assists, steals, blocks): the player has
  played in at least **70%** of his team's games (the NBA's 58-of-82 rule).
- **FG%**: at least **300 field goals made per 82 team games**, prorated.
- **3P%**: at least **82 threes made per 82 team games**, prorated.
- **FT%**: at least **125 free throws made per 82 team games**, prorated.

A team's games come from its `espn_teams` row. On a day without one, they come
from the most games any of its players has played.

## Pipeline

`.github/workflows/daily.yml` runs the program every day at **11:23 UTC**. NBA
games finish by about 07:00 UTC, so the stats have settled by then. A backup run
at **17:41 UTC** covers a dropped or late scheduled run. Each run:

1. **Fetch** (`python -m tracker.fetch`): calls every source and saves its
   answer to `data/raw/<date>/<source>.json.gz`. An answer must convert to at
   least 10 items to count. A source that fails (an HTTP error, a timeout, an
   HTML page, an empty or cut-off list) writes no raw file that day. The run
   carries on, and the failure is recorded in `data/runs/<date>.json`.
2. **Build** (`python -m tracker.build`): rebuilds `data/history.csv` from the
   raw files alone (see below).
3. **Status** (`python -m tracker.status`): writes `data/status.json`.
4. **Issue** (`python -m tracker.issue`): opens the day's issue, or updates it
   on a second run that day, and closes the previous one.
5. **Commit**: commits `data/` (raw files, run log, history, status) to `main`.

A run that finishes and commits counts as successful, even when a source
failed. A **second run on the same UTC day** replaces that day's raw files and
run log, rebuilds the history and updates that day's issue, so each day counts
once.

### Building the history from the raw files

```bash
python -m tracker.build
```

The build reads every raw file, date folder by date folder and source by
source. It converts each one to the common columns (`tracker/convert.py`) and
writes the rows sorted by date, then `item_id`. It reads nothing else, so
running it again writes the same file byte for byte, and a change to a
conversion rule reaches every day of the history. The Tests workflow
rebuilds the file on every push and after every pipeline run, and fails if it
differs from the committed one.

### Running it yourself

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m tracker.run                  # fetch + build + status for today's UTC date
python -m tracker.run --skip-fetch     # rebuild history and status from the raw files only
python -m tracker.issue --dry-run      # print the day's issue instead of posting it
python -m tracker.fetch --only espn_teams   # re-fetch one source, keep the rest of the day
python -m pytest                       # the test suite
```

## Site

Three pages share one navigation bar, one font pair (Barlow Condensed and
Barlow) and one set of colors, with light and dark themes. Each page loads
`data/status.json` and `data/history.csv` and does every calculation in the
browser.

- **Today** (`index.html`) shows the time of the last run, the status of each
  source, and the counts from the status file. It has the eight leader boards
  with each leader's change since the previous run, and the biggest moves (any
  stat, all items or players or teams). It also lists items that appeared or
  disappeared, and the latest values of every player and team with their change
  since the previous run.
- **Browse** (`browse.html`) shows the latest values of every item. It has
  filters for kind, team, position, minimum games and shortlist only, plus a
  name search. Every numeric column sorts up and down, by its header or by the
  sort controls. A star saves an item to a shortlist kept in the browser's
  `localStorage`, which survives a reload.
- **Trends** (`trends.html`) is a report on the history. An explorer charts any
  numeric column over the days for up to 8 chosen items (your shortlist, or the
  current top 5). Five findings follow, each with a heading that states it, a
  paragraph with the numbers and how they are computed, a chart, and a table of
  the numbers:
  1. the scoring race: each day's qualified points leader, and the top 5 over time
  2. the biggest risers and fallers in points per game, first day vs latest day
  3. the day with the biggest one-day move under the move rule
  4. league 3-point shooting: sum of threes made ÷ sum of attempts over the team rows, by day
  5. team scoring: every team's points per game on the latest day

  `tests/test_site_numbers.py` runs the site's own `assets/js/stats.js` under
  Node on `data/history.csv` and checks every number against the same
  calculation done in Python. So the Trends page is checked against the history
  file on every push and after every pipeline run.

**Installable and offline.** `manifest.webmanifest` and the service worker
`sw.js` make the site installable as an app; Chrome and Edge show an
"Install app" button. Online, every page and data file comes from the network,
and a copy is kept. Offline, the kept copies are served, so the site still opens
and shows the last data it loaded.

## Every file

| File | What it does |
|---|---|
| `tracker/config.py` | the two sources (URL, query, format), paths, the repository and site URLs, the 10-item minimum |
| `tracker/fetch.py` | step 1: calls each source, saves raw files, records every result in the run log |
| `tracker/convert.py` | one converter per source: raw bytes → rows with the common columns; the column list |
| `tracker/build.py` | step 2: builds `data/history.csv` from the raw files; reads it back |
| `tracker/moves.py` | previous run per source, appeared/gone items, the move rule, leader qualification |
| `tracker/status.py` | step 3: writes `data/status.json` |
| `tracker/issue.py` | step 4: renders the daily issue; opens/updates it and closes the previous one |
| `tracker/run.py` | runs steps 1–4 in one command |
| `tests/conftest.py` | helpers that write small ESPN-shaped raw files into a temp folder |
| `tests/fixtures/espn_players.json`, `espn_teams.json` | trimmed real ESPN answers used by the conversion tests |
| `tests/fixtures/make_fixtures.py` | how those fixtures were cut from a real day of raw files |
| `tests/test_convert.py` | each source converts to the common columns, values and empty cells |
| `tests/test_moves.py` | the move rule, previous run per source, appeared/gone, leader minimums |
| `tests/test_history.py` | history logic: one row per item per day, sorting, failed sources, rebuilds, a second run on the same day |
| `tests/test_fetch.py` | a failing source never stops the run, raw files are byte-exact, retries |
| `tests/test_status_issue.py` | status keys and counts, the issue body, opening/updating/closing issues |
| `tests/test_site_numbers.py` | the site's numbers (run under Node) match Python's on `history.csv` |
| `scripts/site_numbers.mjs` | prints every number the site computes from a history file, as JSON |
| `scripts/make_icons.py` | draws the app icons |
| `.github/workflows/daily.yml` | the daily pipeline on a schedule (and a manual "Run workflow" button) |
| `.github/workflows/tests.yml` | pytest on every push and after every pipeline run, plus the history rebuild check |
| `index.html`, `browse.html`, `trends.html` | the three pages (Today, Browse, Trends) |
| `assets/js/common.js` | nav bar, theme, data loading, CSV parsing, formatting, the shortlist, service worker registration |
| `assets/js/stats.js` | every calculation the pages make (the same rules as `moves.py`) |
| `assets/js/charts.js` | the SVG line, bar and column charts, tooltips and table views |
| `assets/js/today.js`, `browse.js`, `trends.js` | one script per page |
| `assets/css/site.css` | the shared styles, light and dark |
| `assets/icons/*` | app icons and favicon |
| `manifest.webmanifest` | web app manifest (name, icons, colors) |
| `sw.js` | service worker: network first, cached copy when offline |
| `data/history.csv` | the history (one row per item per day) |
| `data/status.json` | the latest run |
| `data/raw/<date>/<source>.json.gz` | what each source returned that day, gzip-compressed |
| `data/runs/<date>.json` | every source's result for that day's run |
| `requirements.txt`, `pytest.ini` | Python dependencies and test settings |
| `.gitattributes` | keeps LF line endings so the rebuild is byte-identical on every OS |
| `.nojekyll` | serves the site as plain files on GitHub Pages |

## If a source stops working

The run keeps going and the Today page shows the source as failed. To replace
a source, add it to `SOURCES` in `tracker/config.py` with a converter in
`tracker/convert.py` and a fixture test. Keep the old converter, so the build
can still read the raw files the old source left behind.

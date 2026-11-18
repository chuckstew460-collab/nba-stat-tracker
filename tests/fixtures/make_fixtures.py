"""Make the small test fixtures from a real day of raw files.

    python tests/fixtures/make_fixtures.py data/raw/2026-11-18

Keeps the answers' structure (header categories, pagination, the per-item
category lists) and a handful of items, and drops bulky keys the converters
never read (links, logos, headshots, glossary).
"""
import gzip
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
DROP = {"links", "logos", "headshot", "teamLogos", "glossary", "uid", "guid"}
PLAYERS = {"3945274", "4278073"}  # Luka Doncic, Shai Gilgeous-Alexander
TEAMS = {"LAL", "OKC", "UTAH"}


def slim(x):
    if isinstance(x, dict):
        return {k: slim(v) for k, v in x.items() if k not in DROP}
    if isinstance(x, list):
        return [slim(v) for v in x]
    return x


def main(day_dir: str) -> None:
    day = Path(day_dir)
    p = json.loads(gzip.decompress((day / "espn_players.json.gz").read_bytes()))
    keep = [a for a in p["athletes"] if a["athlete"]["id"] in PLAYERS]
    # plus the first player with no three-point attempts (an empty 3-point %)
    keep += [next(a for a in p["athletes"] if a["categories"][1]["values"][16] == 0)]
    p["athletes"] = keep
    p["pagination"].update(count=len(keep))
    (HERE / "espn_players.json").write_text(json.dumps(slim(p), indent=1) + "\n", encoding="utf-8")

    t = json.loads(gzip.decompress((day / "espn_teams.json.gz").read_bytes()))
    t["teams"] = [x for x in t["teams"] if x["team"]["abbreviation"] in TEAMS]
    (HERE / "espn_teams.json").write_text(json.dumps(slim(t), indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])

// Every calculation the pages make from history.csv. No DOM here, so the same
// module runs in the browser and under Node (scripts/check_site_numbers.mjs).
// The rules match tracker/moves.py exactly; see the README for them in words.

export const MOVE_MIN_GAMES = 5;
export const MOVE_LIMIT = 15;
export const SEASON_GAMES = 82;
export const PER_GAME_SHARE = 0.7;
export const PCT_MINIMUMS = { fg_pct: ["fgm", 300], fg3_pct: ["fg3m", 82], ft_pct: ["ftm", 125] };

// Column metadata: every numeric column of history.csv.
export const STATS = [
  { key: "points", label: "Points per game", short: "PTS", digits: 1 },
  { key: "rebounds", label: "Rebounds per game", short: "REB", digits: 1 },
  { key: "assists", label: "Assists per game", short: "AST", digits: 1 },
  { key: "steals", label: "Steals per game", short: "STL", digits: 1 },
  { key: "blocks", label: "Blocks per game", short: "BLK", digits: 1 },
  { key: "turnovers", label: "Turnovers per game", short: "TOV", digits: 1, lowerIsBetter: true },
  { key: "fg_pct", label: "Field goal %", short: "FG%", digits: 1, pct: true },
  { key: "fg3_pct", label: "3-point %", short: "3P%", digits: 1, pct: true },
  { key: "ft_pct", label: "Free throw %", short: "FT%", digits: 1, pct: true },
  { key: "minutes", label: "Minutes per game", short: "MIN", digits: 1 },
  { key: "games", label: "Games played", short: "G", digits: 0 },
  { key: "fgm", label: "Field goals made (season)", short: "FGM", digits: 0 },
  { key: "fga", label: "Field goals attempted (season)", short: "FGA", digits: 0 },
  { key: "fg3m", label: "3-pointers made (season)", short: "3PM", digits: 0 },
  { key: "fg3a", label: "3-pointers attempted (season)", short: "3PA", digits: 0 },
  { key: "ftm", label: "Free throws made (season)", short: "FTM", digits: 0 },
  { key: "fta", label: "Free throws attempted (season)", short: "FTA", digits: 0 },
  { key: "double_doubles", label: "Double-doubles (season)", short: "DD", digits: 0 },
  { key: "triple_doubles", label: "Triple-doubles (season)", short: "TD", digits: 0 },
];
export const STAT = Object.fromEntries(STATS.map((s) => [s.key, s]));
export const NUMERIC = STATS.map((s) => s.key);
export const LEADER_STATS = ["points", "rebounds", "assists", "steals", "blocks", "fg_pct", "fg3_pct", "ft_pct"];

// Plain code-point order, the same as Python's string sort (never localeCompare).
export const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const round1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ parsing
export function toRows(records) {
  // records: [{column: text}] straight from the CSV
  return records.map((r) => {
    const row = { ...r };
    for (const k of NUMERIC) row[k] = r[k] === "" || r[k] == null ? null : Number(r[k]);
    return row;
  });
}

// ------------------------------------------------------------------ dates
export function datesOf(rows) {
  return [...new Set(rows.map((r) => r.date))].sort();
}
export function byDate(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.date)) m.set(r.date, []);
    m.get(r.date).push(r);
  }
  return m;
}

// ------------------------------------------------------------------ previous run, new/gone, moves
// For each source with rows on `day`: the latest earlier date with rows from it.
export function previousDates(rows, day) {
  const prev = {};
  for (const r of rows) if (r.date === day) prev[r.source] = null;
  for (const r of rows) {
    if (r.source in prev && r.date < day && (prev[r.source] === null || r.date > prev[r.source])) {
      prev[r.source] = r.date;
    }
  }
  return prev;
}

export function compare(rows, day) {
  const previous = previousDates(rows, day);
  const now = new Map();
  const before = new Map();
  for (const r of rows) {
    if (r.date === day) now.set(r.item_id, r);
    else if (previous[r.source] === r.date) before.set(r.item_id, r);
  }
  const hadPrev = new Set(Object.keys(previous).filter((s) => previous[s]));
  const nowIds = [...now.keys()].sort(cmpStr);
  const pairs = nowIds.filter((id) => before.has(id)).map((id) => [before.get(id), now.get(id)]);
  const appeared = nowIds.filter((id) => !before.has(id) && hadPrev.has(now.get(id).source)).map((id) => now.get(id));
  const gone = [...before.keys()].sort(cmpStr).filter((id) => !now.has(id)).map((id) => before.get(id));
  return { day, previous, pairs, appeared, gone };
}

export function moves(cmp, stat = "points", { minGames = MOVE_MIN_GAMES, limit = MOVE_LIMIT, kind = null } = {}) {
  const out = [];
  for (const [old, cur] of cmp.pairs) {
    if (kind && cur.kind !== kind) continue;
    if ((cur.games || 0) < minGames) continue;
    const a = old[stat], b = cur[stat];
    if (a == null || b == null) continue;
    const change = round1(b - a);
    if (change === 0) continue;
    out.push({ item_id: cur.item_id, item: cur.item, kind: cur.kind, team: cur.team, position: cur.position,
               old: a, new: b, change, old_date: old.date, old_games: old.games, new_games: cur.games });
  }
  out.sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || cmpStr(x.item_id, y.item_id));
  return limit ? out.slice(0, limit) : out;
}

// Change in every numeric column since the item's previous run: {item_id: {stat: change}}
export function changes(cmp) {
  const out = {};
  for (const [old, cur] of cmp.pairs) {
    const d = {};
    for (const k of NUMERIC) {
      d[k] = old[k] == null || cur[k] == null ? null : round1(cur[k] - old[k]);
    }
    out[cur.item_id] = d;
  }
  return out;
}

// ------------------------------------------------------------------ leaders
export function teamGames(dayRows) {
  const games = {};
  for (const r of dayRows) if (r.kind === "team" && r.games != null) games[r.team] = r.games;
  const fallback = {};
  for (const r of dayRows) {
    if (r.kind === "player" && r.team && r.games != null) fallback[r.team] = Math.max(fallback[r.team] || 0, r.games);
  }
  for (const [t, g] of Object.entries(fallback)) if (!(t in games)) games[t] = g;
  return games;
}

export function qualifies(row, stat, tg) {
  const g = tg[row.team] || row.games || 0;
  if (stat in PCT_MINIMUMS) {
    const [col, seasonTotal] = PCT_MINIMUMS[stat];
    return (row[col] || 0) >= (seasonTotal / SEASON_GAMES) * g;
  }
  return (row.games || 0) >= PER_GAME_SHARE * g;
}

// What a player needs to qualify, in words, for a team with g games.
export function minimumText(stat, g) {
  if (stat in PCT_MINIMUMS) {
    const [col, total] = PCT_MINIMUMS[stat];
    const name = { fgm: "field goals", fg3m: "threes", ftm: "free throws" }[col];
    return `at least ${Math.ceil((total / SEASON_GAMES) * g - 1e-9)} ${name} made`;
  }
  return `at least ${Math.ceil(PER_GAME_SHARE * g - 1e-9)} games`;
}

export function leaders(dayRows, stat, n = 5, tg = teamGames(dayRows)) {
  const pool = dayRows.filter((r) => r.kind === "player" && r[stat] != null && qualifies(r, stat, tg));
  pool.sort((a, b) => b[stat] - a[stat] || cmpStr(a.item_id, b.item_id));
  return n ? pool.slice(0, n) : pool;
}

// ------------------------------------------------------------------ trends (findings)
// 1. Scoring race: the qualified points leader on every date.
export function scoringRace(rows) {
  const days = byDate(rows);
  const perDay = [];
  for (const d of [...days.keys()].sort()) {
    const top = leaders(days.get(d), "points", 1)[0];
    if (top) perDay.push({ date: d, item_id: top.item_id, item: top.item, team: top.team, points: top.points });
  }
  const last = perDay[perDay.length - 1] || null;
  const daysLed = last ? perDay.filter((p) => p.item_id === last.item_id).length : 0;
  // current top five, with their points per game on every date
  const latest = last ? days.get(last.date) : [];
  const top5 = leaders(latest, "points", 5);
  return { perDay, last, daysLed, totalDays: perDay.length, top5 };
}

// 2. Risers and fallers: points per game on the latest date minus on the first
//    date in the history, players on both dates with at least 5 games on both.
export function risersFallers(rows, stat = "points", minGames = MOVE_MIN_GAMES) {
  const ds = datesOf(rows);
  if (ds.length < 2) return { first: ds[0] || null, last: ds[0] || null, list: [] };
  const first = ds[0], last = ds[ds.length - 1];
  const a = new Map(), list = [];
  for (const r of rows) if (r.date === first && r.kind === "player") a.set(r.item_id, r);
  for (const r of rows) {
    if (r.date !== last || r.kind !== "player") continue;
    const o = a.get(r.item_id);
    if (!o || o[stat] == null || r[stat] == null) continue;
    if ((o.games || 0) < minGames || (r.games || 0) < minGames) continue;
    list.push({ item_id: r.item_id, item: r.item, team: r.team, old: o[stat], new: r[stat],
                change: round1(r[stat] - o[stat]), old_games: o.games, new_games: r.games });
  }
  list.sort((x, y) => y.change - x.change || cmpStr(x.item_id, y.item_id));
  return { first, last, list };
}

// 3. Biggest move of each day (the move rule), and the day with the biggest.
export function dailyMoves(rows) {
  const ds = datesOf(rows);
  const perDay = [];
  for (const d of ds.slice(1)) {
    const cmp = compare(rows, d);
    const all = moves(cmp, "points", { limit: null, kind: "player" });
    const played = cmp.pairs.filter(([o, n]) => n.kind === "player" && (n.games || 0) > (o.games || 0)).length;
    perDay.push({ date: d, top: all[0] || null, movers: all.length, played });
  }
  let best = null;
  for (const p of perDay) {
    if (p.top && (!best || Math.abs(p.top.change) > Math.abs(best.top.change))) best = p;
  }
  return { perDay, best };
}

// 4. League shooting from the team rows: sum of makes / sum of attempts.
export function leagueShooting(rows) {
  const out = [];
  for (const [d, list] of [...byDate(rows)].sort((x, y) => cmpStr(x[0], y[0]))) {
    const teams = list.filter((r) => r.kind === "team");
    if (!teams.length) continue;
    const sum = (k) => teams.reduce((s, r) => s + (r[k] || 0), 0);
    const games = sum("games");
    out.push({
      date: d, teams: teams.length,
      fg3m: sum("fg3m"), fg3a: sum("fg3a"), fgm: sum("fgm"), fga: sum("fga"), games,
      fg3_pct: sum("fg3a") ? round1((100 * sum("fg3m")) / sum("fg3a")) : null,
      fg_pct: sum("fga") ? round1((100 * sum("fgm")) / sum("fga")) : null,
      fg3a_per_game: games ? round1(sum("fg3a") / games) : null,
    });
  }
  return out;
}

// 5. Team offenses on the latest date with team rows, best to worst.
export function teamScoring(rows) {
  const ds = datesOf(rows.filter((r) => r.kind === "team"));
  const last = ds[ds.length - 1];
  if (!last) return { date: null, list: [] };
  const list = rows.filter((r) => r.date === last && r.kind === "team" && r.points != null)
    .sort((a, b) => b.points - a.points || cmpStr(a.item_id, b.item_id));
  const first = ds[0];
  const firstPts = new Map(rows.filter((r) => r.date === first && r.kind === "team").map((r) => [r.item_id, r.points]));
  return { date: last, first, list: list.map((r) => ({ item_id: r.item_id, item: r.item, team: r.team,
    points: r.points, games: r.games, first: firstPts.get(r.item_id) ?? null })) };
}

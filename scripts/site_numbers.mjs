// Print, as JSON, every number the site computes from a history file, using
// the site's own assets/js/stats.js. tests/test_site_numbers.py runs this and
// checks each number against the same calculation done in Python.
//
//   node scripts/site_numbers.mjs data/history.csv
import { readFileSync } from "node:fs";
import {
  toRows, datesOf, compare, moves, leaders, LEADER_STATS, scoringRace, risersFallers, dailyMoves,
  leagueShooting, teamScoring,
} from "../assets/js/stats.js";

// The same RFC 4180 parser as assets/js/common.js (which needs a browser to import).
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...lines] = parseCSV(readFileSync(process.argv[2], "utf8"));
const rows = toRows(lines.filter((c) => c.length === header.length)
  .map((c) => Object.fromEntries(header.map((k, i) => [k, c[i]]))));
const dates = datesOf(rows);
const day = dates[dates.length - 1] ?? null;
const today = rows.filter((r) => r.date === day);
const cmp = day ? compare(rows, day) : null;

const out = {
  dates,
  rows: rows.length,
  today: day && {
    previous: cmp.previous,
    appeared: cmp.appeared.map((r) => r.item_id),
    gone: cmp.gone.map((r) => r.item_id),
    moves: moves(cmp).map((m) => [m.item_id, m.old, m.new, m.change]),
    leaders: Object.fromEntries(LEADER_STATS.map((s) => [s, leaders(today, s, 5).map((r) => [r.item_id, r[s]])])),
  },
  race: (() => { const r = scoringRace(rows); return { perDay: r.perDay.map((p) => [p.date, p.item_id, p.points]), daysLed: r.daysLed, top5: r.top5.map((x) => x.item_id) }; })(),
  risers: (() => { const r = risersFallers(rows); return { first: r.first, last: r.last, list: r.list.map((m) => [m.item_id, m.old, m.new, m.change]) }; })(),
  daily: (() => { const d = dailyMoves(rows); return { perDay: d.perDay.map((p) => [p.date, p.top && p.top.item_id, p.top && p.top.change, p.movers, p.played]), best: d.best && d.best.date }; })(),
  shooting: leagueShooting(rows).map((x) => [x.date, x.teams, x.fg3m, x.fg3a, x.fg3_pct, x.fg_pct, x.fg3a_per_game, x.games]),
  teams: (() => { const t = teamScoring(rows); return { date: t.date, list: t.list.map((r) => [r.item_id, r.points, r.first]) }; })(),
};
process.stdout.write(JSON.stringify(out));

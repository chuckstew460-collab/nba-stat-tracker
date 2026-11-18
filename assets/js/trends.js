// Trends page: a report on the history. Every number is computed here, in the
// browser, from data/history.csv (with the functions in stats.js), so the page
// changes as the history grows.
import {
  h, icon, initChrome, loadHistory, errorBox, emptyState, fmt, fmtDay, fmtStat, fmtSigned, plural,
  shortlist, store,
} from "./common.js";
import { lines, hbars, columns, tableView, SERIES } from "./charts.js";
import {
  STATS, STAT, MOVE_MIN_GAMES, datesOf, leaders, scoringRace, risersFallers, dailyMoves, leagueShooting,
  teamScoring, cmpStr,
} from "./stats.js";

initChrome("trends.html");
const app = document.getElementById("app");
const qualifiedNote = "Qualified means at least 70% of the team's games played (the NBA's 58-of-82 rule, prorated).";


try {
  render(await loadHistory());
} catch (err) {
  console.error(err);
  app.replaceChildren(errorBox(err));
}

function render(rows) {
  const dates = datesOf(rows);
  if (!dates.length) { app.replaceChildren(emptyState("No history yet.")); return; }
  const first = dates[0], last = dates[dates.length - 1];
  app.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow", text: `Trends · ${plural(dates.length, "day")} of history` }),
        h("h1", { text: "How the season is moving" }),
        h("p", { class: "lede", text: `${dates.length === 1 ? `One day of history, ${fmtDay(first)}` : `From ${fmtDay(first)} to ${fmtDay(last)}`}, `
          + `${fmt(rows.length)} rows. Every number on this page is computed in your browser from data/history.csv, `
          + "so the findings update as the history grows." }))),
    explorer(rows, dates),
    findingScoringRace(rows, dates),
    findingRisers(rows, dates),
    findingBiggestDay(rows, dates),
    findingShooting(rows, dates),
    findingTeams(rows));
}

function finding(n, title, paragraphs, chart, table) {
  return h("section", { class: "card finding" },
    h("div", { class: "f-head" }, h("div", { class: "f-num", text: `Finding ${n}` }), h("h2", { text: title })),
    h("div", { class: "f-body" }, paragraphs.map((p) => (typeof p === "string" ? h("p", { text: p }) : p))),
    chart ? h("div", { class: "f-chart" }, chart) : null,
    table || null);
}

// ------------------------------------------------------------------ explorer: any stat, chosen items
function explorer(rows, dates) {
  const saved = store("nst-trends") || {};
  const state = { stat: STAT[saved.stat] ? saved.stat : "points", kind: saved.kind === "team" ? "team" : "player",
                  picked: [] /* [{id, slot}] */ };
  const lastDay = dates[dates.length - 1];
  const latest = rows.filter((r) => r.date === lastDay);
  const names = {};
  for (const r of rows) names[r.item_id] = r;   // latest row per item wins (rows are date-sorted)

  const statSel = h("select", {}, STATS.map((s) => h("option", { value: s.key, text: s.label })));
  statSel.value = state.stat;
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Items" });
  const listId = "trend-items";
  const picker = h("input", { type: "search", list: listId, placeholder: "Add a player or team…", "aria-label": "Add an item to the chart" });
  const datalist = h("datalist", { id: listId });
  const chips = h("div", { class: "chips" });
  const chartBox = h("div", {});
  const tableBox = h("div", {});

  function defaults() {
    const starred = shortlist.ids().filter((id) => names[id] && names[id].kind === state.kind).slice(0, 8);
    if (starred.length) return starred;
    if (state.kind === "player") return leaders(latest, "points", 5).map((r) => r.item_id);
    return latest.filter((r) => r.kind === "team").sort((a, b) => b.points - a.points || cmpStr(a.item_id, b.item_id))
      .slice(0, 5).map((r) => r.item_id);
  }
  function setPicked(ids) { state.picked = ids.slice(0, 8).map((id, i) => ({ id, slot: i })); }
  function add(id) {
    if (!id || state.picked.some((p) => p.id === id) || state.picked.length >= 8) return;
    const used = new Set(state.picked.map((p) => p.slot));
    const slot = [0, 1, 2, 3, 4, 5, 6, 7].find((s) => !used.has(s));
    state.picked.push({ id, slot });
    paint();
  }
  function remove(id) { state.picked = state.picked.filter((p) => p.id !== id); paint(); }

  const label = (r) => (r.kind === "player" ? `${r.item} · ${r.team}` : r.item);
  function paintOptions() {
    const pool = Object.values(names).filter((r) => r.kind === state.kind).sort((a, b) => cmpStr(a.item, b.item));
    datalist.replaceChildren(...pool.map((r) => h("option", { value: label(r) })));
  }
  picker.addEventListener("change", () => {
    const v = picker.value.trim().toLowerCase();
    const hit = Object.values(names).find((r) => r.kind === state.kind && (label(r).toLowerCase() === v || r.item.toLowerCase() === v));
    if (hit) { add(hit.item_id); picker.value = ""; }
  });

  function paint() {
    store("nst-trends", { stat: state.stat, kind: state.kind });
    seg.replaceChildren(...[["player", "Players"], ["team", "Teams"]].map(([k, t]) =>
      h("button", { type: "button", "aria-pressed": state.kind === k ? "true" : "false", text: t,
                    onclick: () => { if (state.kind !== k) { state.kind = k; setPicked(defaults()); paintOptions(); paint(); } } })));
    const meta = STAT[state.stat];
    chips.replaceChildren(
      ...state.picked.map((p) => h("span", { class: "chip" },
        h("span", { class: "key", style: `background:${SERIES[p.slot]}` }), names[p.id] ? label(names[p.id]) : p.id,
        h("button", { type: "button", "aria-label": `Remove ${names[p.id]?.item || p.id}`, onclick: () => remove(p.id) }, icon("x")))),
      h("button", { class: "btn", type: "button", text: "Reset", onclick: () => { setPicked(defaults()); paint(); } }),
      h("span", { class: "muted small", text: state.picked.length >= 8 ? "8 items at most." : "" }));
    if (!state.picked.length) {
      chartBox.replaceChildren(emptyState("Pick at least one item."));
      tableBox.replaceChildren();
      return;
    }
    const byKey = new Map(rows.map((r) => [`${r.date}|${r.item_id}`, r]));
    const series = state.picked.map((p) => ({
      name: names[p.id] ? names[p.id].item : p.id, color: SERIES[p.slot],
      values: dates.map((d) => byKey.get(`${d}|${p.id}`)?.[state.stat] ?? null),
    }));
    lines(chartBox, { dates, series, digits: meta.digits, ariaLabel: `${meta.label} by day` });
    tableBox.replaceChildren(tableView(
      [{ key: "date", label: "Date" }, ...series.map((sr, i) => ({ key: `s${i}`, label: sr.name, num: true, digits: meta.digits }))],
      dates.map((d, di) => Object.fromEntries([["date", d], ...series.map((sr, i) => [`s${i}`, sr.values[di]])]))));
  }
  statSel.addEventListener("change", () => { state.stat = statSel.value; paint(); });
  setPicked(defaults());
  paintOptions();
  paint();

  return h("section", { class: "card explorer" },
    h("div", { class: "f-head", style: "padding:18px 20px 0" },
      h("div", { class: "f-num", text: "Explorer" }),
      h("h2", { text: "Any stat, day by day" }),
      h("p", { class: "muted", style: "margin-top:6px", text: "Pick a stat and up to 8 players or teams. "
        + "It starts with your shortlist (from Browse) or, without one, the current top 5." })),
    h("div", { class: "controls" },
      h("label", { class: "field" }, "Stat", statSel),
      h("div", { class: "field" }, "Items", seg),
      h("label", { class: "field" }, "Add", picker), datalist),
    chips, chartBox, tableBox);
}

// ------------------------------------------------------------------ 1. scoring race
function findingScoringRace(rows, dates) {
  const race = scoringRace(rows);
  if (!race.last) return finding(1, "No qualified scorer yet", ["The history has no qualified player yet."]);
  const { last, daysLed, totalDays, top5 } = race;
  const second = top5[1];
  const title = totalDays === 1
    ? `${last.item} leads the league in scoring at ${fmtStat(last.points)} points per game`
    : `${last.item} leads the scoring race at ${fmtStat(last.points)} points per game, on top ${daysLed} of ${totalDays} days`;
  const leadersSeen = [...new Set(race.perDay.map((p) => p.item))];
  const paras = [
    h("p", {}, `On ${fmtDay(last.date)}, `, h("strong", { text: `${last.item} (${last.team})` }),
      ` averages ${fmtStat(last.points)} points`,
      second ? `, ${fmtStat(last.points - second.points)} ahead of ${second.item} (${fmtStat(second.points)}). ` : ". ",
      totalDays > 1 ? `${leadersSeen.length === 1 ? "Nobody else has led on any day of the history." : `${leadersSeen.length} players have led on at least one day: ${leadersSeen.join(", ")}.`}` : ""),
    h("p", { class: "method", text: `How it's computed: for each date in history.csv, take the player rows that qualify and pick the highest points per game (ties go to the lower item_id). ${qualifiedNote} The chart follows today's top 5 on every date of the history.` }),
  ];
  const byKey = new Map(rows.map((r) => [`${r.date}|${r.item_id}`, r]));
  const series = top5.map((r, i) => ({ name: r.item, color: SERIES[i],
    values: dates.map((d) => byKey.get(`${d}|${r.item_id}`)?.points ?? null) }));
  const chart = h("div", {});
  lines(chart, { dates, series, ariaLabel: "Points per game of the current top 5 scorers by day" });
  return finding(1, title, paras, chart, tableView(
    [{ key: "date", label: "Date" }, { key: "item", label: "Leader" }, { key: "team", label: "Team" },
     { key: "points", label: "PPG", num: true }],
    race.perDay, "Show the leader on each day"));
}

// ------------------------------------------------------------------ 2. risers and fallers
function findingRisers(rows, dates) {
  const rf = risersFallers(rows);
  if (rf.list.length < 2) {
    return finding(2, "Risers and fallers show up once there are two days of history",
      [`So far the history covers ${fmtDay(dates[0])} only. This section compares each player's points per game on the first day with the latest day.`]);
  }
  const up = rf.list[0], down = rf.list[rf.list.length - 1];
  const rose = rf.list.filter((m) => m.change > 0).length, fell = rf.list.filter((m) => m.change < 0).length;
  const title = up.change > 0
    ? `${up.item} is the biggest riser since ${fmtDay(rf.first)}: ${fmtSigned(up.change)} points per game`
    : `No player's scoring has risen since ${fmtDay(rf.first)}`;
  const paras = [
    h("p", {}, h("strong", { text: up.item }), ` went from ${fmtStat(up.old)} to ${fmtStat(up.new)} points per game (${up.old_games} → ${up.new_games} games). `,
      down.change < 0 ? h("span", {}, "The biggest drop is ", h("strong", { text: down.item }), `: ${fmtStat(down.old)} → ${fmtStat(down.new)} (${fmtSigned(down.change)}). `) : "",
      `Of ${plural(rf.list.length, "player")} compared, ${rose} rose, ${fell} fell and ${rf.list.length - rose - fell} held steady.`),
    h("p", { class: "method", text: `How it's computed: for every player with rows on both the first date (${rf.first}) and the latest date (${rf.last}) of history.csv and at least ${MOVE_MIN_GAMES} games on both, change = points per game on ${rf.last} minus on ${rf.first}. The chart shows the 5 largest rises and the 5 largest drops.` }),
  ];
  const top = rf.list.slice(0, 5).filter((m) => m.change > 0);
  const bottom = rf.list.slice(-5).filter((m) => m.change < 0 && !top.includes(m));
  const items = [...top, ...bottom].map((m) => ({ label: m.item, note: `${m.team} · ${fmtStat(m.old)} → ${fmtStat(m.new)}`, value: m.change,
    extra: [{ value: `${fmtStat(m.old)} → ${fmtStat(m.new)}`, label: "PPG" }] }));
  const chart = h("div", {});
  hbars(chart, { items, signed: true, name: "change in PPG" });
  return finding(2, title, paras, chart, tableView(
    [{ key: "item", label: "Player" }, { key: "team", label: "Team" }, { key: "old", label: `PPG ${fmtDay(rf.first)}`, num: true },
     { key: "new", label: `PPG ${fmtDay(rf.last)}`, num: true }, { key: "change", label: "Change", num: true, signed: true }],
    rf.list, `Show all ${rf.list.length} players`));
}

// ------------------------------------------------------------------ 3. biggest one-day move
function findingBiggestDay(rows, dates) {
  const dm = dailyMoves(rows);
  if (!dm.best) {
    return finding(3, "The biggest one-day move shows up after the second run",
      ["Each run is compared with the one before it. With one day of history there is nothing to compare yet."]);
  }
  const b = dm.best, m = b.top;
  const avgPlayed = dm.perDay.reduce((s, p) => s + p.played, 0) / dm.perDay.length;
  const title = `${fmtDay(b.date)} brought the biggest one-day move: ${m.item}, ${fmtSigned(m.change)} points per game`;
  const paras = [
    h("p", {}, h("strong", { text: `${m.item} (${m.team})` }),
      ` went from ${fmtStat(m.old)} to ${fmtStat(m.new)} points per game between ${fmtDay(m.old_date)} and ${fmtDay(b.date)} (${m.old_games} → ${m.new_games} games). `
      + `That day ${plural(b.played, "player")} had played since the previous run and ${b.movers} moved. `
      + `Across ${plural(dm.perDay.length, "run")}, an average of ${fmtStat(avgPlayed)} players played between runs.`),
    h("p", { class: "method", text: `How it's computed: each date is compared with the previous date its source has rows for, under the move rule (points per game now minus then; players with at least ${MOVE_MIN_GAMES} games; moves of 0 left out). Each bar is the largest move of that day, by size; the highlighted bar is the largest of all.` }),
  ];
  const chart = h("div", {});
  columns(chart, {
    days: dm.perDay.map((p) => ({ date: p.date, value: p.top ? Math.abs(p.top.change) : 0,
      extra: p.top ? [{ value: `${p.top.item} ${fmtSigned(p.top.change)}`, label: "" }, { value: String(p.played), label: "players played" }] : [] })),
    name: "largest move (PPG)", highlight: (d) => d.date === b.date, ariaLabel: "Largest one-day move in points per game, by day",
  });
  return finding(3, title, paras, chart, tableView(
    [{ key: "date", label: "Date" }, { key: "item", label: "Largest move" }, { key: "old", label: "Old PPG", num: true },
     { key: "new", label: "New PPG", num: true }, { key: "change", label: "Move", num: true, signed: true },
     { key: "movers", label: "Players who moved", num: true, digits: 0 }, { key: "played", label: "Players who played", num: true, digits: 0 }],
    dm.perDay.map((p) => ({ date: p.date, item: p.top?.item ?? "–", old: p.top?.old, new: p.top?.new, change: p.top?.change,
                            movers: p.movers, played: p.played }))));
}

// ------------------------------------------------------------------ 4. league three-point shooting
function findingShooting(rows) {
  const ls = leagueShooting(rows);
  if (!ls.length) return finding(4, "League shooting needs the team source", ["No team rows in the history yet."]);
  const a = ls[0], b = ls[ls.length - 1];
  const diff = b.fg3_pct - a.fg3_pct;
  const title = ls.length === 1
    ? `The league is making ${fmtStat(b.fg3_pct)}% of its threes on ${fmtStat(b.fg3a_per_game)} attempts a game`
    : Math.abs(diff) < 0.05
      ? `League 3-point shooting has held at ${fmtStat(b.fg3_pct)}% since ${fmtDay(a.date)}`
      : `League 3-point shooting is ${diff > 0 ? "up" : "down"} ${fmtStat(Math.abs(diff))} points since ${fmtDay(a.date)}, to ${fmtStat(b.fg3_pct)}%`;
  const paras = [
    h("p", {}, `On ${fmtDay(b.date)} the ${b.teams} teams have made `, h("strong", { text: fmt(b.fg3m) }), ` of `,
      h("strong", { text: fmt(b.fg3a) }), ` threes (${fmtStat(b.fg3_pct)}%) over ${fmt(b.games)} team games, `
      + `${fmtStat(b.fg3a_per_game)} attempts per team per game. Overall field goal shooting is ${fmtStat(b.fg_pct)}%.`
      + (ls.length > 1 ? ` On ${fmtDay(a.date)} it was ${fmtStat(a.fg3_pct)}% from three on ${fmt(a.fg3a)} attempts.` : "")),
    h("p", { class: "method", text: "How it's computed: for each date, from the team rows of history.csv, league 3P% = 100 × sum of fg3m ÷ sum of fg3a, "
      + "and attempts per game = sum of fg3a ÷ sum of games. Summing makes and attempts weights every shot equally, unlike averaging the 30 team percentages." }),
  ];
  const chart = h("div", {});
  lines(chart, { dates: ls.map((x) => x.date), series: [{ name: "League 3P%", color: SERIES[0], values: ls.map((x) => x.fg3_pct) }],
                 unit: "%", ariaLabel: "League 3-point percentage by day" });
  return finding(4, title, paras, chart, tableView(
    [{ key: "date", label: "Date" }, { key: "fg3m", label: "3PM", num: true, digits: 0 }, { key: "fg3a", label: "3PA", num: true, digits: 0 },
     { key: "fg3_pct", label: "3P%", num: true }, { key: "fg3a_per_game", label: "3PA per team game", num: true },
     { key: "fg_pct", label: "FG%", num: true }, { key: "games", label: "Team games", num: true, digits: 0 }], ls));
}

// ------------------------------------------------------------------ 5. team offenses
function findingTeams(rows) {
  const ts = teamScoring(rows);
  if (!ts.list.length) return finding(5, "Team scoring needs the team source", ["No team rows in the history yet."]);
  const best = ts.list[0], worst = ts.list[ts.list.length - 1];
  const avg = ts.list.reduce((s, r) => s + r.points, 0) / ts.list.length;
  const above = ts.list.filter((r) => r.points > avg).length;
  const title = `The ${best.item} score the most, ${fmtStat(best.points)} a game, ${fmtStat(best.points - worst.points)} more than the ${worst.item}`;
  const paras = [
    h("p", {}, `On ${fmtDay(ts.date)} the average team scores ${fmtStat(avg)} points per game; ${above} of ${ts.list.length} teams are above it. `,
      h("strong", { text: best.item }), ` lead at ${fmtStat(best.points)}`,
      ts.first !== ts.date && best.first != null ? ` (${fmtStat(best.first)} on ${fmtDay(ts.first)})` : "",
      "; ", h("strong", { text: worst.item }), ` trail at ${fmtStat(worst.points)}.`),
    h("p", { class: "method", text: "How it's computed: the points column of every team row on the latest date with team rows in history.csv, sorted high to low. "
      + "The average is the plain mean of the teams' points per game." }),
  ];
  const chart = h("div", {});
  hbars(chart, { items: ts.list.map((r) => ({ label: r.item, note: `${r.games} games`, value: r.points,
    extra: r.first != null && ts.first !== ts.date ? [{ value: fmtStat(r.first), label: `on ${fmtDay(ts.first)}` }] : [] })),
    name: "points per game" });
  return finding(5, title, paras, chart, tableView(
    [{ key: "item", label: "Team" }, { key: "points", label: "PPG", num: true }, { key: "games", label: "Games", num: true, digits: 0 },
     { key: "first", label: `PPG ${fmtDay(ts.first)}`, num: true }], ts.list));
}

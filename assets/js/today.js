// Today page: the last run, every source's status, the counts from the status
// file, the league leaders, the biggest moves since the previous run, and the
// latest values of every item with their change.
import {
  h, icon, initChrome, loadHistory, loadStatus, errorBox, emptyState, fmt, fmtDay, fmtWeekday,
  fmtRunTime, relTime, fmtStat, fmtSigned, delta, plural, starButton, store,
} from "./common.js";
import {
  STATS, STAT, LEADER_STATS, MOVE_LIMIT, MOVE_MIN_GAMES, compare, moves, changes, leaders, teamGames,
  minimumText, datesOf, cmpStr,
} from "./stats.js";

initChrome("index.html");
const app = document.getElementById("app");

try {
  const [status, rows] = await Promise.all([loadStatus(), loadHistory()]);
  render(status, rows);
} catch (err) {
  console.error(err);
  app.replaceChildren(errorBox(err));
}

function render(status, rows) {
  const dates = datesOf(rows);
  const day = dates[dates.length - 1];
  if (!day) {
    app.replaceChildren(head(status), emptyState("No data yet: the first run has not saved any rows."));
    return;
  }
  const today = rows.filter((r) => r.date === day);
  const cmp = compare(rows, day);
  const ch = changes(cmp);
  const prevDates = [...new Set(Object.values(cmp.previous).filter(Boolean))].sort();

  app.replaceChildren(
    head(status, day),
    tiles(status, today),
    sourcesSection(status),
    leadersSection(today, ch, day, prevDates),
    movesSection(cmp, prevDates),
    listsSection(cmp),
    allItemsSection(today, ch, prevDates),
  );
}

// ------------------------------------------------------------------ header + counts
function head(status, day) {
  const t = fmtRunTime(status.run_time);
  const stale = day && status.run_date !== day;
  return h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow", text: day ? `Today · ${fmtWeekday(day)}` : "Today" }),
      h("h1", { text: "League leaders" }),
      h("p", { class: "lede", text: "Season averages for every NBA player and team, pulled from ESPN once a day. "
        + "Leaders follow the NBA's minimums, prorated to the games played so far." }),
      stale ? h("p", { class: "note", text: `The latest run (${status.run_date}) saved no rows; showing ${day}.` }) : null),
    h("div", { class: "runline" },
      h("span", {}, "Last run ", h("strong", { text: t.local }), ` (${t.utc}) · ${relTime(status.run_time)}`)));
}

function tile(label, value, sub) {
  return h("div", { class: "card tile" },
    h("div", { class: "label", text: label }),
    h("div", { class: "value", text: value }),
    sub ? h("div", { class: "sub", text: sub }) : null);
}

function tiles(status, today) {
  const players = today.filter((r) => r.kind === "player").length;
  const teams = today.filter((r) => r.kind === "team").length;
  const ok = status.sources.filter((s) => s.ok).length;
  return h("div", { class: "tiles" },
    tile("Items in the latest run", fmt(status.items), `${fmt(players)} players · ${fmt(teams)} teams`),
    tile("New today", fmt(status.new_today), "appeared since the previous run"),
    tile("Gone today", fmt(status.gone_today), "no longer listed"),
    tile("Days with a successful run", fmt(status.days_with_success),
         status.first_run_date ? `since ${fmtDay(status.first_run_date)}` : ""),
    tile("Sources ok", `${ok}/${status.sources.length}`, ok === status.sources.length ? "all answered" : "see below"));
}

function sourcesSection(status) {
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", { text: "Sources" }),
      h("p", { text: "Each source is one request a day. A failed source writes no raw file and the run goes on." })),
    h("div", { class: "sources" }, status.sources.map((s) =>
      h("div", { class: `card source ${s.ok ? "ok" : "fail"}` },
        icon(s.ok ? "check" : "cross"),
        h("div", { class: "name" }, s.name, h("span", { class: "sr-only", text: s.ok ? " ok" : " failed" })),
        h("div", { class: "count", text: s.ok ? fmt(s.count) : "0" }),
        h("div", { class: "meta", text: s.ok ? `${s.format.toUpperCase()} · ${s.count} items · ok`
          : `Failed: ${s.error || "no answer"}` })))));
}

// ------------------------------------------------------------------ leaders
function leadersSection(today, ch, day, prevDates) {
  const tg = teamGames(today);
  const games = Object.values(tg);
  const typical = games.length ? Math.round(games.reduce((a, b) => a + b, 0) / games.length) : 0;
  const cards = LEADER_STATS.map((stat) => {
    const meta = STAT[stat];
    const top = leaders(today, stat, 5, tg);
    const qualified = leaders(today, stat, 0, tg).length;
    if (!top.length) return h("div", { class: "card leader" }, h("div", { class: "lc-head" }, h("span", { class: "lc-cat", text: meta.label })), emptyState("No qualified player yet."));
    const [first, ...rest] = top;
    const d = (r) => (ch[r.item_id] ? ch[r.item_id][stat] : null);
    return h("article", { class: "card leader", "aria-label": `${meta.label} leaders` },
      h("div", { class: "lc-head" },
        h("span", { class: "lc-cat", text: meta.label }),
        h("span", { class: "lc-min", text: `${qualified} qualified` })),
      h("div", { class: "lc-top" },
        h("div", {},
          h("div", { class: "lc-name", text: first.item }),
          h("div", { class: "lc-team", text: `${first.team} · ${first.position} · ${first.games} games` })),
        h("div", { class: "lc-value" }, fmtStat(first[stat], meta.digits), delta(d(first), { quiet: true }))),
      h("ol", { start: 2 }, rest.map((r, i) => h("li", {},
        h("span", { class: "rk", text: i + 2 }),
        h("span", { class: "nm" }, r.item, h("small", { text: r.team })),
        h("span", { class: "v", text: fmtStat(r[stat], meta.digits) }),
        delta(d(r), { quiet: true })))));
  });
  const note = prevDates.length
    ? `Arrows show the change since the previous run (${prevDates.map(fmtDay).join(", ")}).`
    : "Arrows appear after the second run.";
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", { text: `Leaders on ${fmtDay(day)}` }),
      h("p", { text: `To qualify after about ${typical} team games: per-game stats need ${minimumText("points", typical)}; `
        + `FG% ${minimumText("fg_pct", typical)}, 3P% ${minimumText("fg3_pct", typical)}, FT% ${minimumText("ft_pct", typical)}. ${note}` })),
    h("div", { class: "leaders" }, cards));
}

// ------------------------------------------------------------------ biggest moves
function movesSection(cmp, prevDates) {
  const state = { stat: store("nst-move-stat") || "points", kind: "" };
  const statSel = h("select", { id: "move-stat" }, STATS.map((s) => h("option", { value: s.key, text: s.label })));
  statSel.value = STAT[state.stat] ? state.stat : "points";
  const kinds = [["", "All"], ["player", "Players"], ["team", "Teams"]];
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Show" });
  const body = h("div", {});

  const paint = () => {
    const stat = statSel.value;
    const meta = STAT[stat];
    seg.replaceChildren(...kinds.map(([k, label]) => h("button", { type: "button", "aria-pressed": state.kind === k ? "true" : "false",
      text: label, onclick: () => { state.kind = k; paint(); } })));
    if (!prevDates.length) {
      body.replaceChildren(emptyState("First run: the biggest moves appear after the second run."));
      return;
    }
    const list = moves(cmp, stat, { kind: state.kind || null });
    if (!list.length) {
      body.replaceChildren(emptyState(`No item with at least ${MOVE_MIN_GAMES} games changed its ${meta.label.toLowerCase()} since the previous run.`));
      return;
    }
    body.replaceChildren(h("div", { class: "scroll" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        h("th", { class: "n", text: "#" }), h("th", { text: "Item" }), h("th", { text: "Team" }),
        h("th", { class: "n", text: `Old ${meta.short}` }), h("th", { class: "n", text: `New ${meta.short}` }),
        h("th", { class: "n", text: "Move" }), h("th", { class: "n", text: "Games" }))),
      h("tbody", {}, list.map((m, i) => h("tr", {},
        h("td", { class: "n rank", text: i + 1 }),
        h("td", { class: "name", text: m.item }),
        h("td", { text: m.kind === "team" ? "Team" : m.team }),
        h("td", { class: "n", text: fmtStat(m.old, meta.digits) }),
        h("td", { class: "n", text: fmtStat(m.new, meta.digits) }),
        h("td", { class: `n ${(meta.lowerIsBetter ? m.change < 0 : m.change > 0) ? "change-up" : "change-down"}`,
                  text: fmtSigned(m.change, meta.digits) }),
        h("td", { class: "n", text: `${m.old_games} → ${m.new_games}` })))))));
  };
  statSel.addEventListener("change", () => { store("nst-move-stat", statSel.value); paint(); });
  paint();

  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", { text: "Biggest moves since the previous run" }),
      h("p", { text: prevDates.length ? `Compared with ${prevDates.map(fmtDay).join(", ")}.` : "" })),
    h("div", { class: "card" },
      h("div", { class: "controls pad", style: "margin:0" },
        h("label", { class: "field" }, "Stat", statSel),
        h("div", { class: "field" }, "Show", seg)),
      body,
      h("p", { class: "rule", text: `Move rule: the value now minus the value at the item's previous run. Items with fewer than `
        + `${MOVE_MIN_GAMES} games are left out, and so are moves of 0; the ${MOVE_LIMIT} largest by size are listed, `
        + `ties broken by item_id. The daily GitHub issue uses points per game, all items.` })));
}

// ------------------------------------------------------------------ appeared / gone
function listsSection(cmp) {
  const list = (title, items, empty) => h("div", { class: "card" },
    h("h3", { text: `${title} (${items.length})` }),
    items.length
      ? h("ul", {}, items.map((r) => h("li", {}, h("span", { text: r.item }),
          h("span", { class: "muted small", text: r.kind === "team" ? "team" : `${r.team} · ${r.position}` }))))
      : emptyState(empty));
  const first = !Object.values(cmp.previous).some(Boolean);
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", { text: "Appeared and disappeared" }),
      h("p", { text: "A player appears the first time ESPN lists him this season (usually his first game) and disappears if ESPN drops him." })),
    h("div", { class: "lists" },
      list("Appeared", cmp.appeared, first ? "First run: nothing to compare with yet." : "Nobody new today."),
      list("Disappeared", cmp.gone, first ? "First run: nothing to compare with yet." : "Nobody left the list today.")));
}

// ------------------------------------------------------------------ every item, latest values
function allItemsSection(today, ch, prevDates) {
  const cols = ["games", "minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers", "fg_pct", "fg3_pct", "ft_pct"];
  const state = { kind: "player", sort: "points" };
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Show" });
  const sortSel = h("select", {}, cols.map((c) => h("option", { value: c, text: STAT[c].label })));
  sortSel.value = state.sort;
  const count = h("span", { class: "result-count" });
  const holder = h("div", { class: "scroll tall" });

  const paint = () => {
    seg.replaceChildren(...[["player", "Players"], ["team", "Teams"]].map(([k, label]) =>
      h("button", { type: "button", "aria-pressed": state.kind === k ? "true" : "false", text: label,
                    onclick: () => { state.kind = k; paint(); } })));
    const stat = sortSel.value;
    const list = today.filter((r) => r.kind === state.kind)
      .sort((a, b) => (b[stat] ?? -Infinity) - (a[stat] ?? -Infinity) || cmpStr(a.item_id, b.item_id));
    count.textContent = `${plural(list.length, state.kind === "team" ? "team" : "player")} · sorted by ${STAT[stat].label.toLowerCase()}`;
    const shown = state.kind === "team" ? cols.filter((c) => c !== "minutes") : cols;
    holder.replaceChildren(h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        h("th", { "aria-label": "Shortlist" }), h("th", { text: state.kind === "team" ? "Team" : "Player" }),
        state.kind === "player" ? [h("th", { text: "Team" }), h("th", { text: "Pos" })] : null,
        shown.map((c) => h("th", { class: `n${c === stat ? " hl" : ""}`, title: STAT[c].label, text: STAT[c].short })))),
      h("tbody", {}, list.map((r) => h("tr", {},
        h("td", {}, starButton(r)),
        h("td", { class: "name", text: r.item }),
        state.kind === "player" ? [h("td", { text: r.team }), h("td", { text: r.position })] : null,
        shown.map((c) => h("td", { class: `n${c === stat ? " hl" : ""}` },
          h("span", { class: "cell-stack" }, fmtStat(r[c], STAT[c].digits),
            prevDates.length ? delta(ch[r.item_id] ? ch[r.item_id][c] : null,
              { digits: STAT[c].digits || 0, lowerIsBetter: STAT[c].lowerIsBetter, quiet: true }) : null))))))));
  };
  sortSel.addEventListener("change", paint);
  paint();

  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", { text: "Every player and team" }),
      h("p", { text: prevDates.length ? "Latest values; the small arrows are the change since the previous run."
        : "Latest values. Changes appear after the second run." })),
    h("div", { class: "card" },
      h("div", { class: "controls pad", style: "margin:0" },
        h("div", { class: "field" }, "Show", seg),
        h("label", { class: "field" }, "Sort by", sortSel), count),
      holder));
}

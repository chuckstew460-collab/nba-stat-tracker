// Browse page: the latest values for every item, with filters (kind, team,
// position, minimum games, shortlist), a name search, a sort on every numeric
// column in both directions, and a star that saves an item to a shortlist kept
// in this browser.
import {
  h, icon, initChrome, loadHistory, errorBox, emptyState, fmt, fmtDay, fmtStat, plural, starButton,
  shortlist, store,
} from "./common.js";
import { STATS, STAT, datesOf, cmpStr } from "./stats.js";

initChrome("browse.html");
const app = document.getElementById("app");
const KEY = "nst-browse";
const COLS = ["games", "minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers",
              "fg_pct", "fg3_pct", "ft_pct", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta",
              "double_doubles", "triple_doubles"];

try {
  render(await loadHistory());
} catch (err) {
  console.error(err);
  app.replaceChildren(errorBox(err));
}

function render(rows) {
  const dates = datesOf(rows);
  const day = dates[dates.length - 1];
  if (!day) { app.replaceChildren(emptyState("No data yet.")); return; }
  const latest = rows.filter((r) => r.date === day);
  const teams = [...new Set(latest.map((r) => r.team).filter(Boolean))].sort(cmpStr);
  const teamNames = Object.fromEntries(latest.filter((r) => r.kind === "team").map((r) => [r.team, r.item]));
  const positions = [...new Set(latest.map((r) => r.position).filter(Boolean))].sort(cmpStr);

  const saved = store(KEY) || {};
  const state = {
    q: "", kind: saved.kind ?? "player", team: saved.team ?? "", position: saved.position ?? "",
    minGames: saved.minGames ?? 0, starred: false,
    sort: STAT[saved.sort] ? saved.sort : "points", dir: saved.dir === "asc" ? "asc" : "desc",
  };
  const save = () => store(KEY, { kind: state.kind, team: state.team, position: state.position,
                                  minGames: state.minGames, sort: state.sort, dir: state.dir });

  // ---------------------------------------------------------------- controls
  const search = h("input", { type: "search", placeholder: "Player or team name", "aria-label": "Search names",
                              autocomplete: "off" });
  const kindSel = h("select", {}, [["", "Players and teams"], ["player", "Players"], ["team", "Teams"]]
    .map(([v, t]) => h("option", { value: v, text: t })));
  const teamSel = h("select", {}, h("option", { value: "", text: "All teams" }),
    teams.map((t) => h("option", { value: t, text: teamNames[t] ? `${t} · ${teamNames[t]}` : t })));
  const posSel = h("select", {}, h("option", { value: "", text: "All positions" }),
    positions.map((p) => h("option", { value: p, text: { G: "Guards (G)", F: "Forwards (F)", C: "Centers (C)" }[p] || p })));
  const minInput = h("input", { type: "number", min: 0, max: 82, step: 1, inputmode: "numeric", "aria-label": "Minimum games" });
  const sortSel = h("select", {}, COLS.map((c) => h("option", { value: c, text: STAT[c].label })));
  const dirBtn = h("button", { class: "btn", type: "button" });
  const starOnly = h("input", { type: "checkbox" });
  const count = h("span", { class: "result-count", "aria-live": "polite" });
  kindSel.value = state.kind; teamSel.value = state.team; posSel.value = state.position;
  minInput.value = state.minGames; sortSel.value = state.sort;

  const shortBar = h("div", { class: "card shortlist-bar" });
  const tableHolder = h("div", { class: "scroll tall" });

  app.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow", text: `Browse · stats through ${fmtDay(day)}` }),
        h("h1", { text: "Every player and team" }),
        h("p", { class: "lede", text: "Filter by kind, team, position and games played, search by name, and sort any column. "
          + "Star a row to keep it on your shortlist; it stays in this browser and shows up on the Trends chart." }))),
    shortBar,
    h("div", { class: "controls" },
      h("label", { class: "field" }, "Search", search),
      h("label", { class: "field" }, "Kind", kindSel),
      h("label", { class: "field" }, "Team", teamSel),
      h("label", { class: "field" }, "Position", posSel),
      h("label", { class: "field" }, "Min games", minInput),
      h("label", { class: "field" }, "Sort by", h("span", { style: "display:flex;gap:6px" }, sortSel, dirBtn)),
      h("label", { class: "check" }, starOnly, "Shortlist only"),
      count),
    h("div", { class: "card" }, tableHolder));

  // ---------------------------------------------------------------- shortlist bar
  function paintShortlist() {
    const list = shortlist.all();
    const ids = Object.keys(list).sort((a, b) => cmpStr(list[a].item, list[b].item));
    shortBar.replaceChildren(
      h("strong", {}, "Shortlist"),
      ids.length
        ? h("div", { class: "chips" }, ids.map((id) => h("span", { class: "chip" },
            list[id].item, list[id].kind === "player" ? h("small", { class: "muted", text: list[id].team }) : null,
            h("button", { type: "button", "aria-label": `Remove ${list[id].item}`, title: "Remove",
                          onclick: () => { shortlist.toggle({ item_id: id, ...list[id] }); } }, icon("x")))))
        : h("span", { class: "muted small", text: "Nothing starred yet. Tap ☆ on any row." }),
      ...(ids.length ? [h("button", { class: "btn", type: "button", style: "margin-left:auto",
                                      onclick: () => shortlist.clear(), text: "Clear" })] : []));
  }

  // ---------------------------------------------------------------- table
  function filtered() {
    const q = state.q.trim().toLowerCase();
    const starred = new Set(shortlist.ids());
    return latest.filter((r) =>
      (!state.kind || r.kind === state.kind)
      && (!state.team || r.team === state.team)
      && (!state.position || r.position === state.position)
      && (r.games || 0) >= (Number(state.minGames) || 0)
      && (!state.starred || starred.has(r.item_id))
      && (!q || r.item.toLowerCase().includes(q) || (r.kind === "player" && r.team.toLowerCase() === q)));
  }

  function sorted(list) {
    const k = state.sort, up = state.dir === "asc";
    return list.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return cmpStr(a.item_id, b.item_id);
      if (x == null) return 1;   // empty values always last
      if (y == null) return -1;
      return (up ? x - y : y - x) || cmpStr(a.item_id, b.item_id);
    });
  }

  function header(c) {
    const active = state.sort === c;
    const th = h("th", { class: `n sortable${active ? " hl" : ""}`, scope: "col", title: `${STAT[c].label}: click to sort`,
                         tabindex: "0", "aria-sort": active ? (state.dir === "asc" ? "ascending" : "descending") : "none" },
      STAT[c].short, h("span", { class: "arrow", text: active ? (state.dir === "asc" ? "▲" : "▼") : "" }));
    const go = () => {
      if (state.sort === c) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.sort = c; state.dir = "desc"; }
      save(); paint();
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return th;
  }

  function paint() {
    sortSel.value = state.sort;
    dirBtn.textContent = state.dir === "asc" ? "▲ Low to high" : "▼ High to low";
    dirBtn.setAttribute("aria-label", `Sort direction: ${state.dir === "asc" ? "ascending" : "descending"}`);
    starOnly.checked = state.starred;
    posSel.disabled = state.kind === "team";
    const list = sorted(filtered());
    count.textContent = `${plural(list.length, "row")} of ${fmt(latest.length)}`;
    if (!list.length) {
      tableHolder.replaceChildren(emptyState(state.starred ? "No starred rows match these filters." : "No rows match these filters."));
      return;
    }
    tableHolder.replaceChildren(h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        h("th", { "aria-label": "Shortlist" }), h("th", { scope: "col", text: "Name" }),
        h("th", { scope: "col", text: "Team" }), h("th", { scope: "col", text: "Pos" }),
        COLS.map(header))),
      h("tbody", {}, list.map((r) => h("tr", {},
        h("td", {}, starButton(r, () => { if (state.starred) paint(); })),
        h("td", { class: "name", text: r.item }),
        h("td", { text: r.kind === "team" ? "–" : r.team }),
        h("td", { text: r.position || "–" }),
        COLS.map((c) => h("td", { class: `n${state.sort === c ? " hl" : ""}`, text: fmtStat(r[c], STAT[c].digits) })))))));
  }

  search.addEventListener("input", () => { state.q = search.value; paint(); });
  kindSel.addEventListener("change", () => { state.kind = kindSel.value; save(); paint(); });
  teamSel.addEventListener("change", () => { state.team = teamSel.value; save(); paint(); });
  posSel.addEventListener("change", () => { state.position = posSel.value; save(); paint(); });
  minInput.addEventListener("input", () => { state.minGames = Math.max(0, Number(minInput.value) || 0); save(); paint(); });
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; save(); paint(); });
  dirBtn.addEventListener("click", () => { state.dir = state.dir === "asc" ? "desc" : "asc"; save(); paint(); });
  starOnly.addEventListener("change", () => { state.starred = starOnly.checked; paint(); });
  addEventListener("shortlistchange", () => { paintShortlist(); paint(); });

  paintShortlist();
  paint();
}

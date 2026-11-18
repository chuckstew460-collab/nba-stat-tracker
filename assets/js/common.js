// Shared by all three pages: the nav bar, theme, data loading, CSV parsing,
// date and number formatting, the shortlist, and the service worker.
import { toRows } from "./stats.js";

export const DATA = { history: "data/history.csv", status: "data/status.json" };
export const REPO_URL = "https://github.com/chuckstew460-collab/nba-stat-tracker";

const PAGES = [
  ["index.html", "Today"],
  ["browse.html", "Browse"],
  ["trends.html", "Trends"],
];

// ------------------------------------------------------------------ DOM helper
// Builds elements with textContent only, so names from the source can never
// inject markup.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
  starOutline: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  check: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 8.5l7 7m0-7l-7 7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  up: '<path d="M12 6l6 8H6z" fill="currentColor"/>',
  down: '<path d="M12 18l6-8H6z" fill="currentColor"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  x: '<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

export function icon(name, cls = "") {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${ICONS[name]}</svg>`;
  return wrap.firstChild;
}

// ------------------------------------------------------------------ storage (never required)
export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? "null");
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private window or blocked storage: carry on without it */ }
  return null;
}

// ------------------------------------------------------------------ theme
function effectiveTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export const isDark = () => effectiveTheme() === "dark";
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(store("nst-theme"));

// ------------------------------------------------------------------ nav bar, footer, PWA
export function initChrome(current) {
  const nav = document.getElementById("site-nav");
  nav.className = "nav";
  nav.replaceChildren(
    h("div", { class: "nav-inner" },
      h("a", { class: "brand", href: "index.html" },
        h("img", { src: "assets/icons/favicon.svg", alt: "", width: 30, height: 30 }),
        h("span", { class: "brand-name" }, "Stat Tracker", h("small", { text: "NBA · daily" }))),
      h("nav", { class: "nav-links", "aria-label": "Pages" },
        PAGES.map(([href, label]) =>
          h("a", { href, "aria-current": href === current ? "page" : null, text: label }))),
      h("div", { class: "nav-tools" },
        h("button", { class: "install-btn", id: "install-btn", hidden: true, type: "button", text: "Install app" }),
        h("button", { class: "icon-btn", id: "theme-btn", type: "button" }))),
    h("div", { class: "offline-banner", id: "offline-banner", hidden: true,
               text: "You're offline. Showing the last data this device loaded." }));

  const themeBtn = document.getElementById("theme-btn");
  const paintThemeBtn = () => {
    const dark = isDark();
    themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeBtn.title = themeBtn.getAttribute("aria-label");
  };
  themeBtn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    applyTheme(next);
    store("nst-theme", next);
    paintThemeBtn();
    window.dispatchEvent(new Event("themechange"));
  });
  paintThemeBtn();

  const foot = document.getElementById("site-foot");
  if (foot) {
    foot.replaceChildren(h("div", { class: "inner" },
      h("span", { text: "Unofficial fan project. Stats from ESPN's public API, pulled once a day by GitHub Actions." }),
      h("span", {},
        h("a", { href: REPO_URL, text: "Source & data" }), " · ",
        h("a", { href: `${REPO_URL}/issues`, text: "Daily issues" }))));
  }

  const banner = document.getElementById("offline-banner");
  const paintOnline = () => { banner.hidden = navigator.onLine; };
  addEventListener("online", paintOnline);
  addEventListener("offline", paintOnline);
  paintOnline();

  // Install button (Chromium fires beforeinstallprompt when the site is installable)
  const installBtn = document.getElementById("install-btn");
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    installBtn.hidden = true;
  });
  addEventListener("appinstalled", () => { installBtn.hidden = true; });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("service worker", err));
  }
}

// ------------------------------------------------------------------ data
async function get(url) {
  // no-cache: always ask the network (the service worker answers from its
  // cache only when the network is unreachable).
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

export async function loadStatus() {
  return (await get(DATA.status)).json();
}

export async function loadHistory() {
  const text = await (await get(DATA.history)).text();
  const [header, ...lines] = parseCSV(text);
  const records = lines
    .filter((cells) => cells.length === header.length)
    .map((cells) => Object.fromEntries(header.map((col, i) => [col, cells[i]])));
  return toRows(records);
}

// RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
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

// ------------------------------------------------------------------ dates (UTC 'YYYY-MM-DD')
const DAY_MS = 86400000;
const asDate = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayFmtW = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const fmtDay = (d) => (d ? dayFmt.format(asDate(d)) : "");
export const fmtWeekday = (d) => (d ? dayFmtW.format(asDate(d)) : "");
export const daysBetween = (a, b) => Math.round((asDate(b) - asDate(a)) / DAY_MS);

export function fmtRunTime(iso) {
  const t = new Date(iso);
  const local = t.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric",
                                            hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const utc = t.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return { local, utc: `${utc} UTC` };
}

export function relTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ------------------------------------------------------------------ numbers
const nf = new Intl.NumberFormat("en-US");
export const fmt = (n) => nf.format(n);
export function fmtStat(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "–";
  return digits ? v.toFixed(digits) : nf.format(v);
}
export function fmtSigned(v, digits = 1) {
  if (v == null) return "–";
  if (v === 0) return digits ? (0).toFixed(digits) : "0";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

// A small signed change with an arrow; `good` flips colors for stats where down is good.
export function delta(v, { digits = 1, lowerIsBetter = false, quiet = false } = {}) {
  if (v == null || v === 0) {
    return quiet ? h("span", { class: "delta flat", "aria-hidden": "true" }) : h("span", { class: "delta flat", text: "–" });
  }
  const up = v > 0;
  const good = lowerIsBetter ? !up : up;
  return h("span", { class: `delta ${good ? "good" : "bad"}`, title: `${fmtSigned(v, digits)} since the previous run` },
    icon(up ? "up" : "down"), Math.abs(v).toFixed(digits));
}

// Player name with team (players) or the team name (teams)
export const who = (r) => (r.kind === "player" && r.team ? `${r.item} · ${r.team}` : r.item);

// ------------------------------------------------------------------ shortlist (this browser only)
const SHORTLIST_KEY = "nst-shortlist";
export const shortlist = {
  all() { return store(SHORTLIST_KEY) || {}; },
  has(id) { return Boolean(this.all()[id]); },
  ids() { return Object.keys(this.all()); },
  toggle(row) {
    const list = this.all();
    if (list[row.item_id]) delete list[row.item_id];
    else list[row.item_id] = { item: row.item, team: row.team, kind: row.kind, starred: new Date().toISOString() };
    store(SHORTLIST_KEY, list);
    window.dispatchEvent(new Event("shortlistchange"));
    return Boolean(list[row.item_id]);
  },
  clear() { store(SHORTLIST_KEY, null); window.dispatchEvent(new Event("shortlistchange")); },
};

export function starButton(row, onChange) {
  const btn = h("button", { class: "star-btn", type: "button" });
  const paint = () => {
    const on = shortlist.has(row.item_id);
    btn.replaceChildren(icon(on ? "star" : "starOutline"));
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", `${on ? "Remove" : "Add"} ${row.item} ${on ? "from" : "to"} the shortlist`);
    btn.title = on ? "On your shortlist" : "Add to shortlist";
  };
  btn.addEventListener("click", () => { shortlist.toggle(row); paint(); onChange && onChange(); });
  paint();
  return btn;
}

export function errorBox(err) {
  return h("div", { class: "error-box", role: "alert" },
    h("strong", { text: "The data could not be loaded. " }),
    h("span", { text: navigator.onLine
      ? `(${err.message}) Try reloading the page.`
      : "You're offline and this device has not loaded the data before." }));
}

export function emptyState(text) {
  return h("div", { class: "empty", text });
}

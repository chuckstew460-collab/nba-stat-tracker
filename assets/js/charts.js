// Small SVG/HTML chart kit: multi-line chart with a crosshair, ranked (and
// diverging) bars, day columns, one shared tooltip, and a table view for
// every chart. Colors are CSS custom properties (var(--s1) ...), so light and
// dark themes switch without redrawing.
import { h, fmt, fmtDay, fmtStat, fmtSigned } from "./common.js";

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function txt(attrs, text) {
  const t = s("text", attrs);
  t.textContent = text;
  return t;
}

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)",
                       "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

// ------------------------------------------------------------------ tooltip
let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = h("div", { class: "tooltip", hidden: true, role: "status" });
    document.body.append(tipEl);
  }
  return tipEl;
}
// rows: [{ value, label, color }]
export function showTip(x, y, head, rows) {
  const t = tip();
  t.replaceChildren(
    h("div", { class: "tt-head", text: head }),
    ...rows.map((r) => h("div", { class: "tt-row" },
      r.color ? h("span", { class: "tt-key", style: `background:${r.color}` }) : null,
      h("strong", { text: r.value }),
      h("span", { text: r.label || "" }))));
  t.hidden = false;
  const pad = 14, w = t.offsetWidth, ht = t.offsetHeight;
  let left = x + pad, top = y - ht - pad;
  if (left + w > innerWidth - 8) left = x - w - pad;
  if (top < 8) top = y + pad;
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${top}px`;
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }
addEventListener("scroll", hideTip, { passive: true });

// ------------------------------------------------------------------ draw when laid out, redraw on resize
// A chart is often built before its card is attached to the page, when it has
// no width yet; the observer draws it once it has one, and again whenever the
// width changes.
function mount(container, draw) {
  let lastW = -1, frame = 0;
  const run = () => {
    frame = 0;
    if (!container.isConnected) { observer.disconnect(); return; }
    const w = container.clientWidth;
    if (w === 0 || w === lastW) return;
    lastW = w;
    container.replaceChildren();
    draw(Math.max(260, w));
  };
  const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(run); });
  observer.observe(container);
}

// Clean axis ticks covering [lo, hi]: steps of 1, 2, 2.5 or 5 x 10^n.
function niceTicks(lo, hi, target = 4) {
  if (!(hi > lo)) { const pad = Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw);
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}
const tickText = (v) => {
  const r = Math.round(v * 100) / 100;
  return Math.abs(r) >= 10000 ? `${Math.round(r / 1000)}K` : fmt(r);
};

function roundedTop(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

function legend(series) {
  return h("div", { class: "legend" }, series.map((sr) =>
    h("span", {}, h("span", { class: "key line", style: `background:${sr.color}` }), sr.name)));
}

// ------------------------------------------------------------------ line chart
// dates: ['YYYY-MM-DD'...]; series: [{ name, color, values: [number|null per date] }]
export function lines(container, { dates, series, digits = 1, height = 280, ariaLabel = "",
                                   zeroBased = false, unit = "" }) {
  const box = h("div", { class: "chart" });
  const plot = h("div", { class: "plot" });
  if (series.length > 1) box.append(legend(series));
  box.append(plot);
  container.replaceChildren(box);

  mount(plot, (W) => {
    const m = { l: 46, r: 16, t: 14, b: 30 };
    const pw = W - m.l - m.r, ph = height - m.t - m.b;
    const all = series.flatMap((sr) => sr.values.filter((v) => v != null));
    if (!all.length) { plot.append(h("div", { class: "empty", text: "No values to plot yet." })); return; }
    const lo = zeroBased ? Math.min(0, ...all) : Math.min(...all);
    const ticks = niceTicks(lo, Math.max(...all));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const n = dates.length;
    const x = (i) => (n === 1 ? m.l + pw / 2 : m.l + (i / (n - 1)) * pw);
    const y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin)) * ph;
    const svg = s("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img",
                           "aria-label": ariaLabel });

    for (const t of ticks) {
      svg.append(s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === yMin ? "baseline" : "gridline" }));
      svg.append(txt({ x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "tick" }, tickText(t) + unit));
    }
    const every = Math.max(1, Math.ceil(64 / (n > 1 ? pw / (n - 1) : pw)));
    dates.forEach((d, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every) return;
      svg.append(txt({ x: x(i), y: height - 8, "text-anchor": n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle",
                       class: "tick" }, fmtDay(d)));
    });

    for (const sr of series) {
      let d = "", pen = false;
      sr.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      if (d) svg.append(s("path", { d, class: "series-line", style: `stroke:${sr.color}` }));
      // dots where a point stands alone (no neighbor to draw a line to), and the end dot
      sr.values.forEach((v, i) => {
        if (v == null) return;
        const alone = (i === 0 || sr.values[i - 1] == null) && (i === n - 1 || sr.values[i + 1] == null);
        const last = sr.values.slice(i + 1).every((u) => u == null);
        if (alone || last) svg.append(s("circle", { cx: x(i), cy: y(v), r: 4, class: "dot", style: `fill:${sr.color}` }));
      });
    }

    // crosshair + one tooltip listing every series at that date
    const cross = s("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, class: "crosshair", visibility: "hidden" });
    const hit = s("rect", { x: m.l - 10, y: m.t, width: pw + 20, height: ph, class: "hit" });
    svg.append(cross, hit);
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / pw) * (n - 1))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      const rows = series.map((sr) => ({ v: sr.values[i], label: sr.name, color: sr.color }))
        .filter((r2) => r2.v != null).sort((a, b) => b.v - a.v)
        .map((r2) => ({ value: fmtStat(r2.v, digits) + unit, label: r2.label, color: r2.color }));
      showTip(e.clientX, e.clientY, fmtDay(dates[i]), rows.length ? rows : [{ value: "–", label: "no value" }]);
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
    plot.append(svg);
  });
}

// ------------------------------------------------------------------ ranked / diverging bars
// items: [{ label, value, note, extra: [{label, value}] }]; values may be negative.
export function hbars(container, { items, digits = 1, signed = false, name = "", colorPos = "var(--s1)",
                                   colorNeg = "var(--neg)", highlight = null }) {
  mount(container, () => {
    const max = Math.max(...items.map((d) => Math.abs(d.value)), 1e-9);
    const hasNeg = items.some((d) => d.value < 0);
    const hasPos = items.some((d) => d.value > 0);
    const zero = hasNeg && hasPos ? 0.5 : hasNeg ? 1 : 0;   // where the baseline sits in the track
    const span = hasNeg && hasPos ? 0.5 : 1;
    const grid = h("div", { class: `hbars${hasNeg ? " diverging" : ""}`, role: "list" });
    for (const d of items) {
      const share = (Math.abs(d.value) / max) * span;
      const left = d.value < 0 ? zero - share : zero;
      const color = d.value < 0 ? colorNeg : colorPos;
      const shown = signed ? fmtSigned(d.value, digits) : fmtStat(d.value, digits);
      const fill = h("div", { class: `fill${d.value < 0 ? " neg" : ""}${highlight && highlight(d) ? " hl" : ""}`,
        style: `background:${color};left:calc(${left * 100}% );width:max(2px, ${share * 100}%)` });
      const val = h("span", { class: `val${d.value < 0 ? " neg" : ""}`, text: shown,
        style: d.value < 0 ? `right:calc(${(1 - left) * 100}% + 6px)` : `left:calc(${(left + share) * 100}% + 6px)` });
      const row = h("div", { class: "hrow", role: "listitem", tabindex: "0",
                             "aria-label": `${d.label}: ${shown}${d.note ? `, ${d.note}` : ""}` },
        h("div", { class: "lbl" }, h("span", { class: "name", text: d.label }),
          d.note ? h("span", { class: "note", text: d.note }) : null),
        h("div", { class: "track" }, hasNeg && hasPos ? h("div", { class: "zero" }) : null, fill, val));
      const enter = (e) => {
        const r = e.clientX != null ? e : row.getBoundingClientRect();
        showTip(e.clientX ?? r.left + 40, e.clientY ?? r.top, d.label,
                [{ value: shown, label: name, color }, ...(d.extra || [])]);
      };
      row.addEventListener("pointermove", enter);
      row.addEventListener("pointerleave", hideTip);
      row.addEventListener("focus", () => {
        const r = row.getBoundingClientRect();
        showTip(r.left + 40, r.top, d.label, [{ value: shown, label: name, color }, ...(d.extra || [])]);
      });
      row.addEventListener("blur", hideTip);
      grid.append(row);
    }
    container.append(grid);
  });
}

// ------------------------------------------------------------------ one column per day
// days: [{ date, value, color?, extra: [{label, value}] }]
export function columns(container, { days, name, digits = 1, height = 200, color = "var(--s1)",
                                     highlight = null, ariaLabel = "" }) {
  mount(container, (W) => {
    const m = { l: 46, r: 12, t: 22, b: 30 };
    const pw = W - m.l - m.r, ph = height - m.t - m.b;
    const n = days.length;
    const ticks = niceTicks(0, Math.max(...days.map((d) => d.value), 0.1));
    const yMax = ticks[ticks.length - 1];
    const y = (v) => m.t + ph - (v / yMax) * ph;
    const band = pw / Math.max(n, 1);
    const bw = Math.max(2, Math.min(24, band - 4));
    const svg = s("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": ariaLabel || name });
    for (const t of ticks) {
      svg.append(s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? "baseline" : "gridline" }));
      svg.append(txt({ x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "tick" }, tickText(t)));
    }
    const every = Math.max(1, Math.ceil(56 / band));
    days.forEach((d, i) => {
      const cx = m.l + band * (i + 0.5);
      if ((i % every === 0 && n - 1 - i >= every) || i === n - 1) {
        svg.append(txt({ x: cx, y: height - 8, "text-anchor": "middle", class: "tick" }, fmtDay(d.date)));
      }
      const hl = highlight && highlight(d);
      const fill = hl ? "var(--s2)" : d.color || color;
      const bar = s("path", { d: roundedTop(cx - bw / 2, y(d.value), bw, Math.max(0, y(0) - y(d.value)), 4),
                              class: "bar", style: `fill:${fill}` });
      const hit = s("rect", { x: m.l + band * i, y: m.t, width: band, height: ph, class: "hit", tabindex: "0" });
      const show = (e) => {
        bar.classList.add("hover");
        const r = hit.getBoundingClientRect();
        showTip(e.clientX ?? r.left + band / 2, e.clientY ?? r.top + 20, fmtDay(d.date),
                [{ value: fmtStat(d.value, digits), label: name, color: fill }, ...(d.extra || [])]);
      };
      hit.addEventListener("pointermove", show);
      hit.addEventListener("focus", show);
      const hide = () => { bar.classList.remove("hover"); hideTip(); };
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("blur", hide);
      svg.append(bar);
      if (hl && bw >= 8) svg.append(txt({ x: cx, y: y(d.value) - 6, "text-anchor": "middle", class: "tick strong" }, fmtStat(d.value, digits)));
      svg.append(hit);
    });
    container.append(svg);
  });
}

// ------------------------------------------------------------------ table view twin
// columns: [{ key, label, num, digits, signed }]
export function tableView(cols, rows, summary = "Show the numbers") {
  const cell = (c, r) => {
    const v = r[c.key];
    if (!c.num) return v ?? "";
    if (typeof v !== "number") return v ?? "–";
    return c.signed ? fmtSigned(v, c.digits ?? 1) : fmtStat(v, c.digits ?? 1);
  };
  return h("details", { class: "table-view" },
    h("summary", { text: summary }),
    h("div", { class: "scroll" },
      h("table", { class: "data" },
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "n" : null, scope: "col", text: c.label })))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          cols.map((c) => h("td", { class: c.num ? "n" : null, text: cell(c, r) }))))))));
}

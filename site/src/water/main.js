import * as d3 from "d3";
import { initTheme, initSkin, cssVar, tooltip, el, tipRow, loadJSON, fmtInt } from "../shared/ui.js";
import { skinData } from "./skin.js";

const isDark = initTheme(document.getElementById("theme"));
initSkin(document.getElementById("skin"));
const tip = tooltip();
const state = { long: "mead" };
let W;

const fmt1 = d3.format(",.1f"), fmt2 = d3.format(",.2f"), pct = (v) => `${Math.round(v * 100)}%`;
const parse = (s) => new Date(s + "T12:00");
const axisClean = (a) => a.select(".domain").remove();
const ISSUE_LABEL = { "01-01": "Jan 1", "02-01": "Feb 1", "03-01": "Mar 1", "04-01": "Apr 1", "05-01": "May 1" };

init().catch((err) => {
  console.error(err);
  document.querySelector("main").prepend(el("div", { class: "wrap", style: { padding: "24px", color: "var(--accent)" } }, `Could not load data: ${err.message}`));
});

async function init() {
  W = await loadJSON("./data/water/water.json");
  renderTiles();
  const seg = document.getElementById("long-lake");
  for (const [k, label] of [["mead", "Lake Mead"], ["powell", "Lake Powell"]]) {
    seg.append(el("button", { type: "button", "data-k": k, "aria-pressed": k === state.long, onclick: () => {
      state.long = k; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k)); renderLong(); } }, label));
  }
  document.getElementById("swe").addEventListener("input", renderInflow);
  renderAll();
  skinData({ W });
  document.getElementById("generated").textContent = `Data refreshed ${new Date(W.generated).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`;
  let raf, lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w === lastW) return; lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(renderAll); })
    .observe(document.querySelector("main"));
  window.addEventListener("themechange", renderAll);
}

function renderAll() {
  renderProjection("powell");
  renderProjection("mead");
  renderInflow();
  renderSkill();
  renderScatter();
  renderSnow("upper_colorado", "snow-uc", "leg-uc");
  renderSnow("sierra", "snow-si", "leg-si");
  renderTeacups();
  renderCaTotal();
  renderLong();
}

// Nudge stacked right-edge labels apart so none overlap (keeps order).
function spread(items, gap = 12) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
  return items;
}

function frame(id, height, m) {
  const host = document.getElementById(id);
  const width = Math.max(240, host.clientWidth);
  host.replaceChildren();
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  return { svg, g: svg.append("g").attr("transform", `translate(${m.l},${m.t})`), iw: width - m.l - m.r, ih: height - m.t - m.b, width };
}

// ------------------------------------------------------------------ tiles
function renderTiles() {
  const P = W.projections, uc = W.status.upper_colorado;
  const ca = W.california.reservoirs;
  const caStor = d3.sum(ca, (r) => r.storage), caAvg = d3.sum(ca, (r) => r.avg_for_date || 0);
  document.getElementById("asof").textContent = `The Southwest's water · ${parse(P.mead.today.slice(0, 10)).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}`;
  const tile = (label, value, sub) => el("div", { class: "card tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), el("div", { class: "sub" }, sub));
  const mead = P.mead.elev_now, powell = P.powell.elev_now;
  const meadTier = W.levels.mead.find(([e]) => mead >= e);
  document.getElementById("tiles").replaceChildren(
    tile("Lake Mead", `${fmt1(mead)} ft`, `${fmt1(W.full_pool.mead - mead)} ft below full · ${meadTier ? `${fmt1(mead - meadTier[0])} ft above the ${meadTier[1]} line` : "below every tier line"}`),
    tile("Lake Powell", `${fmt1(powell)} ft`, `${fmt1(powell - 3490)} ft above minimum power pool (3,490 ft)`),
    tile("California's 12 big reservoirs", pct(caStor / caAvg), `of the 1991–2020 average for the date · ${fmt1(caStor / 1e6)} MAF stored`),
    uc.swe_pct != null && uc.swe_mean_in > 0.3
      ? tile("Upper Colorado snowpack", pct(uc.swe_pct), `of median for the date · water year ${uc.wy}`)
      : tile("Upper Colorado snowpack", "Not yet", `The ${uc.wy} snow season is just beginning. Last April 1: ${uc.last_wy_apr1_pct != null ? pct(uc.last_wy_apr1_pct) : "—"} of median`));
}

// ------------------------------------------------------------------ projections
function renderProjection(lake) {
  const P = W.projections[lake];
  const levels = W.levels[lake];
  const risk = W.risk[lake];
  const riskHost = document.getElementById(`risk-${lake}`);
  const items = lake === "powell"
    ? risk.filter((r) => r.elev >= 3490).map((r) => el("div", { class: "r" }, el("b", {}, pct(r.p_below_any)), el("span", {}, `chance of dropping below ${fmtInt.format(r.elev)} ft (${r.label.toLowerCase()}) in the next year`)))
    : risk.filter((r) => [1025, 950].includes(r.elev)).map((r) => el("div", { class: "r" }, el("b", {}, pct(r.p_below_jan1)),
      el("span", {}, `chance of being below ${fmtInt.format(r.elev)} ft (${r.label}) on ${parse(P.jan1_date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`)));
  riskHost.replaceChildren(...items);

  const hist = P.history.map(([d, v]) => ({ d: parse(d), v })).filter((x) => x.d >= d3.timeYear.offset(parse(P.today.slice(0, 10)), -3));
  const dates = P.dates.map((d) => parse(d.slice(0, 10)));
  const m = { l: 52, r: 128, t: 10, b: 26 };
  const host = document.getElementById(`proj-${lake}`);
  if (host.clientWidth < 520) m.r = 10;
  const { svg, g, iw, ih } = frame(`proj-${lake}`, 320, m);
  const all = P.trajectories.flat().concat(hist.map((h) => h.v));
  const lo = Math.min(d3.min(all), ...levels.filter(([e]) => e > d3.min(all) - 40).map(([e]) => e)) - 5;
  const hi = d3.max(all) + 8;
  const x = d3.scaleTime([hist[0].d, dates.at(-1)], [0, iw]);
  const y = d3.scaleLinear([lo, hi], [ih, 0]).nice();
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${d3.format(",")(v)}`).tickSize(0).tickPadding(8)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(8)).call(axisClean);
  const labs = [];
  for (const [e, label] of levels) {
    if (e < y.domain()[0] || e > y.domain()[1]) continue;
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(e)).attr("y2", y(e)).style("stroke", "var(--warm)").style("stroke-width", 1).style("stroke-dasharray", "4 3");
    labs.push({ y: y(e) + (m.r > 20 ? 4 : -4), t: `${label} · ${d3.format(",")(e)}` });
  }
  for (const L of spread(labs)) g.append("text").attr("class", "label").attr("x", m.r > 20 ? iw + 6 : iw - 4).attr("y", L.y)
    .attr("text-anchor", m.r > 20 ? "start" : "end").style("font-size", "11px").text(L.t);
  const band = dates.map((d, i) => ({ d, lo: P.p10[i], hi: P.p90[i], med: P.p50[i] }));
  g.append("path").datum(band).attr("d", d3.area().x((d) => x(d.d)).y0((d) => y(d.lo)).y1((d) => y(d.hi))).style("fill", "var(--water)").style("opacity", 0.12);
  const lines = g.append("g");
  P.trajectories.forEach((t, k) => lines.append("path").datum(t.map((v, i) => ({ d: dates[i], v }))).attr("class", "traj").attr("data-year", P.years[k])
    .attr("d", d3.line().x((d) => x(d.d)).y((d) => y(d.v))).style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 1).style("opacity", 0.28));
  g.append("path").datum(band).attr("d", d3.line().x((d) => x(d.d)).y((d) => y(d.med))).style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 2.5);
  g.append("path").datum(hist).attr("d", d3.line().x((d) => x(d.d)).y((d) => y(d.v))).style("fill", "none").style("stroke", "var(--ink)").style("stroke-width", 2);
  g.append("circle").attr("cx", x(dates[0])).attr("cy", y(P.elev_now)).attr("r", 5).style("fill", "var(--ink)").style("stroke", "var(--surface)").style("stroke-width", 2);
  document.getElementById(`leg-${lake}`).replaceChildren(
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--ink)" } }), "Observed"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--water)" } }), `Median of ${P.years.length} analog years`),
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--water)", opacity: 0.25 } }), "80% of analogs"));
  // hover: nearest analog line at the pointer's date
  const hl = g.append("path").style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 2.5).style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px, py] = d3.pointer(e, g.node());
    const t = x.invert(px);
    if (t < dates[0]) {
      const h = hist[d3.bisector((r) => r.d).center(hist, t)];
      hl.style("opacity", 0);
      return tip.show(e.clientX, e.clientY, (tt) => tt.append(el("div", { class: "t-title" }, d3.timeFormat("%b %Y")(h.d)), tipRow(cssVar("--ink"), `${fmt1(h.v)} ft`, "observed")));
    }
    const i = Math.min(dates.length - 1, d3.bisector((d) => d).center(dates, t));
    let best = 0, bd = Infinity;
    P.trajectories.forEach((tr, k) => { const dd = Math.abs(y(tr[i]) - py); if (dd < bd) { bd = dd; best = k; } });
    hl.datum(P.trajectories[best].map((v, j) => ({ d: dates[j], v }))).attr("d", d3.line().x((d) => x(d.d)).y((d) => y(d.v))).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (tt) => tt.append(el("div", { class: "t-title" }, d3.timeFormat("%b %-d, %Y")(dates[i])),
      tipRow(cssVar("--water"), `${fmt1(P.trajectories[best][i])} ft`, `if it plays out like ${P.years[best]}–${P.years[best] + 1}`),
      tipRow(null, `${fmt1(band[i].med)} ft`, "median of analogs"), tipRow(null, `${fmt1(band[i].lo)}–${fmt1(band[i].hi)} ft`, "80% range")));
  }).on("pointerleave", () => { hl.style("opacity", 0); tip.hide(); });
}

// ------------------------------------------------------------------ inflow forecaster
function renderInflow() {
  const m = W.inflow_model["04-01"];
  const swe = +document.getElementById("swe").value / 100;
  document.getElementById("swe-label").textContent = `${Math.round(swe * 100)}% of median`;
  // snowpack-only model: the slider sets snowpack, not precipitation
  const [b0, b1, b2] = m.slider.beta;
  const mu = b0 + b1 * swe + b2 * Math.log(m.latest_base);
  const q = m.slider.res_q.map((r) => Math.exp(mu + r));   // 5,10,25,50,75,90,95%
  const vols = W.volumes.filter((v) => v[1] != null).map((v) => v[1]);
  const median = d3.median(vols);
  document.getElementById("inflow-big").textContent = `${fmt1(q[3])} million acre-feet`;
  document.getElementById("inflow-sub").textContent = `April–July inflow to Lake Powell · 80% range ${fmt1(q[1])}–${fmt1(q[5])} MAF · the median year brings ${fmt1(median)} MAF (${Math.round((100 * q[3]) / median)}% of median)`;
  skinData({ inflow: { swe, med: q[3], lo: q[1], hi: q[5] } });
  const near = m.rows.filter((r) => Math.abs(r[5] - swe) <= 0.1).sort((a, b) => Math.abs(a[5] - swe) - Math.abs(b[5] - swe)).slice(0, 5);
  document.getElementById("inflow-analogs").textContent = near.length
    ? `Years with a similar April 1 snowpack: ${near.map((r) => `${r[0]} (${Math.round(r[5] * 100)}% → ${fmt1(r[1])} MAF)`).join(", ")}.`
    : "No year since 1987 had an April 1 snowpack this extreme, so treat this as an extrapolation.";
  // distribution strip: historical volumes as dots, forecast band on top
  const mm = { l: 10, r: 10, t: 22, b: 40 };
  const { g, iw, ih } = frame("inflow-dist", 112, mm);
  const x = d3.scaleLinear([0, Math.max(14, d3.max(vols) * 1.05)], [0, iw]);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(7).tickFormat((d) => `${d}`).tickSize(0).tickPadding(8)).call(axisClean);
  g.append("text").attr("class", "label").attr("x", 0).attr("y", ih + 34).style("font-size", "10.5px").style("fill", "var(--muted)").text("Million acre-feet · grey dots are every year since 1964");
  g.append("rect").attr("x", x(q[1])).attr("width", x(q[5]) - x(q[1])).attr("y", 4).attr("height", ih - 8).attr("rx", 4).style("fill", "var(--snow)").style("opacity", 0.18);
  g.append("rect").attr("x", x(q[2])).attr("width", x(q[4]) - x(q[2])).attr("y", 4).attr("height", ih - 8).attr("rx", 4).style("fill", "var(--snow)").style("opacity", 0.35);
  g.selectAll("circle").data(W.volumes.filter((v) => v[1] != null)).join("circle").attr("cx", (d) => x(d[1])).attr("cy", ih / 2).attr("r", 3.5)
    .style("fill", "var(--muted)").style("opacity", 0.6)
    .on("pointermove", (e, d) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `${d[0]}`), tipRow(null, `${fmt2(d[1])} MAF`, "April–July inflow"))))
    .on("pointerleave", () => tip.hide());
  g.append("line").attr("x1", x(q[3])).attr("x2", x(q[3])).attr("y1", 0).attr("y2", ih).style("stroke", "var(--snow)").style("stroke-width", 2.5);
  g.append("text").attr("class", "label strong").attr("x", x(q[3])).attr("y", -6).attr("text-anchor", "middle").text("forecast");
}

function renderSkill() {
  const rows = Object.entries(W.inflow_model).map(([k, v]) => ({ k, mae: v.mae, clim: v.mae_clim, cover: v.coverage80, r2: v.r2 }));
  const m = { l: 40, r: 10, t: 12, b: 40 };
  const { g, iw, ih } = frame("skill", 200, m);
  const x0 = d3.scaleBand(rows.map((r) => r.k), [0, iw]).padding(0.3);
  const x1 = d3.scaleBand(["clim", "mae"], [0, x0.bandwidth()]).padding(0.12);
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r.clim) * 1.15], [ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8)).call(axisClean);
  const grp = g.selectAll("g.k").data(rows).join("g").attr("class", "k").attr("transform", (r) => `translate(${x0(r.k)},0)`);
  const bw = Math.min(24, x1.bandwidth());
  for (const key of ["clim", "mae"]) {
    grp.append("path").attr("d", (r) => { const x_ = x1(key) + (x1.bandwidth() - bw) / 2, top = y(r[key]), rr = Math.min(4, ih - top);
      return `M${x_},${ih}V${top + rr}Q${x_},${top} ${x_ + rr},${top}H${x_ + bw - rr}Q${x_ + bw},${top} ${x_ + bw},${top + rr}V${ih}Z`; })
      .style("fill", key === "mae" ? "var(--snow)" : "var(--axis)");
    grp.append("text").attr("class", "label").attr("x", x1(key) + x1.bandwidth() / 2).attr("y", (r) => y(r[key]) - 4).attr("text-anchor", "middle").style("font-size", "10.5px").text((r) => fmt1(r[key]));
  }
  grp.append("text").attr("class", "label strong").attr("x", x0.bandwidth() / 2).attr("y", ih + 14).attr("text-anchor", "middle").text((r) => ISSUE_LABEL[r.k]);
  grp.append("text").attr("class", "label").attr("x", x0.bandwidth() / 2).attr("y", ih + 28).attr("text-anchor", "middle").style("font-size", "10.5px").style("fill", "var(--muted)")
    .text((r) => `${pct(r.cover)} in range`);
  document.getElementById("skill-legend").replaceChildren(
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--axis)" } }), "Guessing the median"),
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--snow)" } }), "Snow model"),
    el("span", { class: "key" }, "average error, MAF"));
}

function renderScatter() {
  const rows = W.inflow_model["04-01"].rows.map(([wy, obs, pred, lo, hi, swe]) => ({ wy, obs, pred, lo, hi, swe }));
  const m = { l: 40, r: 10, t: 8, b: 34 };
  const { svg, g, iw, ih } = frame("inflow-scatter", 230, m);
  const max = d3.max(rows, (r) => Math.max(r.obs, r.hi)) * 1.05;
  const x = d3.scaleLinear([0, max], [0, iw]), y = d3.scaleLinear([0, max], [ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8)).call(axisClean);
  g.append("line").attr("x1", 0).attr("y1", ih).attr("x2", iw).attr("y2", 0).style("stroke", "var(--axis)");
  g.append("text").attr("class", "label").attr("x", iw / 2).attr("y", ih + 30).attr("text-anchor", "middle").text("Actual April–July inflow (MAF)");
  g.selectAll("line.ci").data(rows).join("line").attr("class", "ci").attr("x1", (r) => x(r.obs)).attr("x2", (r) => x(r.obs)).attr("y1", (r) => y(r.lo)).attr("y2", (r) => y(r.hi))
    .style("stroke", "var(--snow)").style("opacity", 0.35);
  g.selectAll("circle").data(rows).join("circle").attr("cx", (r) => x(r.obs)).attr("cy", (r) => y(r.pred)).attr("r", 4.5)
    .style("fill", "var(--snow)").style("stroke", "var(--surface)").style("stroke-width", 2);
  const del = d3.Delaunay.from(rows, (r) => x(r.obs), (r) => y(r.pred));
  svg.on("pointermove", (e) => {
    const [px, py] = d3.pointer(e, g.node());
    const r = rows[del.find(px, py)];
    if (Math.hypot(x(r.obs) - px, y(r.pred) - py) > 24) return tip.hide();
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `${r.wy} · snowpack ${pct(r.swe)} of median on Apr 1`),
      tipRow(null, `${fmt2(r.obs)} MAF`, "actual"), tipRow(cssVar("--snow"), `${fmt2(r.pred)} MAF`, "forecast"), tipRow(null, `${fmt1(r.lo)}–${fmt1(r.hi)}`, "80% range")));
  }).on("pointerleave", () => tip.hide());
}

// ------------------------------------------------------------------ snow curves
function renderSnow(basin, id, legId) {
  const c = W.snow_curves[basin];
  if (!c) return;
  const cur = String(c.current_wy), prev = String(c.current_wy - 1);
  const wyStart = new Date(2001, 9, 1);
  const dayDate = (i) => d3.timeDay.offset(wyStart, i);
  const m = { l: 36, r: 56, t: 10, b: 24 };
  const { svg, g, iw, ih } = frame(id, 260, m);
  const x = d3.scaleLinear([0, 300], [0, iw]);
  const allYears = Object.values(c.years).flat().filter((v) => v != null);
  const y = d3.scaleLinear([0, Math.max(d3.max(c.p90), d3.max(allYears)) * 1.05], [ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v}″`).tickSize(0).tickPadding(6)).call(axisClean);
  const monthStarts = d3.range(0, 300).filter((i) => dayDate(i).getDate() === 1);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickValues(monthStarts).tickFormat((i) => d3.timeFormat("%b")(dayDate(i))).tickSize(0).tickPadding(8)).call(axisClean);
  const idx = c.wyd.map((d, i) => ({ d, i })).filter((r) => r.d <= 300);
  g.append("path").datum(idx).attr("d", d3.area().x((r) => x(r.d)).y0((r) => y(c.p10[r.i])).y1((r) => y(c.p90[r.i]))).style("fill", "var(--ink-2)").style("opacity", 0.1);
  g.append("path").datum(idx).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(c.median[r.i]))).style("fill", "none").style("stroke", "var(--muted)").style("stroke-width", 1.5);
  const line = (vals) => d3.line().defined((r) => vals[r.i] != null).x((r) => x(r.d)).y((r) => y(vals[r.i]));
  const notable = Object.keys(c.years).filter((k) => k !== cur && k !== prev);
  for (const k of notable) {
    g.append("path").datum(idx).attr("d", line(c.years[k])).style("fill", "none").style("stroke", "var(--ink-2)").style("stroke-width", 1).style("opacity", 0.45);
    const peakI = d3.maxIndex(idx, (r) => c.years[k][r.i] ?? -1);
    g.append("text").attr("class", "label").attr("x", x(idx[peakI].d)).attr("y", y(c.years[k][idx[peakI].i]) - 5).attr("text-anchor", "middle").style("font-size", "10.5px").text(k);
  }
  if (c.years[prev]) g.append("path").datum(idx).attr("d", line(c.years[prev])).style("fill", "none").style("stroke", "var(--warm)").style("stroke-width", 2);
  if (c.years[cur]) g.append("path").datum(idx).attr("d", line(c.years[cur])).style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 2.5);
  document.getElementById(legId).replaceChildren(
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--ink-2)", opacity: 0.2 } }), "1991–2020 middle 80%"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--muted)" } }), "Median"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--warm)" } }), `${prev}`),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--water)" } }), `${cur} so far`));
  const ch = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--axis)").style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px] = d3.pointer(e, g.node());
    const d = Math.max(0, Math.min(300, Math.round(x.invert(px))));
    const r = idx.find((q) => q.d === d) || idx[0];
    ch.attr("x1", x(d)).attr("x2", x(d)).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (t) => {
      t.append(el("div", { class: "t-title" }, d3.timeFormat("%b %-d")(dayDate(d))));
      if (c.years[cur]?.[r.i] != null) t.append(tipRow(cssVar("--water"), `${fmt1(c.years[cur][r.i])}″`, cur));
      if (c.years[prev]?.[r.i] != null) t.append(tipRow(cssVar("--warm"), `${fmt1(c.years[prev][r.i])}″`, prev));
      t.append(tipRow(cssVar("--muted"), `${fmt1(c.median[r.i])}″`, "median"));
      for (const k of notable) if (c.years[k][r.i] != null) t.append(tipRow(null, `${fmt1(c.years[k][r.i])}″`, k));
    });
  }).on("pointerleave", () => { ch.style("opacity", 0); tip.hide(); });
}

// ------------------------------------------------------------------ California
function renderTeacups() {
  const host = document.getElementById("teacups");
  const res = [...W.california.reservoirs].sort((a, b) => b.capacity - a.capacity);
  const maxCap = d3.max(res, (r) => r.capacity);
  host.replaceChildren(...res.map((r) => {
    const w = 130, h = 92;
    const scale = Math.sqrt(r.capacity / maxCap);
    const top = w * (0.55 + 0.45 * scale), bot = top * 0.55, ch = h * (0.45 + 0.55 * scale);
    const x0 = (w - top) / 2, x1 = (w - bot) / 2, y0 = h - ch;
    const cup = (frac) => { const yy = h - ch * frac, half = (bot + (top - bot) * frac) / 2; return `M${x1},${h}L${w / 2 - half},${yy}L${w / 2 + half},${yy}L${w - x1},${h}Z`; };
    const svg = d3.create("svg").attr("viewBox", `0 0 ${w} ${h + 2}`).attr("width", "100%").attr("role", "img")
      .attr("aria-label", `${r.name}: ${pct(r.pct_capacity)} of capacity, ${pct(r.pct_average)} of average`);
    svg.append("path").attr("d", cup(1)).style("fill", "var(--surface-2)").style("stroke", "var(--axis)").style("stroke-width", 1.5);
    svg.append("path").attr("d", cup(Math.min(1, r.pct_capacity))).style("fill", "var(--water)").style("opacity", 0.85);
    if (r.pct_avg_of_capacity) {
      const fa = Math.min(1, r.pct_avg_of_capacity), yy = h - ch * fa, half = (bot + (top - bot) * fa) / 2;
      svg.append("line").attr("x1", w / 2 - half - 6).attr("x2", w / 2 + half + 6).attr("y1", yy).attr("y2", yy).style("stroke", "var(--ink)").style("stroke-width", 2);
    }
    const node = el("div", { class: "cup" }, svg.node(), el("div", { class: "n" }, r.name),
      el("div", { class: "s" }, `${pct(r.pct_capacity)} full · ${r.pct_average ? pct(r.pct_average) : "—"} of avg`),
      el("div", { class: "s" }, `${fmt2(r.storage / 1e6)} of ${fmt2(r.capacity / 1e6)} MAF`));
    node.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `${r.name} · ${r.date}`),
      tipRow(cssVar("--water"), `${fmtInt.format(Math.round(r.storage))} af`, "stored now"), tipRow(cssVar("--ink"), `${fmtInt.format(Math.round(r.avg_for_date || 0))} af`, "1991–2020 average for the date"),
      tipRow(null, `${fmtInt.format(r.capacity)} af`, "capacity"))));
    node.addEventListener("pointerleave", () => tip.hide());
    return node;
  }));
}

function renderCaTotal() {
  const rows = W.california.total.map(([d, v, mean, p10, p90]) => ({ d: parse(d), v, mean, p10, p90 }));
  const m = { l: 40, r: 12, t: 10, b: 24 };
  const { svg, g, iw, ih } = frame("ca-total", 260, m);
  const x = d3.scaleTime(d3.extent(rows, (r) => r.d), [0, iw]);
  const y = d3.scaleLinear([0, W.california.capacity_total / 1e6], [ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(8).tickSize(0).tickPadding(8)).call(axisClean);
  g.append("path").datum(rows.filter((r) => r.p10 != null)).attr("d", d3.area().x((r) => x(r.d)).y0((r) => y(r.p10)).y1((r) => y(r.p90))).style("fill", "var(--ink-2)").style("opacity", 0.1);
  g.append("path").datum(rows.filter((r) => r.mean != null)).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.mean))).style("fill", "none").style("stroke", "var(--muted)").style("stroke-width", 1.5);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.v))).style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 2);
  document.getElementById("leg-ca").replaceChildren(
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--water)" } }), "Total storage"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--muted)" } }), "1991–2020 average"),
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--ink-2)", opacity: 0.2 } }), "Middle 80%"));
  const ch = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--axis)").style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px] = d3.pointer(e, g.node());
    const r = rows[d3.bisector((q) => q.d).center(rows, x.invert(px))];
    ch.attr("x1", x(r.d)).attr("x2", x(r.d)).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, d3.timeFormat("%b %-d, %Y")(r.d)),
      tipRow(cssVar("--water"), `${fmt2(r.v)} MAF`, "stored"), tipRow(cssVar("--muted"), `${fmt2(r.mean)} MAF`, "average for date")));
  }).on("pointerleave", () => { ch.style("opacity", 0); tip.hide(); });
}

// ------------------------------------------------------------------ long view
function renderLong() {
  const lake = state.long;
  const rows = W.lake_history[lake].map(([d, v]) => ({ d: parse(d), v }));
  const levels = W.levels[lake];
  const m = { l: 52, r: 140, t: 10, b: 24 };
  if (document.getElementById("long").clientWidth < 560) m.r = 10;
  const { svg, g, iw, ih } = frame("long", 340, m);
  const x = d3.scaleTime(d3.extent(rows, (r) => r.d), [0, iw]);
  const lo = Math.min(d3.min(rows, (r) => r.v), levels.at(-1)[0]) - 10;
  const y = d3.scaleLinear([lo, W.full_pool[lake] + 10], [ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(6)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(","))).call((a) => a.selectAll("line").remove()).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(9).tickSize(0).tickPadding(8)).call(axisClean);
  const labs = [];
  for (const [e, label] of [[W.full_pool[lake], "Full pool"], ...levels]) {
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(e)).attr("y2", y(e)).style("stroke", e === W.full_pool[lake] ? "var(--axis)" : "var(--warm)").style("stroke-dasharray", "4 3");
    labs.push({ y: y(e) + 4, t: `${label} · ${d3.format(",")(e)}` });
  }
  if (m.r > 20) for (const L of spread(labs)) g.append("text").attr("class", "label").attr("x", iw + 6).attr("y", L.y).style("font-size", "11px").text(L.t);
  g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.d)).y0(ih).y1((r) => y(r.v))).style("fill", "var(--water)").style("opacity", 0.12);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.v))).style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 2);
  const filled = rows.filter((r) => r.d >= new Date(lake === "mead" ? 1941 : 1980, 0, 1));   // skip the initial filling
  const low = filled.reduce((a, b) => (b.v < a.v ? b : a));
  g.append("circle").attr("cx", x(low.d)).attr("cy", y(low.v)).attr("r", 4.5).style("fill", "var(--water)").style("stroke", "var(--surface)").style("stroke-width", 2);
  const nearEnd = x(low.d) > iw * 0.8;
  g.append("text").attr("class", "label strong").attr("x", nearEnd ? x(low.d) - 10 : x(low.d)).attr("y", y(low.v) + 20).attr("text-anchor", nearEnd ? "end" : "middle")
    .text(`Lowest since filling: ${fmt1(low.v)} ft, ${d3.timeFormat("%b %Y")(low.d)}`);
  const ch = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--axis)").style("opacity", 0);
  svg.on("pointermove", (e) => {
    const [px] = d3.pointer(e, g.node());
    const r = rows[d3.bisector((q) => q.d).center(rows, x.invert(px))];
    ch.attr("x1", x(r.d)).attr("x2", x(r.d)).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, d3.timeFormat("%B %Y")(r.d)), tipRow(cssVar("--water"), `${fmt1(r.v)} ft`, "monthly mean elevation")));
  }).on("pointerleave", () => { ch.style("opacity", 0); tip.hide(); });
}

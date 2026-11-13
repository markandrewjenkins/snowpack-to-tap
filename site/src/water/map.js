// The page's centrepiece: snowpack → rivers → reservoirs → taps on one interactive map.
// SNOTEL sites coloured by snowpack vs median, basin outlines, rivers, aqueducts, reservoir "teacups"
// filled to today's storage, and the cities at the end of the pipes. Data: map.json (pipelines/water/build.py).
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as d3 from "d3";
import { el, cssVar, tipRow, fmtInt } from "../shared/ui.js";

const MAP_STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const BOUNDS = [[-124.4, 31.2], [-104.8, 43.7]];
const fmt1 = d3.format(",.1f"), fmt2 = d3.format(",.2f"), pct = (v) => `${Math.round(v * 100)}%`;
const md = (iso) => new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
// label anchors nudged off the busiest spots (the computed centroid of the Lower Colorado sits on Phoenix)
const LABEL_AT = { "Lower Colorado": [-113.3, 34.35], "Upper Colorado": [-109.6, 38.2], Sacramento: [-121.25, 41.5], "San Joaquin": [-120.35, 36.5] };
const HUC = { "Upper Colorado": "HUC 14", "Lower Colorado": "HUC 15", Sacramento: "HUC 1802", "San Joaquin": "HUC 1804" };

// Classic basemap tint: quiet the basemap so the water reads first.
const BASEMAP = {
  light: { bg: "#ebe8e1", water: "#c3d2dc", green: "#e2e0d5", resid: "#e3dfd5", road: "#dcd6ca", boundary: "#aaa499", label: "#66625b", halo: "#ebe8e1" },
  dark: { bg: "#1d1d21", water: "#26303b", green: "#222226", resid: "#222125", road: "#323138", boundary: "#55525b", label: "#a9a5af", halo: "#1d1d21" },
};

/**
 * @param {{ W: object, M: object, tip: object, isDark: () => boolean, onSwe: (v: number) => void }} o
 */
export function initWaterMap({ W, M, tip, isDark, onSwe }) {
  const host = document.getElementById("wmap");
  const shell = host.closest(".wmap");
  const S = M.snow;
  const C = Object.fromEntries(S.cols.map((c, i) => [c, i]));
  const rankedNow = S.rows.filter((r) => r[C.pct] != null).length;
  const state = {
    when: rankedNow >= S.rows.length * 0.2 ? "now" : "apr1",
    layers: { snow: true, rivers: true, basins: true, reservoirs: true, aqueducts: true, taps: true },
    selected: null, inflow: null,
  };
  const scen = M.powell_scenario;
  const pad = () => (host.clientWidth < 520 ? 6 : 24);
  const resById = new Map(M.reservoirs.map((r) => [r.id, r]));
  const maxCap = d3.max(M.reservoirs, (r) => r.capacity);

  const map = new maplibregl.Map({
    container: host, style: isDark() ? MAP_STYLE.dark : MAP_STYLE.light, bounds: BOUNDS, fitBoundsOptions: { padding: pad() },
    attributionControl: { compact: true }, cooperativeGestures: true, minZoom: 3.2, maxZoom: 11, dragRotate: false, pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl({
    onAdd() {
      this._c = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group wm-home" },
        el("button", { type: "button", title: "Show the whole region", "aria-label": "Show the whole region", onclick: () => resetView() },
          el("span", { "aria-hidden": "true" }, "⤢")));
      return this._c;
    },
    onRemove() { this._c.remove(); },
  }, "top-right");
  new ResizeObserver(() => map.resize()).observe(host);
  if (import.meta.env.DEV) window.__map = map;   // handle for headless visual checks

  // ---------------------------------------------------------------- basemap + data layers
  // data layers first, so the skin can restyle their halos when it hears water:basemap
  map.on("style.load", () => { addLayers(); applyVisibility(); tintBasemap(); });
  map.on("zoom", onZoom);
  function onZoom() {
    const z = map.getZoom();
    shell.classList.toggle("wm-near", z >= 6.3);
    const k = Math.max(0.5, Math.min(1.25, 0.62 + (z - 4.6) * 0.22));
    for (const [, m] of resMarkers) {
      const kk = m.big ? Math.max(z < 4 ? 0.65 : 0.85, k) : k;
      m.node.firstChild.setAttribute("width", (m.cup.w + 4) * kk);
      m.node.firstChild.setAttribute("height", (m.cup.h + 4) * kk);
    }
  }
  map.on("load", () => host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));

  function tintBasemap() {
    const P = BASEMAP[isDark() ? "dark" : "light"];
    for (const layer of map.getStyle().layers) {
      const id = layer.id;
      if (id.startsWith("wm-")) continue;
      const set = (prop, v) => { try { map.setPaintProperty(id, prop, v); } catch { /* not applicable */ } };
      if (layer.type === "background") set("background-color", P.bg);
      else if (layer.type === "fill") {
        if (/water/.test(id)) set("fill-color", P.water);
        else if (/park|wood|grass|glacier|ice/.test(id)) set("fill-color", P.green);
        else if (/residential|building|aeroway/.test(id)) set("fill-color", P.resid);
      } else if (layer.type === "line") {
        if (/waterway/.test(id)) set("line-color", P.water);
        else if (/boundary/.test(id)) set("line-color", P.boundary);
        else if (/highway|road|tunnel|railway|aeroway/.test(id)) { set("line-color", P.road); set("line-opacity", 0.7); }
      } else if (layer.type === "symbol") {
        if (/highway|road_shield|shield/.test(id)) { try { map.setLayoutProperty(id, "visibility", "none"); } catch { /* */ } }
        else { set("text-color", P.label); set("text-halo-color", P.halo); }
      }
    }
    window.dispatchEvent(new CustomEvent("water:basemap", { detail: { map } }));
  }

  const ramp = () => ({ dry: cssVar("--snow-dry"), mid: cssVar("--snow-mid"), wet: cssVar("--snow-wet") });
  const rampScale = () => { const r = ramp(); return d3.scaleLinear([0, 1, 2], [r.dry, r.mid, r.wet]).interpolate(d3.interpolateLab).clamp(true); };

  function stationFC() {
    const k = state.when === "now" ? C.pct : C.pct_apr1;
    return { type: "FeatureCollection", features: S.rows.map((r, i) => ({
      type: "Feature", id: i, geometry: { type: "Point", coordinates: [r[C.lon], r[C.lat]] },
      properties: r[k] == null ? { i } : { i, p: r[k] } })) };
  }
  // One label per river, at a chosen share of the way along its longest stretch, rotated to follow it.
  const RIVER_AT = { Colorado: 0.62, Green: 0.3, "San Juan": 0.5, Sacramento: 0.5, "San Joaquin": 0.45 };
  function riverLabelPoints() {
    const merc = ([x, y]) => [x * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360))];
    const best = new Map();
    for (const f of M.rivers.features) for (const line of f.geometry.coordinates) {
      const P = line.map(merc);
      let len = 0;
      const cum = P.map((p, k) => (k ? (len += Math.hypot(p[0] - P[k - 1][0], p[1] - P[k - 1][1])) : 0));
      if (!best.has(f.properties.name) || len > best.get(f.properties.name).len) best.set(f.properties.name, { line, P, cum, len });
    }
    return { type: "FeatureCollection", features: [...best].map(([name, { line, P, cum, len }]) => {
      const t = (RIVER_AT[name] ?? 0.5) * len;
      const k = Math.max(1, cum.findIndex((c) => c >= t));
      const a = P[Math.max(0, k - 2)], b = P[Math.min(P.length - 1, k + 1)];
      let angle = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI;
      if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
      const f = (t - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
      const at = [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * f, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * f];
      return { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { name, angle: Math.round(angle) } };
    }) };
  }

  function addLayers() {
    const water = cssVar("--water"), ink = cssVar("--ink"), ink2 = cssVar("--ink-2"), muted = cssVar("--muted");
    const bg = BASEMAP[isDark() ? "dark" : "light"].bg;
    const r = ramp();
    map.addSource("wm-basins", { type: "geojson", data: M.basins, attribution: "Basins: USGS WBD" });
    map.addSource("wm-rivers", { type: "geojson", data: M.rivers, attribution: "Rivers: Natural Earth" });
    map.addSource("wm-aqueducts", { type: "geojson", data: M.aqueducts });
    map.addSource("wm-stations", { type: "geojson", data: stationFC(), attribution: "Snow: USDA NRCS SNOTEL" });
    map.addLayer({ id: "wm-basin-fill", type: "fill", source: "wm-basins", paint: { "fill-color": water, "fill-opacity": 0.07 } });
    map.addLayer({ id: "wm-basin-line", type: "line", source: "wm-basins", paint: {
      "line-color": water, "line-opacity": 0.6, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1, 8, 2], "line-dasharray": [3, 2] } });
    map.addLayer({ id: "wm-rivers", type: "line", source: "wm-rivers", layout: { "line-cap": "round", "line-join": "round" }, paint: {
      "line-color": water, "line-opacity": 0.9,
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["get", "major"], 2, 1.3], 8, ["case", ["get", "major"], 4, 2.6]] } });
    map.addSource("wm-river-pts", { type: "geojson", data: riverLabelPoints() });
    map.addLayer({ id: "wm-river-labels", type: "symbol", source: "wm-river-pts", layout: {
      "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 12, "text-letter-spacing": 0.04,
      "text-rotate": ["get", "angle"], "text-rotation-alignment": "map", "text-offset": [0, -0.75] },
      paint: { "text-color": water, "text-halo-color": bg, "text-halo-width": 1.8 } });
    map.addLayer({ id: "wm-aqueducts-casing", type: "line", source: "wm-aqueducts", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": bg, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3.4, 8, 6], "line-opacity": 0.85 } });
    map.addLayer({ id: "wm-aqueducts", type: "line", source: "wm-aqueducts", layout: { "line-join": "round" }, paint: {
      "line-color": ink2, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 8, 2.6], "line-dasharray": [2, 1.4] } });
    map.addLayer({ id: "wm-stations-none", type: "circle", source: "wm-stations", filter: ["!", ["has", "p"]], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 8, 6], "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": muted, "circle-stroke-width": 1.4 } });
    map.addLayer({ id: "wm-stations", type: "circle", source: "wm-stations", filter: ["has", "p"], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["boolean", ["feature-state", "hover"], false], 6.5, 4.6], 8, 9],
      "circle-color": ["interpolate-lab", ["linear"], ["get", "p"], 0, r.dry, 1, r.mid, 2, r.wet],
      "circle-stroke-color": isDark() ? bg : ink, "circle-stroke-opacity": isDark() ? 0.9 : 0.5,
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 1] } });
  }

  const LAYERS = {
    snow: ["wm-stations", "wm-stations-none"], rivers: ["wm-rivers", "wm-river-labels"], basins: ["wm-basin-fill", "wm-basin-line"],
    aqueducts: ["wm-aqueducts-casing", "wm-aqueducts"],
  };
  function applyVisibility() {
    for (const [k, ids] of Object.entries(LAYERS)) for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.layers[k] ? "visible" : "none");
    for (const k of ["reservoirs", "taps", "basins"]) shell.classList.toggle(`wm-hide-${k}`, !state.layers[k]);
  }

  // ---------------------------------------------------------------- station hover (and tap on touch screens)
  let hoverId = null;
  const setHover = (id) => {
    if (hoverId === id) return;
    if (hoverId != null && map.getSource("wm-stations")) map.setFeatureState({ source: "wm-stations", id: hoverId }, { hover: false });
    hoverId = id;
    if (id != null) map.setFeatureState({ source: "wm-stations", id }, { hover: true });
  };
  for (const layer of ["wm-stations", "wm-stations-none"]) {
    map.on("mousemove", layer, (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features[0];
      setHover(f.id);
      tip.show(e.originalEvent.clientX, e.originalEvent.clientY, (t) => stationTip(t, f.properties.i));
    });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; setHover(null); tip.hide(); });
    map.on("click", layer, (e) => {
      const f = e.features[0];
      tip.show(e.originalEvent.clientX, e.originalEvent.clientY, (t) => stationTip(t, f.properties.i));
    });
  }
  map.on("movestart", () => tip.hide());
  // rivers and aqueducts name themselves on hover (the aqueduct casing is the wider hit target)
  const AQ_NOTE = {
    "California Aqueduct": "State Water Project: from the Sacramento–San Joaquin Delta south through the San Joaquin Valley to Southern California",
    "Colorado River Aqueduct": "Metropolitan Water District: Lake Havasu on the Colorado River to Southern California",
    "Central Arizona Project": "Lake Havasu on the Colorado River to Phoenix and Tucson",
  };
  for (const [layer, note] of [["wm-aqueducts-casing", (n) => AQ_NOTE[n]], ["wm-rivers", () => "River (Natural Earth centreline)"]]) {
    map.on("mousemove", layer, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["wm-stations", "wm-stations-none"] }).length) return;
      const n = e.features[0].properties.name;
      tip.show(e.originalEvent.clientX, e.originalEvent.clientY, (t) => t.append(el("div", { class: "t-title" }, n), el("div", { class: "wm-tip-sub" }, note(n))));
    });
    map.on("mouseleave", layer, () => tip.hide());
  }

  function stationTip(t, i) {
    const r = S.rows[i];
    const apr = state.when === "apr1";
    const swe = r[apr ? C.swe_apr1 : C.swe], med = r[apr ? C.median_apr1 : C.median], p = r[apr ? C.pct_apr1 : C.pct];
    const when = apr ? `on ${md(S.apr1)}` : `on ${md(S.date)}`;
    t.append(el("div", { class: "t-title" }, `${r[C.name]} · ${fmtInt.format(r[C.elev_ft])} ft`));
    if (p != null) t.append(tipRow(rampScale()(p), pct(p), `of median ${when}`));
    else t.append(tipRow(null, "—", med == null ? "no 1991–2020 median for this site" : `too early to rank ${when} (median under 1″)`));
    if (swe != null) t.append(tipRow(null, `${fmt1(swe)}″`, "snow water equivalent"));
    if (med != null) t.append(tipRow(null, `${fmt1(med)}″`, "1991–2020 median for the date"));
    t.append(sparkline(i));
    t.append(el("div", { class: "wm-tip-sub" }, r[C.basin] === "sierra" ? "Sierra Nevada" : "Upper Colorado basin"));
  }

  function sparkline(i) {
    const [med, prev, cur] = S.spark[i].map((a) => a.map((v) => (v == null ? null : v / 10)));
    const w = 220, h = 64, m = { l: 4, r: 4, t: 6, b: 14 };
    const n = S.weeks.length;
    const x = d3.scaleLinear([0, n - 1], [m.l, w - m.r]);
    const top = d3.max([...med, ...prev, ...cur].filter((v) => v != null)) || 1;
    const y = d3.scaleLinear([0, top], [h - m.b, m.t]);
    const svg = d3.create("svg").attr("class", "wm-spark").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
    const line = (arr) => d3.line().defined((v) => v != null).x((_, k) => x(k)).y((v) => y(v))(arr);
    svg.append("line").attr("x1", m.l).attr("x2", w - m.r).attr("y1", y(0)).attr("y2", y(0)).style("stroke", "var(--grid)");
    const aprX = x(S.weeks.findIndex((d) => d >= 182));
    svg.append("line").attr("x1", aprX).attr("x2", aprX).attr("y1", m.t).attr("y2", h - m.b).style("stroke", "var(--axis)").style("stroke-dasharray", "2 2");
    svg.append("path").attr("d", line(med)).style("fill", "none").style("stroke", "var(--muted)").style("stroke-width", 1.5).style("stroke-dasharray", "3 2");
    svg.append("path").attr("d", line(prev)).style("fill", "none").style("stroke", "var(--water)").style("stroke-width", 2);
    if (cur.some((v) => v != null && v > 0)) svg.append("path").attr("d", line(cur)).style("fill", "none").style("stroke", "var(--ink)").style("stroke-width", 2);
    for (const [k, lab] of [[0, "Oct"], [13, "Jan"], [26, "Apr"], [39, "Jul"]]) svg.append("text").attr("x", x(k)).attr("y", h - 2).text(lab)
      .style("font-size", "9.5px").style("fill", "var(--muted)");
    return el("div", { class: "wm-spark-wrap" }, svg.node(),
      el("div", { class: "wm-spark-key" },
        el("span", {}, el("i", { style: { background: "var(--water)" } }), `${S.wy - 1} season`),
        cur.some((v) => v != null && v > 0) ? el("span", {}, el("i", { style: { background: "var(--ink)" } }), `${S.wy} so far`) : null,
        el("span", {}, el("i", { class: "dash" }), "median")));
  }

  // ---------------------------------------------------------------- reservoirs as teacups
  const cupW = (r) => Math.round(15 + 25 * Math.sqrt(r.capacity / maxCap));
  const resMarkers = new Map();
  function cupSvg(r) {
    const w = cupW(r), h = Math.round(w * 0.8);
    const top = w, bot = w * 0.56;
    const yAt = (f) => h - (h - 2) * f;
    const half = (f) => (bot + (top - bot) * f) / 2;
    const poly = (f0, f1) => `M${w / 2 - half(f0)},${yAt(f0)}L${w / 2 - half(f1)},${yAt(f1)}L${w / 2 + half(f1)},${yAt(f1)}L${w / 2 + half(f0)},${yAt(f0)}Z`;
    const svg = d3.create("svg").attr("viewBox", `-2 -2 ${w + 4} ${h + 4}`).attr("width", w + 4).attr("height", h + 4).attr("aria-hidden", "true");
    svg.append("path").attr("class", "wm-cup-body").attr("d", poly(0, 1));
    svg.append("path").attr("class", "wm-cup-fill").attr("d", poly(0, Math.min(1, r.pct_capacity)));
    if (r.id === "powell") svg.append("g").attr("class", "wm-cup-scen");
    if (r.pct_avg_of_capacity) {
      const f = Math.min(1, r.pct_avg_of_capacity);
      svg.append("line").attr("class", "wm-cup-avg").attr("x1", w / 2 - half(f) - 3).attr("x2", w / 2 + half(f) + 3).attr("y1", yAt(f)).attr("y2", yAt(f));
    }
    svg.append("path").attr("class", "wm-cup-rim").attr("d", poly(0, 1));
    return { node: svg.node(), w, h, yAt, half };
  }
  for (const r of M.reservoirs) {
    const cup = cupSvg(r);
    const big = r.region === "colorado";
    const node = el("button", { type: "button", class: `wm-res${big ? " big" : ""}`, "data-id": r.id,
      "aria-label": `${r.name}: ${pct(r.pct_capacity)} full${r.pct_average ? `, ${pct(r.pct_average)} of average for the date` : ""}. Fly there.` },
      cup.node, el("span", { class: "wm-res-name" }, el("b", {}, r.name), el("span", {}, `${pct(r.pct_capacity)} full`)));
    node.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") tip.show(e.clientX, e.clientY, (t) => resTip(t, r)); });
    node.addEventListener("pointerleave", () => tip.hide());
    node.addEventListener("click", (e) => { e.stopPropagation(); tip.hide(); select(r.id, true); });
    const mk = new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([r.lon, r.lat]).addTo(map);
    resMarkers.set(r.id, { mk, node, cup, big });
  }

  function resTip(t, r) {
    t.append(el("div", { class: "t-title" }, `${r.name} · ${md(r.date)}`),
      tipRow(cssVar("--water"), `${pct(r.pct_capacity)} full`, `${fmt2(r.storage / 1e6)} of ${fmt2(r.capacity / 1e6)} MAF`),
      tipRow(cssVar("--ink"), r.pct_average ? pct(r.pct_average) : "—", "of the 1991–2020 average for the date"));
    if (r.elev) t.append(tipRow(null, `${fmt1(r.elev)} ft`, `surface elevation (full pool ${fmtInt.format(r.full_pool)} ft)`));
    if (r.id === "powell" && state.inflow) {
      const s = scenarioPeak(state.inflow.med);
      t.append(tipRow(cssVar("--snow"), `≈${fmtInt.format(Math.round(s.elev))} ft`, `next summer's peak at ${Math.round(state.inflow.swe * 100)}% snowpack`));
    }
    t.append(el("div", { class: "wm-tip-sub" }, "Click to fly there and highlight its chart"));
  }

  // ---------------------------------------------------------------- basin labels and taps (HTML so the skin can style them)
  for (const [name, lon, lat] of M.basin_labels) {
    const at = LABEL_AT[name] || [lon, lat];
    new maplibregl.Marker({ element: el("div", { class: "wm-basin-label", "aria-hidden": "true" }, name, el("small", {}, HUC[name] || "")), anchor: "center" })
      .setLngLat(at).addTo(map);
  }
  for (const [name, lon, lat, via] of M.taps) {
    const node = el("div", { class: "wm-tap", role: "img", "aria-label": `${name}: part of its water comes from ${via}` }, el("i"));
    node.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, name), el("div", { class: "wm-tip-sub" }, `Part of its water comes from ${via}.`))));
    node.addEventListener("pointerleave", () => tip.hide());
    new maplibregl.Marker({ element: node, anchor: "bottom", offset: [0, -12] }).setLngLat([lon, lat]).addTo(map);
  }

  // ---------------------------------------------------------------- Powell scenario: snowpack → inflow → next summer's peak
  const stageElev = (s) => {
    const T = scen.stage;
    if (s <= T[0][0]) return T[0][1] + (s - T[0][0]) * (T[1][1] - T[0][1]) / (T[1][0] - T[0][0]);
    for (let k = 1; k < T.length; k++) if (s <= T[k][0]) return T[k - 1][1] + (s - T[k - 1][0]) * (T[k][1] - T[k - 1][1]) / (T[k][0] - T[k - 1][0]);
    const a = T.at(-2), b = T.at(-1);
    return b[1] + (s - b[0]) * (b[1] - a[1]) / (b[0] - a[0]);
  };
  function scenarioPeak(inflowMaf) {
    const s = Math.min(scen.capacity, Math.max(0, scen.a + scen.b * inflowMaf));
    return { storage: s, pct: s / scen.capacity, elev: Math.min(W.full_pool.powell, stageElev(s)) };
  }
  function drawScenario() {
    const m = resMarkers.get("powell");
    if (!m || !state.inflow) return;
    const g = d3.select(m.node).select(".wm-cup-scen");
    g.selectAll("*").remove();
    const { yAt, half, w } = m.cup;
    const lo = scenarioPeak(state.inflow.lo).pct, hi = scenarioPeak(state.inflow.hi).pct, mid = scenarioPeak(state.inflow.med).pct;
    g.append("path").attr("class", "wm-scen-band").attr("d", `M${w / 2 - half(lo)},${yAt(lo)}L${w / 2 - half(hi)},${yAt(hi)}L${w / 2 + half(hi)},${yAt(hi)}L${w / 2 + half(lo)},${yAt(lo)}Z`);
    g.append("line").attr("class", "wm-scen-line").attr("x1", w / 2 - half(mid) - 4).attr("x2", w / 2 + half(mid) + 4).attr("y1", yAt(mid)).attr("y2", yAt(mid));
  }

  // ---------------------------------------------------------------- side panel
  const side = {
    when: document.getElementById("wm-when"), whenNote: document.getElementById("wm-when-note"), ramp: document.getElementById("wm-ramp"),
    layers: document.getElementById("wm-layers"), swe: document.getElementById("wm-swe"), sweLabel: document.getElementById("wm-swe-label"),
    scen: document.getElementById("wm-scen"), sel: document.getElementById("wm-sel"),
  };
  function renderWhen() {
    side.when.replaceChildren(...[["apr1", `Apr 1, ${S.apr1.slice(0, 4)}`], ["now", `Latest · ${md(S.date).replace(/, \d{4}$/, "")}`]].map(([k, label]) =>
      el("button", { type: "button", "aria-pressed": String(state.when === k), onclick: () => { state.when = k; renderWhen(); map.getSource("wm-stations")?.setData(stationFC()); } }, label)));
    const k = state.when === "now" ? C.pct : C.pct_apr1;
    const vals = S.rows.map((r) => r[k]).filter((v) => v != null);
    side.whenNote.textContent = state.when === "now"
      ? (vals.length ? `${vals.length} of ${S.rows.length} sites ranked · the median site is at ${pct(d3.median(vals))} of its normal for the date.`
        : `The ${S.wy} snow season has barely started: on ${md(S.date)} no site has enough typical snow (1″ median) to rank yet. Rings mark the sites.`)
      : `Near the usual seasonal peak, the median site held ${pct(d3.median(vals))} of its normal snow (${vals.length} of ${S.rows.length} sites ranked).`;
  }
  function renderRamp() {
    const r = ramp();
    side.ramp.replaceChildren(
      el("div", { class: "wm-ramp-bar", style: { background: `linear-gradient(90deg in oklab, ${r.dry}, ${r.mid}, ${r.wet})` } }),
      el("div", { class: "wm-ramp-ticks" }, ...["0%", "50%", "100%", "150%", "≥200%"].map((t) => el("span", {}, t))),
      el("div", { class: "wm-ramp-cap" }, el("span", {}, "Below median"), el("span", {}, "Above")),
      el("div", { class: "wm-ramp-none" }, el("i", { "aria-hidden": "true" }), "Too early to rank, or no 1991–2020 median"));
  }
  const LAYER_DEFS = [
    ["snow", "Snowpack at SNOTEL sites", "dot"], ["rivers", "Rivers", "river"], ["basins", "River basins (USGS)", "basin"],
    ["reservoirs", "Reservoirs, filled to today", "cup"], ["aqueducts", "Aqueducts", "aq"], ["taps", "Cities served", "tap"],
  ];
  function renderLayers() {
    side.layers.replaceChildren(...LAYER_DEFS.map(([k, label, sw]) => el("li", {},
      el("label", {}, el("input", { type: "checkbox", checked: state.layers[k], onchange: (e) => { state.layers[k] = e.target.checked; applyVisibility(); } }),
        el("i", { class: `wm-sw wm-sw-${sw}`, "aria-hidden": "true" }), el("span", {}, label)))));
  }
  function renderScenario() {
    if (!state.inflow) return;
    const { swe, med, lo, hi } = state.inflow;
    side.swe.value = Math.round(swe * 100);
    side.sweLabel.textContent = `${Math.round(swe * 100)}% of median`;
    const p = scenarioPeak(med), pl = scenarioPeak(lo), ph = scenarioPeak(hi);
    const now = resById.get("powell");
    side.scen.replaceChildren(
      el("div", { class: "wm-scen-out" },
        el("div", {}, el("b", {}, `${fmt1(med)} MAF`), el("span", {}, "April–July inflow")),
        el("div", { class: "arrow", "aria-hidden": "true" }, "→"),
        el("div", {}, el("b", {}, `≈${fmtInt.format(Math.round(p.elev))} ft`), el("span", {}, `Powell's ${scen.spring_year} peak · ${pct(p.pct)} full`))),
      el("p", { class: "wm-fine" }, `From ${fmtInt.format(Math.round(now.elev))} ft today; 80% range ${fmtInt.format(Math.round(pl.elev))}–${fmtInt.format(Math.round(ph.elev))} ft, the band on the Powell cup. `
        + `In ${scen.n} analog years since 2000, next summer's peak storage tracked spring inflow closely (R² ${scen.r2.toFixed(2)}), operations included.`
        + (med > scen.inflow_range[1] * 1.05 || med < scen.inflow_range[0] * 0.95 ? " This inflow is outside the analog years' range, so treat it as a rough extrapolation." : "")));
  }
  side.swe.addEventListener("input", () => onSwe(+side.swe.value));

  function renderSelection() {
    const r = state.selected && resById.get(state.selected);
    side.sel.hidden = !r;
    for (const [id, m] of resMarkers) m.node.classList.toggle("on", id === state.selected);
    if (!r) return;
    side.sel.replaceChildren(
      el("div", { class: "ws-title" }, "Selected reservoir"),
      el("div", { class: "wm-sel-name" }, r.name),
      el("div", { class: "wm-sel-rows" },
        el("div", {}, el("b", {}, pct(r.pct_capacity)), el("span", {}, "full")),
        el("div", {}, el("b", {}, r.pct_average ? pct(r.pct_average) : "—"), el("span", {}, "of average")),
        el("div", {}, el("b", {}, fmt2(r.storage / 1e6)), el("span", {}, "MAF stored"))),
      el("div", { class: "wm-sel-btns" },
        el("button", { type: "button", class: "wm-btn primary", onclick: () => linkedNode()?.scrollIntoView({ behavior: "smooth", block: "center" }) }, "Show its chart ↓"),
        el("button", { type: "button", class: "wm-btn", onclick: () => resetView() }, "Whole region")));
  }

  // ---------------------------------------------------------------- selection ↔ charts below
  function linkedNode(id = state.selected) {
    if (!id) return null;
    if (id === "powell" || id === "mead") return document.getElementById(`proj-${id}`)?.closest(".card");
    return document.querySelector(`#teacups .cup[data-res="${id}"]`);
  }
  function applyLink() {
    document.querySelectorAll(".wm-linked").forEach((n) => n.classList.remove("wm-linked"));
    linkedNode()?.classList.add("wm-linked");
  }
  function select(id, fly) {
    state.selected = id;
    const r = resById.get(id);
    if (fly && r) map.flyTo({ center: [r.lon, r.lat + 0.12], zoom: r.region === "colorado" ? 6.9 : 8, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1800, essential: true });
    renderSelection();
    applyLink();
  }
  function resetView() {
    state.selected = null;
    renderSelection();
    applyLink();
    map.fitBounds(BOUNDS, { padding: pad(), duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
  }

  renderWhen(); renderRamp(); renderLayers();
  onZoom();

  return {
    map,
    setInflow(q) { state.inflow = q; renderScenario(); drawScenario(); },
    restyle() { map.setStyle(isDark() ? MAP_STYLE.dark : MAP_STYLE.light, { diff: false }); renderRamp(); },
    applyLink,
  };
}

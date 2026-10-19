// "Hoover Deco" skin extras: a gauge-reading live strip, a WPA-poster hero badge and a footer flavour line.
// Built only while the alt skin is active; removed on switch back. Uses only data main.js already loaded.

const root = document.documentElement;
// Winged drop: a nod to the "Winged Figures of the Republic", drawn as deco feathers around a drop of water.
const EMBLEM = `<svg viewBox="0 0 120 60" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square">
  <g><path d="M48 46H30M48 40H22M48 34H14M48 28H8M48 22H12"/><path d="M48 46V20"/></g>
  <g transform="matrix(-1 0 0 1 120 0)"><path d="M48 46H30M48 40H22M48 34H14M48 28H8M48 22H12"/><path d="M48 46V20"/></g>
  <path d="M60 8C60 8 51 22 51 31a9 9 0 0 0 18 0C69 22 60 8 60 8Z" fill="currentColor" stroke="none"/>
  <path d="M40 54H80M46 58H74" stroke-width="1.6"/>
</svg>`;

const S = { W: null, inflow: null };
let strip, badge, flavour;

const f1 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const on = () => root.dataset.skin === "alt";

/** main.js pushes data here: skinData({ W }) after load, skinData({ inflow }) whenever the forecaster updates. */
export function skinData(patch) { Object.assign(S, patch); sync(); }

window.addEventListener("skinchange", sync);
sync();

function sync() {
  if (!on()) { strip?.remove(); badge?.remove(); flavour?.remove(); strip = badge = flavour = null; return; }
  build();
  fill();
}

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function build() {
  if (!strip) {
    strip = h("div", "deco-strip");
    strip.setAttribute("aria-hidden", "true");
    const inner = h("div", "ds-in");
    for (const k of ["live", "mead", "powell", "snow", "inflow", "asof"]) {
      const it = h("div", `ds-item ds-${k}`);
      it.dataset.k = k;
      if (k === "live") it.append(h("i", "ds-dot"), h("span", "ds-k", "Gauge readings"));
      else it.append(h("span", "ds-k"), h("span", "ds-v", "—"), h("span", "ds-s"));
      inner.append(it);
    }
    strip.append(inner);
    document.querySelector(".topbar")?.after(strip);
  }
  if (!badge) {
    badge = h("div", "deco-badge");
    badge.setAttribute("aria-hidden", "true");
    badge.innerHTML = EMBLEM;
    badge.append(h("span", "b1", "Bureau of Open Data"), h("span", "b2", "Colorado River Project"), h("span", "b3", "Records from 1935"));
    document.querySelector(".hero > .wrap")?.prepend(badge);
  }
  if (!flavour) {
    flavour = h("span", "deco-flavour", "3.25 million cubic yards of concrete · one JSON file");
    flavour.setAttribute("aria-hidden", "true");
    document.querySelector("footer.site .wrap")?.append(flavour);
  }
}

function set(k, key, val, sub) {
  const it = strip?.querySelector(`[data-k="${k}"]`);
  if (!it) return;
  it.querySelector(".ds-k").textContent = key;
  it.querySelector(".ds-v").textContent = val;
  it.querySelector(".ds-s").textContent = sub;
}

function fill() {
  const W = S.W;
  if (!W || !strip) return;
  const lvl = (lake, name) => W.levels[lake].find(([, l]) => l === name)?.[0];
  const mead = W.projections.mead.elev_now, powell = W.projections.powell.elev_now;
  const dead = lvl("mead", "Dead pool") ?? 895, mpp = lvl("powell", "Minimum power pool") ?? 3490;
  set("mead", "Lake Mead", `${f1(mead)} ft`, `${mead >= dead ? "+" : ""}${f1(mead - dead)} ft over dead pool`);
  set("powell", "Lake Powell", `${f1(powell)} ft`, `${powell >= mpp ? "+" : ""}${f1(powell - mpp)} ft over min. power`);
  const uc = W.status.upper_colorado;
  if (uc.swe_pct != null && uc.swe_mean_in > 0.3) set("snow", "Colorado snowpack", `${Math.round(uc.swe_pct * 100)}% of median`, `water year ${uc.wy}`);
  else set("snow", "Colorado snowpack", "Season opening", `last Apr 1: ${uc.last_wy_apr1_pct != null ? Math.round(uc.last_wy_apr1_pct * 100) + "%" : "—"} of median`);
  const q = S.inflow;
  if (q) set("inflow", "Apr–Jul inflow forecast", `${f1(q.med)} MAF`, `at ${Math.round(q.swe * 100)}% snowpack · ${f1(q.lo)}–${f1(q.hi)}`);
  const g = new Date(W.generated);
  set("asof", "Data as of", g.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    g.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase());
}

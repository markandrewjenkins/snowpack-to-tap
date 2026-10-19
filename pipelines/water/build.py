"""Snowpack to Tap: snow indices, Lake Powell inflow forecast, reservoir projections.

  python -m pipelines.water.build

Snow index
    Basin index = Σ SWE / Σ station median SWE for the day (NRCS-style ratio of sums), using
    SNOTEL stations with records back to the mid-1980s. Medians are 1991–2020.
Inflow forecast
    April–July unregulated inflow to Lake Powell (Reclamation), predicted on Jan 1 … May 1 from
    the Upper Colorado snow index, the water-year precipitation index and the previous autumn's
    baseflow. Log-linear regression per issue date, leave-one-year-out validation, prediction
    intervals from the cross-validated residuals.
Lake projections
    Analog-year ensemble: each past year's storage change from today's calendar date is applied
    to current storage and converted back to elevation with the lake's own storage–elevation
    curve. Historical operations are baked into each analog, which is the main caveat.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .config import ANALOG_FROM, FULL_POOL, MEAD_LEVELS, OUT, POWELL_LEVELS, RAW, RESERVOIRS

AF_PER_CFS_DAY = 1.98347
ISSUES = [(1, 1), (2, 1), (3, 1), (4, 1), (5, 1)]


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (pd.Timestamp, date, datetime)):
        return o.isoformat()[:10]
    return o


def dump(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    print(f"  wrote {name} ({(OUT / name).stat().st_size / 1024:,.0f} KB)")


def wy(d: pd.Series) -> pd.Series:
    return d.dt.year + (d.dt.month >= 10)


def wy_day(d: pd.Series) -> pd.Series:
    """Day of water year (Oct 1 = 0), Feb 29 folded onto Feb 28."""
    start = pd.to_datetime((wy(d) - 1).astype(str) + "-10-01")
    days = (d - start).dt.days
    leap_shift = ((d.dt.month > 2) | ((d.dt.month == 2) & (d.dt.day == 29))) & d.dt.is_leap_year & (d.dt.month < 10)
    return (days - leap_shift.astype(int)).clip(upper=364)


# ============================================================================= snow

def snow_index(snotel: pd.DataFrame, stations: pd.DataFrame, element: str):
    d = snotel[snotel.element == element].merge(stations[["stationTriplet", "basin"]], left_on="station", right_on="stationTriplet")
    d["wy"], d["wyd"] = wy(d.date), wy_day(d.date)
    base = d[(d.wy >= 1991) & (d.wy <= 2020)]
    med = base.groupby(["station", "wyd"]).value.median().rename("med")
    enough = base.groupby("station").wy.nunique()
    d = d[d.station.isin(enough[enough >= 20].index)].join(med, on=["station", "wyd"])
    g = d.dropna(subset=["med"]).groupby(["basin", "wy", "wyd"]).agg(v=("value", "sum"), m=("med", "sum"), n=("value", "size"),
                                                                       mean=("value", "mean"))
    g["pct"] = np.where(g.m > 0.5, g.v / g.m, np.nan)
    return g.reset_index()


# ============================================================================= Powell inflow model

def powell_volumes(rise: pd.DataFrame) -> pd.DataFrame:
    q = rise[rise.series == "powell_unreg_inflow"].set_index("date").value
    q = q[~q.index.duplicated()]
    out = []
    for y in range(q.index.year.min() + 1, q.index.year.max() + 1):
        aj = q[f"{y}-04-01":f"{y}-07-31"]
        on = q[f"{y - 1}-10-01":f"{y - 1}-11-30"]
        out.append({"wy": y, "aprjul": aj.sum() * AF_PER_CFS_DAY / 1e6 if len(aj) >= 120 else np.nan,
                    "base": on.mean() if len(on) >= 55 else np.nan})
    return pd.DataFrame(out)


def design(snow: pd.DataFrame, prec: pd.DataFrame, vols: pd.DataFrame, month: int) -> pd.DataFrame:
    wyd = {1: 92, 2: 123, 3: 151, 4: 182, 5: 212}[month]
    s = snow[(snow.basin == "upper_colorado") & (snow.wyd == wyd)][["wy", "pct"]].rename(columns={"pct": "swe"})
    p = prec[(prec.basin == "upper_colorado") & (prec.wyd == wyd)][["wy", "pct"]].rename(columns={"pct": "prec"})
    return vols.merge(s, on="wy", how="left").merge(p, on="wy", how="left")


def fit_ols(X: np.ndarray, y: np.ndarray, ridge: float = 0.05):
    Xa = np.column_stack([np.ones(len(X)), X])
    pen = ridge * np.eye(Xa.shape[1]); pen[0, 0] = 0
    return np.linalg.solve(Xa.T @ Xa + pen, Xa.T @ y)


def predict_ols(beta, X):
    return np.column_stack([np.ones(len(X)), X]) @ beta


def inflow_model(snow, prec, vols):
    out = {}
    for mo, _ in ISSUES:
        d = design(snow, prec, vols, mo)
        cols = ["swe", "prec", "base"]
        train = d.dropna(subset=cols + ["aprjul"]).copy()
        train = train[train.wy >= 1987]
        X = np.column_stack([train.swe, train.prec, np.log(train.base)])
        y = np.log(train.aprjul.to_numpy())
        preds = np.zeros(len(train))
        for i in range(len(train)):
            m = np.arange(len(train)) != i
            preds[i] = predict_ols(fit_ols(X[m], y[m]), X[i:i + 1])[0]
        res = y - preds
        vol, pv = train.aprjul.to_numpy(), np.exp(preds)
        clim = np.array([np.median(np.delete(vol, i)) for i in range(len(vol))])
        lo_q, hi_q = np.quantile(res, [0.1, 0.9])
        # honest coverage: each year's interval uses the other years' errors only
        inside = []
        for i in range(len(res)):
            lq, hq = np.quantile(np.delete(res, i), [0.1, 0.9])
            inside.append(lq <= res[i] <= hq)
        cover = float(np.mean(inside))
        beta = fit_ols(X, y)
        # The "what if" slider only sets snowpack, so it gets its own model without the precipitation index.
        # Plugging the slider value in for precipitation as well would double-count snow in very wet or dry years.
        Xs = np.column_stack([train.swe, np.log(train.base)])
        res_s = np.array([y[i] - predict_ols(fit_ols(np.delete(Xs, i, 0), np.delete(y, i)), Xs[i:i + 1])[0] for i in range(len(y))])
        slider = {"beta": fit_ols(Xs, y).tolist(), "res_q": np.quantile(res_s, [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]).tolist()}
        out[f"{mo:02d}-01"] = {
            "n": int(len(train)), "beta": beta.tolist(), "slider": slider, "res_q": np.quantile(res, [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]).tolist(),
            "mae": float(np.mean(np.abs(pv - vol))), "mae_clim": float(np.mean(np.abs(clim - vol))),
            "r2": float(1 - np.sum((vol - pv) ** 2) / np.sum((vol - vol.mean()) ** 2)), "coverage80": float(cover),
            "rows": [[int(w), float(o), float(p), float(p * np.exp(lo_q)), float(p * np.exp(hi_q)), float(s)]
                     for w, o, p, s in zip(train.wy, vol, pv, train.swe)],
            "latest_base": float(d.base.dropna().iloc[-1]) if d.base.notna().any() else None,
        }
        print(f"  inflow model {mo:02d}-01: n={len(train)} R²={out[f'{mo:02d}-01']['r2']:.2f} MAE {out[f'{mo:02d}-01']['mae']:.2f} "
              f"vs clim {out[f'{mo:02d}-01']['mae_clim']:.2f} maf; 80% cover {cover:.0%}")
    return out


# ============================================================================= lake projections

def stage_curve(rise: pd.DataFrame, lake: str):
    st = rise[rise.series == f"{lake}_storage"].set_index("date").value
    el = rise[rise.series == f"{lake}_elev"].set_index("date").value
    j = pd.concat([st, el], axis=1, keys=["s", "e"]).dropna()
    j = j[j.index >= "2010-01-01"]           # recent surveys: sediment shifts the old curve
    bins = np.linspace(j.s.min(), j.s.max(), 80)
    idx = np.digitize(j.s, bins)
    tab = j.groupby(idx).agg(s=("s", "median"), e=("e", "median")).sort_values("s")
    tab["e"] = np.maximum.accumulate(tab.e.to_numpy())
    return tab.s.to_numpy(), tab.e.to_numpy()


def project(rise: pd.DataFrame, lake: str, horizon: int):
    st = rise[rise.series == f"{lake}_storage"].set_index("date").value
    st = st[~st.index.duplicated()].asfreq("D").interpolate(limit=5)
    el = rise[rise.series == f"{lake}_elev"].set_index("date").value
    today = st.dropna().index.max()
    s0 = float(st[today])
    xs, ys = stage_curve(rise, lake)
    to_elev = lambda s: np.interp(s, xs, ys, left=np.nan, right=np.nan)
    # extrapolate linearly below the observed range
    slope = (ys[5] - ys[0]) / (xs[5] - xs[0])
    def elev(s):
        e = to_elev(s)
        return np.where(np.isnan(e) & (s < xs[0]), ys[0] + (s - xs[0]) * slope, np.where(np.isnan(e), ys[-1], e))
    traj = {}
    for y in range(ANALOG_FROM, today.year):
        start = today.replace(year=y)
        seg = st[start:start + pd.Timedelta(days=horizon)]
        if len(seg) < horizon * 0.95 or seg.isna().mean() > 0.05:
            continue
        delta = (seg - seg.iloc[0]).to_numpy()
        traj[y] = elev(s0 + delta)
    dates = [today + pd.Timedelta(days=i) for i in range(horizon + 1)]
    M = np.array([v[: horizon + 1] for v in traj.values() if len(v) >= horizon + 1])
    years = [y for y, v in traj.items() if len(v) >= horizon + 1]
    q = np.nanpercentile(M, [10, 50, 90], axis=0)
    hist = el[el.index >= "1999-01-01"].resample("W").mean().dropna()
    return {"today": today, "elev_now": float(el.dropna().iloc[-1]), "storage_now": s0, "years": years, "dates": dates[::7],
            "trajectories": [row[::7].round(2).tolist() for row in M], "p10": q[0][::7], "p50": q[1][::7], "p90": q[2][::7],
            "M": M, "full_dates": dates, "history": [[d_.date().isoformat(), round(float(v), 2)] for d_, v in hist.items()]}


# ============================================================================= California

def california(cdec: pd.DataFrame):
    out, total = [], []
    today_cut = cdec.date.max()
    for sid, (name, cap, lon, lat) in RESERVOIRS.items():
        d = cdec[cdec.station == sid].set_index("date").storage
        d = d[~d.index.duplicated()]
        if d.empty:
            continue
        last = d.dropna().index.max()
        doy = last.dayofyear
        hist = d[(d.index.year >= 1991) & (d.index.year <= 2020)]
        same = hist[np.abs(hist.index.dayofyear - doy) <= 3]
        avg = float(same.mean()) if len(same) else None
        out.append({"id": sid, "name": name, "capacity": cap, "lon": lon, "lat": lat, "date": last.date().isoformat(),
                    "storage": float(d[last]), "pct_capacity": float(d[last] / cap), "pct_average": float(d[last] / avg) if avg else None,
                    "avg_for_date": avg, "pct_avg_of_capacity": avg / cap if avg else None})
        total.append(d.rename(sid))
    tot = pd.concat(total, axis=1).ffill(limit=5).dropna().sum(axis=1)
    tot = tot[tot.index >= "1990-01-01"]
    cap_total = sum(v[1] for k, v in RESERVOIRS.items())
    hist = tot[(tot.index.year >= 1991) & (tot.index.year <= 2020)]
    by_doy = hist.groupby(hist.index.dayofyear).agg(["mean", lambda s: s.quantile(0.1), lambda s: s.quantile(0.9)])
    by_doy.columns = ["mean", "p10", "p90"]
    recent = tot[tot.index >= (today_cut - pd.DateOffset(years=12))].resample("W").mean()
    series = [[d_.date().isoformat(), round(v / 1e6, 3), round(by_doy["mean"].get(d_.dayofyear, np.nan) / 1e6, 3),
               round(by_doy["p10"].get(d_.dayofyear, np.nan) / 1e6, 3), round(by_doy["p90"].get(d_.dayofyear, np.nan) / 1e6, 3)]
              for d_, v in recent.items()]
    return {"reservoirs": out, "total": series, "capacity_total": cap_total}


def snow_curves(snotel: pd.DataFrame, stations: pd.DataFrame):
    d = snotel[snotel.element == "WTEQ"].merge(stations[["stationTriplet", "basin"]], left_on="station", right_on="stationTriplet")
    d["wy"], d["wyd"] = wy(d.date), wy_day(d.date)
    # basin-average SWE over stations with long records
    long = d.groupby("station").wy.nunique()
    d = d[d.station.isin(long[long >= 30].index)]
    g = d.groupby(["basin", "wy", "wyd"]).value.mean().reset_index()
    out = {}
    for basin, b in g.groupby("basin"):
        piv = b.pivot(index="wyd", columns="wy", values="value")
        base = piv[[c for c in piv.columns if 1991 <= c <= 2020]]
        cur = int(piv.columns.max())
        notable = {"upper_colorado": [2002, 2011, 2021, 2023], "sierra": [2015, 2017, 2021, 2023]}[basin]
        out[basin] = {
            "wyd": piv.index.tolist(), "median": base.median(axis=1).round(2).tolist(),
            "p10": base.quantile(0.1, axis=1).round(2).tolist(), "p90": base.quantile(0.9, axis=1).round(2).tolist(),
            "years": {str(y): piv[y].round(2).tolist() for y in sorted(set(notable + [cur - 1, cur])) if y in piv.columns},
            "current_wy": cur, "peak_median": float(base.median(axis=1).max()),
            "n_stations": int(d[d.basin == basin].station.nunique()),
        }
    return out


# ============================================================================= main

def main():
    rise = pd.read_parquet(RAW / "rise.parquet")
    snotel = pd.read_parquet(RAW / "snotel.parquet")
    stations = pd.read_parquet(RAW / "snotel_stations.parquet")
    cdec = pd.read_parquet(RAW / "cdec_storage.parquet")
    gen = datetime.now(timezone.utc).isoformat(timespec="minutes")

    swe = snow_index(snotel, stations, "WTEQ")
    prec = snow_index(snotel, stations, "PREC")
    vols = powell_volumes(rise)
    model = inflow_model(swe, prec, vols)

    # current water year status for the Upper Colorado and Sierra
    status = {}
    for basin in ["upper_colorado", "sierra"]:
        s = swe[swe.basin == basin]
        cur = s[s.wy == s.wy.max()].sort_values("wyd")
        p = prec[prec.basin == basin]
        pc = p[p.wy == p.wy.max()].sort_values("wyd")
        status[basin] = {"wy": int(s.wy.max()), "wyd": int(cur.wyd.iloc[-1]) if len(cur) else None,
                         "swe_pct": float(cur.pct.iloc[-1]) if len(cur) and cur.m.iloc[-1] > 0.5 else None,
                         "swe_mean_in": float(cur["mean"].iloc[-1]) if len(cur) else None,
                         "prec_pct": float(pc.pct.iloc[-1]) if len(pc) else None,
                         "last_wy_apr1_pct": float(s[(s.wy == s.wy.max() - 1) & (s.wyd == 182)].pct.iloc[0]) if len(s[(s.wy == s.wy.max() - 1) & (s.wyd == 182)]) else None}

    # projections: Powell 12 months, Mead to Jan 1 of the year after next (~15 months)
    today = rise.date.max()
    mead_h = (pd.Timestamp(today.year + 1, 12, 31) - today).days
    proj = {"powell": project(rise, "powell", 365), "mead": project(rise, "mead", mead_h)}
    risk = {}
    for lake, levels in [("powell", POWELL_LEVELS), ("mead", MEAD_LEVELS)]:
        P = proj[lake]
        M = P.pop("M")
        dates = P.pop("full_dates")
        mins = np.nanmin(M, axis=1)
        risk[lake] = [{"elev": e, "label": lbl, "p_below_any": float(np.mean(mins < e))} for e, lbl in levels]
        if lake == "mead":
            jan = pd.Timestamp(today.year + 2, 1, 1) - pd.Timedelta(days=1)
            k = min(len(dates) - 1, (jan - P["today"]).days)
            end = M[:, k]
            P["jan1_date"] = (pd.Timestamp(today.year + 2, 1, 1)).date().isoformat()
            P["jan1"] = {"p10": float(np.percentile(end, 10)), "p50": float(np.percentile(end, 50)), "p90": float(np.percentile(end, 90))}
            for rk in risk[lake]:
                rk["p_below_jan1"] = float(np.mean(end < rk["elev"]))
        print(f"  {lake}: now {P['elev_now']:.1f} ft; analogs {len(P['years'])}; " +
              ", ".join(f"P(<{r['elev']})={r['p_below_any']:.0%}" for r in risk[lake][:3]))

    rise_hist = {}
    for lake in ["mead", "powell"]:
        el = rise[rise.series == f"{lake}_elev"].set_index("date").value
        rise_hist[lake] = [[d_.date().isoformat(), round(float(v), 1)] for d_, v in el.resample("MS").mean().dropna().items()]

    dump("water.json", {
        "generated": gen, "status": status, "inflow_model": model,
        "volumes": [[int(r.wy), r.aprjul, r.base] for r in vols.itertuples()],
        "projections": proj, "risk": risk, "levels": {"mead": MEAD_LEVELS, "powell": POWELL_LEVELS}, "full_pool": FULL_POOL,
        "lake_history": rise_hist,
        "snow_curves": snow_curves(snotel, stations),
        "california": california(cdec),
        "stations": stations[["stationTriplet", "name", "latitude", "longitude", "basin", "elevation"]].values.tolist(),
    })


if __name__ == "__main__":
    main()

"""Download inputs for Snowpack to Tap.

  python -m pipelines.water.fetch [rise|snotel|cdec|geo|all]

`geo` downloads the map geometry once (basin outlines, rivers, aqueducts). It changes rarely, so `all` skips it
when the raw files already exist.
"""
from __future__ import annotations

import io
import json
import sys
import time
from datetime import date

import pandas as pd
import requests

from pipelines.common.http import USER_AGENT, get_json
from pipelines.common.osm import overpass

from .config import (AQUEDUCTS, AWDB, CDEC, MAP_BBOX, NE_RIVERS, RAW, RESERVOIR_START, RESERVOIRS, RISE_CSV, RISE_ITEMS,
                     SNOTEL_START, WBD, WBD_UNITS)

S = requests.Session()
S.headers["User-Agent"] = USER_AGENT


def save(df: pd.DataFrame, name: str) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    df.to_parquet(RAW / f"{name}.parquet", index=False)


def rise() -> None:
    frames = []
    for name, item in RISE_ITEMS.items():
        r = S.get(RISE_CSV, params={"type": "csv", "itemId": item, "after": "1930-01-01",
                                    "before": date.today().isoformat(), "filename": name}, timeout=300)
        r.raise_for_status()
        text = r.text
        # the CSV starts with a metadata preamble; the data block follows the "#SERIES DATA#" line
        lines = text.splitlines()
        start = next(i for i, line in enumerate(lines) if "#SERIES DATA#" in line) + 1
        df = pd.read_csv(io.StringIO("\n".join(lines[start:])))
        df.columns = [c.strip().lower() for c in df.columns]
        tcol = next(c for c in df.columns if c.startswith("datetime"))
        vcol = next(c for c in df.columns if c.startswith("result"))
        out = pd.DataFrame({"date": pd.to_datetime(df[tcol], utc=True).dt.tz_convert(None).dt.normalize(),
                            "value": pd.to_numeric(df[vcol], errors="coerce"), "series": name})
        frames.append(out.dropna())
        print(f"  {name:<20} {len(out):,} days {out.date.min():%Y-%m-%d} → {out.date.max():%Y-%m-%d}", flush=True)
        time.sleep(1)
    save(pd.concat(frames, ignore_index=True), "rise")


def snotel() -> None:
    stations = get_json(f"{AWDB}/stations", {"stationTriplets": "*:*:SNTL", "activeOnly": "true",
                                             "returnStationElements": "false"}, timeout=180)
    st = pd.DataFrame(stations)
    st["basin"] = None
    st.loc[st.huc.astype(str).str.startswith("14"), "basin"] = "upper_colorado"
    st.loc[st.stateCode.eq("CA") | (st.stateCode.eq("NV") & st.huc.astype(str).str.startswith("1605")), "basin"] = "sierra"
    st = st[st.basin.notna() & (pd.to_datetime(st.beginDate).dt.year <= SNOTEL_START + 1)]
    save(st[["stationTriplet", "name", "stateCode", "huc", "elevation", "latitude", "longitude", "basin", "beginDate"]], "snotel_stations")
    print(f"  SNOTEL stations: {st.basin.value_counts().to_dict()}", flush=True)
    rows = []
    trips = st.stationTriplet.tolist()
    for i in range(0, len(trips), 8):
        batch = trips[i:i + 8]
        d = get_json(f"{AWDB}/data", {"stationTriplets": ",".join(batch), "elements": "WTEQ,PREC", "duration": "DAILY",
                                      "beginDate": f"{SNOTEL_START - 1}-10-01", "endDate": date.today().isoformat()},
                     min_interval=0.5, timeout=300)
        for stn in d:
            for el in stn.get("data", []):
                code = el["stationElement"]["elementCode"]
                for v in el.get("values", []):
                    if v.get("value") is not None:
                        rows.append((stn["stationTriplet"], code, v["date"], v["value"]))
        print(f"  SNOTEL {min(i + 8, len(trips))}/{len(trips)}", flush=True)
    df = pd.DataFrame(rows, columns=["station", "element", "date", "value"])
    df["date"] = pd.to_datetime(df.date)
    save(df, "snotel")


def cdec() -> None:
    frames = []
    for sid in RESERVOIRS:
        d = get_json(CDEC, {"Stations": sid, "SensorNums": 15, "dur_code": "D", "Start": f"{RESERVOIR_START}-01-01",
                            "End": date.today().isoformat()}, min_interval=0.5, timeout=300)
        df = pd.DataFrame(d)
        df = pd.DataFrame({"station": sid, "date": pd.to_datetime(df.date.str.split(" ").str[0], format="%Y-%m-%d"), "storage": pd.to_numeric(df.value, errors="coerce")})
        df.loc[df.storage < 0, "storage"] = None
        frames.append(df.dropna())
        print(f"  {sid}: {len(df):,} days", flush=True)
    save(pd.concat(frames, ignore_index=True), "cdec_storage")


# ============================================================================= map geometry

def _write_json(obj, name: str) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / name).write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {name} ({(RAW / name).stat().st_size / 1024:,.0f} KB)", flush=True)


def basins() -> None:
    """Watershed Boundary Dataset outlines from the USGS National Map, generalised server-side (~1 km)."""
    feats = []
    for layer, field, codes in WBD_UNITS:
        where = f"{field} IN ({','.join(repr(c) for c in codes)})"
        d = get_json(f"{WBD}/{layer}/query", {"where": where, "outFields": f"{field},name", "returnGeometry": "true",
                                             "outSR": 4326, "maxAllowableOffset": 0.01, "geometryPrecision": 3, "f": "geojson"},
                     min_interval=2, timeout=180)
        for f in d["features"]:
            f["properties"] = {"huc": f["properties"][field], "name": f["properties"]["name"]}
            feats.append(f)
        print(f"  WBD layer {layer}: {[f['properties']['name'] for f in d['features']]}", flush=True)
    _write_json({"type": "FeatureCollection", "features": feats}, "wbd_basins.geojson")


def rivers() -> None:
    """Natural Earth 1:10m river centrelines (public domain), trimmed to the map's bounding box."""
    d = get_json(NE_RIVERS, timeout=300)
    w, s, e, n = MAP_BBOX
    def inside(f):
        g = f.get("geometry") or {}
        lines = g.get("coordinates", []) if g.get("type") == "MultiLineString" else [g.get("coordinates", [])]
        return any(w <= x <= e and s <= y <= n for line in lines for x, y in line[:: max(1, len(line) // 20)])
    feats = [f for f in d["features"] if inside(f)]
    for f in feats:
        f["properties"] = {k: f["properties"].get(k) for k in ("name", "name_en", "featurecla", "scalerank")}
    _write_json({"type": "FeatureCollection", "features": feats}, "ne_rivers.geojson")


def aqueducts() -> None:
    """Aqueduct centrelines from OpenStreetMap (ODbL) by waterway relation, via Overpass."""
    out = []
    for rid, name in AQUEDUCTS.items():
        d = overpass(f"[out:json][timeout:180];relation({rid});way(r);out geom;")
        ways = [[[round(p["lon"], 5), round(p["lat"], 5)] for p in el["geometry"]] for el in d["elements"] if el.get("geometry")]
        out.append({"id": rid, "name": name, "ways": ways})
        print(f"  {name}: {len(ways)} ways", flush=True)
        time.sleep(4)
    _write_json(out, "aqueducts.json")


def geo(force: bool = True) -> None:
    for fname, fn in [("wbd_basins.geojson", basins), ("ne_rivers.geojson", rivers), ("aqueducts.json", aqueducts)]:
        if force or not (RAW / fname).exists():
            fn()


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in [("rise", rise), ("cdec", cdec), ("snotel", snotel), ("geo", lambda: geo(force=what == "geo"))]:
        if what in (name, "all"):
            print(f"{name}…")
            fn()

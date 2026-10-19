"""Download inputs for Snowpack to Tap.

  python -m pipelines.water.fetch [rise|snotel|cdec|all]
"""
from __future__ import annotations

import io
import sys
import time
from datetime import date

import pandas as pd
import requests

from pipelines.common.http import USER_AGENT, get_json

from .config import AWDB, CDEC, RAW, RESERVOIR_START, RESERVOIRS, RISE_CSV, RISE_ITEMS, SNOTEL_START

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


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in [("rise", rise), ("cdec", cdec), ("snotel", snotel)]:
        if what in (name, "all"):
            print(f"{name}…")
            fn()

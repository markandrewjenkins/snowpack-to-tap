# Snowpack to Tap

Snowpack, Lake Powell/Mead projections, Colorado River inflow forecast, California reservoirs. Region: California, Arizona, Colorado River.

**Live dashboard: https://markandrewjenkins.github.io/snowpack-to-tap/**

Built only on free, open government and citizen-science data. A Python pipeline fetches and models the data,
and a static Vite + d3 + MapLibre page presents it. GitHub Actions refreshes everything daily and publishes it
to GitHub Pages.

## Method in brief

- **Snow index:** Σ SWE / Σ 1991–2020 median SWE for the day (NRCS-style) across long-record SNOTEL sites in the Upper Colorado (HUC 14) and the Sierra.
- **Inflow forecast:** Log April–July unregulated inflow to Lake Powell, regressed on the snow index, the water-year precipitation index and the previous autumn's baseflow, with one model per issue date (Jan 1 → May 1).
  - Validated leave-one-year-out, 1987–2026.
  - April 1: R² 0.70, mean absolute error 1.28 MAF vs 2.60 MAF for climatology. Nested 80% intervals cover 75%.
- **Lake projections:** An analog ensemble of 2000–2025 storage changes applied to today's storage and converted with each lake's recent storage–elevation curve. The output is the odds of crossing the 2007-guideline tier lines and Powell's minimum power pool.
- **California:** CDEC daily storage for the 12 largest reservoirs against their 1991–2020 average for the date.
- **Journey map:** One map from snowpack to taps, built into `site/public/data/water/map.json` (~130 KB) by `build.py`.
  - Each long-record SNOTEL site is coloured by SWE as a share of its own 1991–2020 median for the day (7-day smoothed), for the latest day and for the last April 1. Sites whose median is under 1″ count as out of season. The tooltip sparkline shows the season against the median.
  - Reservoirs are cups filled to storage/capacity, with a bar at the 1991–2020 average for the date. Powell and Mead come from RISE. Their dam coordinates and full-pool capacities are in `config.py`, with a source note.
  - The scenario slider is shared with the inflow forecaster. Across the analog years, next summer's peak Powell storage is regressed on that spring's April–July inflow (R² ≈ 0.9). The fit then gives the forecast inflow's peak level, with operations baked in as for the projections.
  - Geometry is fetched once by `python -m pipelines.water.fetch geo` and simplified with Douglas–Peucker in the build:
    - basins: USGS Watershed Boundary Dataset (HUC 14, 15, 1802, 1804), from the National Map `wbd` MapServer;
    - rivers: Natural Earth 1:10m;
    - aqueducts: OpenStreetMap waterway relations through Overpass (California Aqueduct, Colorado River Aqueduct, Central Arizona Project).

## Design

The page has a Classic design and a themed alternative, **Hoover Deco** (1930s bureau of reclamation art deco / the dam at night), switched with the
button in the top bar or with `?skin=alt` / `?skin=classic` in the URL. Each has a day and a night version.

## Running locally

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m pipelines.water.fetch all
.venv/Scripts/python -m pipelines.water.build
cd site && npm ci && npm run dev
```

Data licences are listed at the foot of the dashboard.

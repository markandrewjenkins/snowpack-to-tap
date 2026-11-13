"""Snowpack to Tap configuration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "water" / "raw"
OUT = ROOT / "site" / "public" / "data" / "water"

RISE_CSV = "https://data.usbr.gov/rise/api/result/download"
RISE_ITEMS = {
    "mead_elev": 6123, "mead_storage": 6124, "mead_release": 6125,
    "powell_elev": 508, "powell_storage": 509, "powell_unreg_inflow": 512,
}

AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"
SNOTEL_START = 1985

CDEC = "https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet"
# Major California reservoirs: capacity (acre-feet) from DWR's daily reservoir storage summary
RESERVOIRS = {
    "SHA": ("Shasta", 4_552_000, -122.420, 40.718), "ORO": ("Oroville", 3_537_577, -121.493, 39.540),
    "CLE": ("Trinity", 2_447_650, -122.762, 40.801), "NML": ("New Melones", 2_400_000, -120.525, 37.948),
    "SNL": ("San Luis", 2_041_000, -121.133, 37.033), "DNP": ("Don Pedro", 2_030_000, -120.421, 37.702),
    "BER": ("Berryessa", 1_602_000, -122.104, 38.513), "EXC": ("McClure", 1_024_600, -120.270, 37.585),
    "PNF": ("Pine Flat", 1_000_000, -119.325, 36.833), "FOL": ("Folsom", 977_000, -121.183, 38.683),
    "BUL": ("New Bullards Bar", 966_000, -121.140, 39.393), "MIL": ("Millerton", 520_500, -119.705, 37.001),
}
RESERVOIR_START = 1985

# Lake Mead / Powell reference elevations (ft). Shortage tiers are those of the 2007 Interim Guidelines.
MEAD_LEVELS = [(1075, "Tier 1 shortage"), (1050, "Tier 2a"), (1045, "Tier 2b"), (1025, "Tier 3"), (950, "Minimum power pool"), (895, "Dead pool")]
POWELL_LEVELS = [(3525, "Protection buffer"), (3490, "Minimum power pool"), (3370, "Dead pool")]
FULL_POOL = {"mead": 1229, "powell": 3700}
ANALOG_FROM = 2000           # analog years for the 12-month projections

# ---------------------------------------------------------------- map (snowpack → rivers → reservoirs → taps)
MAP_BBOX = (-125.0, 30.5, -104.0, 44.5)           # west, south, east, north
# USGS Watershed Boundary Dataset (public domain): HUC2 Upper/Lower Colorado, HUC4 Sacramento and San Joaquin
WBD = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer"
WBD_UNITS = [(1, "huc2", ["14", "15"]), (2, "huc4", ["1802", "1804"])]
# Natural Earth 1:10m rivers (public domain)
NE_RIVERS = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson"
MAP_RIVERS = ["Colorado", "Green", "San Juan", "Sacramento", "San Joaquin"]
# OpenStreetMap waterway relations (ODbL) for the big delivery aqueducts
AQUEDUCTS = {3343336: "California Aqueduct", 2528360: "Colorado River Aqueduct", 8513255: "Central Arizona Project"}
# Lake Powell and Lake Mead for the map: dam coordinates (USGS GNIS: Glen Canyon Dam, Hoover Dam) and live capacity
# at full pool (Reclamation: Powell 24.32 MAF at 3,700 ft, Mead 26.12 MAF at 1,229 ft; recent sediment surveys
# trim both by a few percent, so % full here is approximate).
LAKES = {"powell": ("Lake Powell", 24_322_000, -111.4846, 36.9375), "mead": ("Lake Mead", 26_120_000, -114.7377, 36.0160)}
# "Taps": big cities at the end of the delivery system, for map context only (city-centre coordinates; the
# supply links are each utility's own descriptions: SNWA, Central Arizona Project, Metropolitan Water District).
TAPS = [("Las Vegas", -115.14, 36.17, "Lake Mead, through SNWA's intakes"),
        ("Phoenix", -112.07, 33.45, "the Colorado River, through the Central Arizona Project"),
        ("Tucson", -110.97, 32.22, "the Colorado River, through the Central Arizona Project"),
        ("Los Angeles", -118.24, 34.05, "the Colorado River Aqueduct and the State Water Project's California Aqueduct"),
        ("San Diego", -117.16, 32.72, "the Colorado River Aqueduct and the State Water Project's California Aqueduct")]

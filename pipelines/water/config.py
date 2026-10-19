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

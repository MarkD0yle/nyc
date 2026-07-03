from pathlib import Path
from typing import Optional

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = SCRIPTS_DIR / "data"
OUT_DIR = SCRIPTS_DIR / "out"

SEED = 20260703
N_PERSONAS = 3000
MIN_AGE = 18

# 2020-vintage NYC PUMAs, NY state (36)
NYC_PUMA_RANGES = {
    "Bronx": (3701, 3710),
    "Manhattan": (3801, 3810),
    "Staten Island": (3901, 3903),
    "Brooklyn": (4001, 4018),
    "Queens": (4101, 4114),
}

URLS = {
    "person": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_pny.zip",
    "household": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_hny.zip",
    "dictionary": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/PUMS_Data_Dictionary_2024.csv",
    "puma_names": "https://www2.census.gov/geo/docs/reference/puma2020/2020_PUMA_Names.txt",
}

PERSON_FIELDS = ["SERIALNO", "AGEP", "SEX", "RAC1P", "HISP", "SCHL", "PINCP",
                 "ESR", "LANX", "LANP", "JWTRNS", "PUMA", "PWGTP"]
HOUSEHOLD_FIELDS = ["SERIALNO", "TEN", "HINCP", "NP", "GRNTP", "TYPEHUGQ"]


def nyc_puma_codes() -> set[str]:
    return {
        f"{code:05d}"
        for lo, hi in NYC_PUMA_RANGES.values()
        for code in range(lo, hi + 1)
    }


def borough_for_puma(puma: str) -> Optional[str]:
    n = int(puma)
    for borough, (lo, hi) in NYC_PUMA_RANGES.items():
        if lo <= n <= hi:
            return borough
    return None

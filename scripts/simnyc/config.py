import csv
from functools import lru_cache
from pathlib import Path
from typing import Optional

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = SCRIPTS_DIR / "data"
OUT_DIR = SCRIPTS_DIR / "out"
PUMA_CSV = Path(__file__).resolve().parent / "data" / "nyc_pumas_2020.csv"

SEED = 20260703
N_PERSONAS = 3000
MIN_AGE = 18

URLS = {
    "person": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_pny.zip",
    "household": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_hny.zip",
    "dictionary": "https://www2.census.gov/programs-surveys/acs/tech_docs/pums/data_dict/PUMS_Data_Dictionary_2024.csv",
}

PERSON_FIELDS = ["SERIALNO", "AGEP", "SEX", "RAC1P", "HISP", "SCHL", "PINCP",
                 "ESR", "LANX", "LANP", "JWTRNS", "PUMA", "PWGTP"]
HOUSEHOLD_FIELDS = ["SERIALNO", "TEN", "HINCP", "NP", "GRNTP", "TYPEHUGQ"]


@lru_cache(maxsize=1)
def puma_table() -> dict[str, dict]:
    """puma -> {'borough': ..., 'neighborhood': ...} from the committed reference CSV."""
    with open(PUMA_CSV, newline="") as f:
        return {
            row["puma"]: {"borough": row["borough"], "neighborhood": row["neighborhood"]}
            for row in csv.DictReader(f)
        }


def nyc_puma_codes() -> set[str]:
    return set(puma_table())


def borough_for_puma(puma: str) -> Optional[str]:
    rec = puma_table().get(str(puma).zfill(5))
    return rec["borough"] if rec else None

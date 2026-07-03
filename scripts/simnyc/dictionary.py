import csv
from pathlib import Path
from typing import Optional

import requests

from .config import DATA_DIR, HOUSEHOLD_FIELDS, PERSON_FIELDS, URLS

WANTED = set(PERSON_FIELDS) | set(HOUSEHOLD_FIELDS)


def load_decode_maps(path: Optional[Path] = None) -> dict[str, dict[str, str]]:
    if path is None:
        path = DATA_DIR / "PUMS_Data_Dictionary_2024.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            r = requests.get(URLS["dictionary"], timeout=120)
            r.raise_for_status()
            path.write_bytes(r.content)
    maps: dict[str, dict[str, str]] = {}
    with open(path, newline="", encoding="latin-1") as f:
        for row in csv.reader(f):
            # Range rows (from != to, e.g. AGEP 0..99) are keyed by `from` only —
            # numeric-range variables are not decodable via these maps. Fine here:
            # the pipeline only decodes categorical vars (SEX, RAC1P, SCHL, ...).
            if len(row) >= 7 and row[0] == "VAL" and row[1] in WANTED:
                var, code_from, label = row[1], row[4].strip(), row[6].strip()
                maps.setdefault(var, {})[code_from.lstrip("0") or "0"] = label
                maps[var][code_from] = label  # keep zero-padded form too
    return maps

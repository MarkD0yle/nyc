import json
import math
from typing import Optional

import pandas as pd

from .config import OUT_DIR
from .puma import load_lookup


def _num(v) -> Optional[float]:
    if v is None or (isinstance(v, float) and math.isnan(v)) or pd.isna(v):
        return None
    return float(v)


def _context_notes(card: dict) -> str:
    notes: list[str] = []
    rent, hinc = card["gross_rent"], card["household_income"]
    if card["housing"] == "renter" and rent and hinc and hinc > 0:
        ratio = rent * 12 / hinc
        pct = round(ratio * 100)
        if ratio >= 0.5:
            notes.append(f"Severely rent-burdened; rent-to-income ratio ~{pct}%")
        elif ratio >= 0.3:
            notes.append(f"Rent-burdened; rent-to-income ratio ~{pct}%")
        else:
            notes.append(f"Renter; rent-to-income ratio ~{pct}%")
    elif card["housing"] == "owner":
        notes.append("Homeowner")
    if card["language_at_home"] not in (None, "English only"):
        notes.append(f"Speaks {card['language_at_home']} at home")
    if card["employment"] == "Unemployed":
        notes.append("Currently unemployed")
    return "; ".join(notes[:2])


def build_card(row: dict, puma_lookup: dict) -> dict:
    puma = str(row["PUMA"]).zfill(5)
    geo = puma_lookup.get(puma, {})
    card = {
        "puma": puma,
        "borough": geo.get("borough"),
        "neighborhood": geo.get("neighborhood"),
        "age": int(row["AGEP"]),
        "sex": (row.get("sex") or "").lower() or None,
        "race_ethnicity": row.get("race_ethnicity"),
        "education": row.get("education"),
        "employment": row.get("employment"),
        "personal_income": _num(row.get("PINCP")),
        "household_income": _num(row.get("HINCP")),
        "household_size": int(row["NP"]) if not pd.isna(row.get("NP")) else None,
        "housing": row.get("housing"),
        "gross_rent": _num(row.get("GRNTP")) if row.get("housing") == "renter" else None,
        "language_at_home": row.get("language_at_home"),
        "commute": row.get("commute"),
    }
    card["context_notes"] = _context_notes(card)
    return card


def main() -> None:
    lookup = load_lookup()
    df = pd.read_parquet(OUT_DIR / "sample.parquet")
    out = OUT_DIR / "personas.jsonl"
    with open(out, "w") as f:
        for row in df.to_dict(orient="records"):
            f.write(json.dumps(build_card(row, lookup)) + "\n")
    print(f"{len(df):,} persona cards -> {out}")


if __name__ == "__main__":
    main()

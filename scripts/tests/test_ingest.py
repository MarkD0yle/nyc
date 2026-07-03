from pathlib import Path
import pandas as pd
from simnyc.ingest import build_dataset

FIX = Path(__file__).parent / "fixtures"
DECODE = {
    "SEX": {"1": "Male", "2": "Female"},
    "RAC1P": {"1": "White alone", "2": "Black or African American alone", "6": "Asian alone", "8": "Some Other Race alone"},
    "HISP": {"01": "Not Spanish/Hispanic/Latino", "24": "Other Spanish/Hispanic/Latino"},
    "SCHL": {"01": "No schooling completed", "16": "Regular high school diploma", "18": "Some college, but less than 1 year", "19": "1 or more years of college credit, no degree", "21": "Bachelor's degree"},
    "ESR": {"1": "Civilian employed, at work", "3": "Unemployed", "6": "Not in labor force"},
    "LANP": {"1970": "Cantonese", "1200": "Spanish"},
    "JWTRNS": {"02": "Bus", "03": "Subway or elevated rail", "10": "Walked"},
    "TEN": {"1": "Owned with mortgage or loan (include home equity loans)", "3": "Rented"},
}

def build():
    return build_dataset(FIX / "person_sample.csv", FIX / "household_sample.csv", DECODE)

def test_filters_to_nyc_pumas():
    df = build()
    assert set(df["PUMA"]) <= {"04103", "04211"}  # H3 (00100) excluded

def test_drops_group_quarters():
    assert "GQ1" not in set(build()["SERIALNO"])

def test_joins_household_fields():
    row = build().set_index("SERIALNO").loc["H1"]
    r = row.iloc[0] if hasattr(row, "iloc") and isinstance(row, pd.DataFrame) else row
    assert r["HINCP"] == 112000 and r["housing"] == "renter"

def test_decodes_categoricals():
    df = build()
    adult = df[(df["SERIALNO"] == "H1") & (df["AGEP"] == 34)].iloc[0]
    assert adult["sex"] == "Female"
    assert adult["race_ethnicity"] == "Asian, non-Hispanic"
    assert adult["language_at_home"] == "Cantonese"
    assert adult["commute"] == "Subway or elevated rail"

def test_english_only_language():
    df = build()
    h2 = df[df["SERIALNO"] == "H2"].iloc[0]
    assert h2["language_at_home"] == "English only"

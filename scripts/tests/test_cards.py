from simnyc.cards import build_card

LOOKUP = {"04103": {"borough": "Manhattan", "neighborhood": "Lower East Side & Chinatown"}}

ROW = {
    "PUMA": "04103", "AGEP": 34, "sex": "Female",
    "race_ethnicity": "Asian, non-Hispanic", "education": "Bachelor's degree",
    "employment": "Employed", "PINCP": 68000.0, "HINCP": 112000.0, "NP": 3,
    "housing": "renter", "GRNTP": 2400.0, "language_at_home": "Cantonese",
    "commute": "Subway or elevated rail",
}

def test_card_fields():
    c = build_card(ROW, LOOKUP)
    assert c["borough"] == "Manhattan"
    assert c["neighborhood"] == "Lower East Side & Chinatown"
    assert c["age"] == 34 and c["personal_income"] == 68000
    assert c["gross_rent"] == 2400
    assert "id" not in c

def test_context_notes_rent_burden():
    c = build_card(ROW, LOOKUP)
    assert "rent-to-income" in c["context_notes"]
    assert "26%" in c["context_notes"]  # 2400*12/112000 ≈ 25.7%

def test_owner_has_no_rent():
    row = ROW | {"housing": "owner", "GRNTP": float("nan")}
    c = build_card(row, LOOKUP)
    assert c["gross_rent"] is None

def test_no_invented_traits():
    c = build_card(ROW, LOOKUP)
    assert set(c) == {
        "puma", "borough", "neighborhood", "age", "sex", "race_ethnicity",
        "education", "employment", "personal_income", "household_income",
        "household_size", "housing", "gross_rent", "language_at_home",
        "commute", "context_notes",
    }


def test_unemployment_note_not_suppressed_by_language():
    row = ROW | {"employment": "Unemployed", "housing": None, "GRNTP": float("nan")}
    c = build_card(row, LOOKUP)
    assert "Speaks Cantonese at home" in c["context_notes"]
    assert "Currently unemployed" in c["context_notes"]

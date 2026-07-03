from collections import Counter
from simnyc.puma import load_lookup

def test_has_all_55_nyc_pumas():
    lookup = load_lookup()
    assert len(lookup) == 55
    counts = Counter(v["borough"] for v in lookup.values())
    assert counts == {"Brooklyn": 18, "Queens": 14, "Manhattan": 10,
                      "Bronx": 10, "Staten Island": 3}

def test_spot_checks():
    lookup = load_lookup()
    assert lookup["04107"] == {"borough": "Manhattan", "neighborhood": "Upper West Side"}
    assert lookup["04503"]["borough"] == "Staten Island"

def test_codes_are_five_digit_strings():
    assert all(len(k) == 5 and k.isdigit() for k in load_lookup())

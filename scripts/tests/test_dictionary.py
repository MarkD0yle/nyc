from pathlib import Path
from simnyc.dictionary import load_decode_maps

FIXTURE = Path(__file__).parent / "fixtures" / "dict_sample.csv"

def test_decode_maps():
    maps = load_decode_maps(FIXTURE)
    assert maps["SEX"]["1"] == "Male"
    assert maps["TEN"]["3"] == "Rented"
    assert "ZZZ" not in maps

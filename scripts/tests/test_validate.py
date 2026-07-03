import pandas as pd
from simnyc.validate import age_band, education_band, marginals

def test_age_bands():
    assert age_band(18) == "18-29"
    assert age_band(29) == "18-29"
    assert age_band(30) == "30-44"
    assert age_band(45) == "45-64"
    assert age_band(65) == "65+"
    assert age_band(90) == "65+"

def test_education_band():
    assert education_band("Bachelor's degree") == "Bachelor's or higher"
    assert education_band("Master's degree") == "Bachelor's or higher"
    assert education_band("Regular high school diploma") == "HS diploma or GED"
    assert education_band("No schooling completed") == "Less than HS"
    assert education_band("Associate's degree") == "Some college / Associate's"

def test_weighted_vs_unweighted_shares():
    df = pd.DataFrame({
        "AGEP": [20, 20, 70], "PWGTP": [1, 1, 8],
        "PUMA": ["03801", "03801", "04001"],
        "race_ethnicity": ["Hispanic or Latino"] * 3,
        "housing": ["renter"] * 3,
        "education": ["Regular high school diploma"] * 3,
    })
    unw = marginals(df, weighted=False)
    w = marginals(df, weighted=True)
    assert round(unw["age_band"]["18-29"], 1) == 66.7
    assert round(w["age_band"]["65+"], 1) == 80.0

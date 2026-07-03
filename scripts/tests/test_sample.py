import numpy as np
import pandas as pd
from simnyc.sample import draw

def make_df(n=1000):
    rng = np.random.default_rng(1)
    return pd.DataFrame({
        "AGEP": rng.integers(0, 90, n),
        "PWGTP": rng.integers(1, 200, n),
        "PUMA": ["03810"] * n,
    })

def test_age_floor():
    out = draw(make_df(), n=100, seed=42, min_age=18)
    assert (out["AGEP"] >= 18).all()

def test_exact_n_and_no_duplicates():
    out = draw(make_df(5000), n=500, seed=42, min_age=18)
    assert len(out) == 500
    assert out.index.is_unique

def test_reproducible():
    a = draw(make_df(5000), n=500, seed=42, min_age=18)
    b = draw(make_df(5000), n=500, seed=42, min_age=18)
    pd.testing.assert_frame_equal(a, b)

def test_weights_matter():
    df = make_df(5000)
    df.loc[df.index[:100], "PWGTP"] = 100_000  # overweight first 100
    out = draw(df[df["AGEP"] >= 18].reset_index(drop=True), n=200, seed=7, min_age=0)
    heavy = out["PWGTP"].eq(100_000).sum()
    assert heavy > 20  # heavily-weighted rows dominate vs ~4 expected uniformly

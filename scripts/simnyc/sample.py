import numpy as np
import pandas as pd

from .config import MIN_AGE, N_PERSONAS, OUT_DIR, SEED


def draw(df: pd.DataFrame, n: int, seed: int, min_age: int) -> pd.DataFrame:
    pool = df[df["AGEP"].astype(int) >= min_age].reset_index(drop=True)
    w = pool["PWGTP"].astype(float).to_numpy()
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(pool), size=n, replace=False, p=w / w.sum())
    return pool.iloc[np.sort(idx)].reset_index(drop=True)


def main() -> None:
    df = pd.read_parquet(OUT_DIR / "nyc_pums.parquet")
    out = draw(df, n=N_PERSONAS, seed=SEED, min_age=MIN_AGE)
    out.to_parquet(OUT_DIR / "sample.parquet", index=False)
    boroughs = out["PUMA"].str[:3].value_counts()
    print(f"{len(out):,} personas sampled; PUMA prefixes:\n{boroughs}")


if __name__ == "__main__":
    main()

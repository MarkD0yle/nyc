from __future__ import annotations

import sys
from typing import Optional

import numpy as np
import pandas as pd

from .config import OUT_DIR, borough_for_puma

FLAG_PP = 3.0


def age_band(age: int) -> str:
    if age < 30:
        return "18-29"
    if age < 45:
        return "30-44"
    if age < 65:
        return "45-64"
    return "65+"


def education_band(label: Optional[str]) -> str:
    if not label:
        return "Unknown"
    l = label.lower()
    if any(k in l for k in ("bachelor", "master", "professional", "doctorate")):
        return "Bachelor's or higher"
    if "associate" in l or "college" in l:
        return "Some college / Associate's"
    if "high school diploma" in l or "ged" in l:
        return "HS diploma or GED"
    return "Less than HS"


def _shares(series: pd.Series, weights: pd.Series) -> dict[str, float]:
    totals = weights.groupby(series).sum()
    return (totals / totals.sum() * 100).round(1).to_dict()


def marginals(df: pd.DataFrame, weighted: bool) -> dict[str, dict[str, float]]:
    d = df[df["AGEP"].astype(int) >= 18].copy()
    w = d["PWGTP"].astype(float) if weighted else pd.Series(1.0, index=d.index)
    return {
        "age_band": _shares(d["AGEP"].astype(int).map(age_band), w),
        "borough": _shares(d["PUMA"].map(borough_for_puma), w),
        "race_ethnicity": _shares(d["race_ethnicity"].fillna("Unknown"), w),
        "housing": _shares(d["housing"].fillna("Unknown"), w),
        "education_band": _shares(d["education"].map(education_band), w),
    }


def median_hincp_by_borough(df: pd.DataFrame, weighted: bool) -> dict[str, float]:
    d = df[(df["AGEP"].astype(int) >= 18) & df["HINCP"].notna()].copy()
    d["borough"] = d["PUMA"].map(borough_for_puma)
    out = {}
    for b, grp in d.groupby("borough"):
        if weighted:
            g = grp.sort_values("HINCP")
            cum = g["PWGTP"].astype(float).cumsum()
            out[b] = float(g.loc[cum >= cum.iloc[-1] / 2, "HINCP"].iloc[0])
        else:
            out[b] = float(grp["HINCP"].median())
    return out


def main() -> None:
    full = pd.read_parquet(OUT_DIR / "nyc_pums.parquet")
    sample = pd.read_parquet(OUT_DIR / "sample.parquet")
    actual, got = marginals(full, weighted=True), marginals(sample, weighted=False)

    lines = ["# Pass 1 Validation Report", "",
             "Sample: 3,000 personas (unweighted). Actual: full NYC 2024 1-Year PUMS, PWGTP-weighted, age 18+.", ""]
    flags = 0
    for section in actual:
        lines += [f"## {section}", "", "| category | sample % | actual % | delta |", "|---|---|---|---|"]
        for cat in sorted(set(actual[section]) | set(got[section])):
            a, s = actual[section].get(cat, 0.0), got[section].get(cat, 0.0)
            delta = round(s - a, 1)
            flag = " ⚠️" if abs(delta) > FLAG_PP else ""
            flags += bool(flag)
            lines.append(f"| {cat} | {s} | {a} | {delta:+}{flag} |")
        lines.append("")

    lines += ["## Median household income by borough", "",
              "| borough | sample | actual (weighted) | ratio |", "|---|---|---|---|"]
    am, sm = median_hincp_by_borough(full, True), median_hincp_by_borough(sample, False)
    for b in sorted(am):
        lines.append(f"| {b} | {sm.get(b, 0):,.0f} | {am[b]:,.0f} | {sm.get(b, 0) / am[b]:.2f} |")

    lines += ["", f"**Flags (>±{FLAG_PP}pp): {flags}**"]
    out = OUT_DIR / "validation.md"
    out.write_text("\n".join(lines))
    print(out.read_text())
    sys.exit(1 if flags else 0)


if __name__ == "__main__":
    main()

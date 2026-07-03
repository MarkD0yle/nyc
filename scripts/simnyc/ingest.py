import zipfile
from pathlib import Path

import pandas as pd
import requests

from .config import (DATA_DIR, HOUSEHOLD_FIELDS, OUT_DIR, PERSON_FIELDS, URLS,
                     nyc_puma_codes)
from .dictionary import load_decode_maps

HISPANIC_NOT = {"1", "01"}

RACE_SIMPLE = {
    "White alone": "White, non-Hispanic",
    "Black or African American alone": "Black, non-Hispanic",
    "Asian alone": "Asian, non-Hispanic",
    "Native Hawaiian and Other Pacific Islander alone": "Pacific Islander, non-Hispanic",
    "Some Other Race alone": "Other, non-Hispanic",
    "Two or More Races": "Multiracial, non-Hispanic",
}


def _read_csv(path: Path, fields: list) -> pd.DataFrame:
    return pd.read_csv(path, usecols=lambda c: c in fields, dtype=str)


def _download_and_extract(kind: str) -> Path:
    """Download csv_pny.zip / csv_hny.zip and return the extracted CSV path."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    zpath = DATA_DIR / Path(URLS[kind]).name
    if not zpath.exists():
        with requests.get(URLS[kind], stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(zpath, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
    with zipfile.ZipFile(zpath) as z:
        csv_names = [n for n in z.namelist() if n.endswith(".csv")]
        if len(csv_names) != 1:
            raise ValueError(f"Expected 1 CSV in zip, found {len(csv_names)}: {csv_names}")
        if not (DATA_DIR / csv_names[0]).exists():
            z.extract(csv_names[0], DATA_DIR)
    return DATA_DIR / csv_names[0]


def _race_ethnicity(rac1p_label: str, hisp_code: str) -> str:
    if hisp_code not in HISPANIC_NOT:
        return "Hispanic or Latino"
    if "American Indian" in rac1p_label or "Alaska Native" in rac1p_label:
        return "American Indian/Alaska Native, non-Hispanic"
    return RACE_SIMPLE.get(rac1p_label, f"{rac1p_label}, non-Hispanic")


def build_dataset(person_csv: Path, household_csv: Path,
                  decode: dict) -> pd.DataFrame:
    p = _read_csv(person_csv, PERSON_FIELDS)
    h = _read_csv(household_csv, HOUSEHOLD_FIELDS)

    p["PUMA"] = p["PUMA"].str.zfill(5)
    p = p[p["PUMA"].isin(nyc_puma_codes())]

    # drop group quarters (keep TYPEHUGQ == 1 housing units only)
    h = h[h["TYPEHUGQ"].fillna("").str.lstrip("0") == "1"]
    df = p.merge(h.drop(columns=["TYPEHUGQ"]), on="SERIALNO", how="inner")

    for col in ["AGEP", "PWGTP", "NP"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
    for col in ["PINCP", "HINCP", "GRNTP"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    def dec(var: str, code) -> str:
        if pd.isna(code) or str(code).strip() == "":
            return None
        c = str(code).strip()
        # Try the code as-given, then zero-stripped ("03" -> "3"); "0" strips
        # to "" so `or "0"` restores it. Decode labels are never empty strings.
        return decode.get(var, {}).get(c) or decode.get(var, {}).get(c.lstrip("0") or "0")

    df["sex"] = df["SEX"].map(lambda c: dec("SEX", c))
    df["race_ethnicity"] = [
        _race_ethnicity(dec("RAC1P", r) or "", str(hp).strip())
        for r, hp in zip(df["RAC1P"], df["HISP"])
    ]
    df["education"] = df["SCHL"].map(lambda c: dec("SCHL", c))
    df["employment"] = df["ESR"].map(lambda c: _simplify_esr(dec("ESR", c)))
    df["language_at_home"] = [
        "English only" if str(lx).strip() == "2" else (dec("LANP", lp) or "English only")
        for lx, lp in zip(df["LANX"], df["LANP"])
    ]
    df["commute"] = df["JWTRNS"].map(lambda c: dec("JWTRNS", c))
    df["housing"] = df["TEN"].map(_tenure)

    keep = ["SERIALNO", "PUMA", "AGEP", "PWGTP", "PINCP", "HINCP", "GRNTP", "NP",
            "sex", "race_ethnicity", "education", "employment",
            "language_at_home", "commute", "housing"]
    return df[keep].reset_index(drop=True)


def _simplify_esr(label) -> str:
    if label is None:
        return None
    lbl = label.lower()
    if "unemployed" in lbl:
        return "Unemployed"
    if "armed forces" in lbl:
        return "Armed forces"
    if "not in labor force" in lbl:
        return "Not in labor force"
    if "employed" in lbl:
        return "Employed"
    return label


def _tenure(code) -> str:
    c = str(code).strip().lstrip("0")
    if c in {"1", "2"}:
        return "owner"
    if c in {"3", "4"}:
        return "renter"
    return None


def main() -> Path:
    decode = load_decode_maps()
    person_csv = _download_and_extract("person")
    household_csv = _download_and_extract("household")
    df = build_dataset(person_csv, household_csv, decode)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "nyc_pums.parquet"
    df.to_parquet(out, index=False)
    print(f"{len(df):,} NYC person records -> {out}")
    return out


if __name__ == "__main__":
    main()

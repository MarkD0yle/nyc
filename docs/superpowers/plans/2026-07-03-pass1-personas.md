# Sim NYC Pass 1 — Synthetic Persona Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3,000 statistically-real NYC personas in Supabase, sampled from ACS PUMS with person weights, validated against ACS marginals.

**Architecture:** A small Python package (`scripts/simnyc/`) of re-runnable pipeline stages: ingest (download → filter → join → decode → parquet), weighted sampler, persona-card generator, Supabase loader, and validation report. Supabase schema is created via migration; data loads over a direct Postgres connection. No LLM calls, no UI.

**Tech Stack:** Python 3.11+ (pandas, pyarrow, numpy, requests, psycopg, pytest), Supabase Postgres, ACS 2024 1-Year PUMS.

## Global Constraints

- **Vintage:** ACS **2024 1-Year** PUMS only (deviation from spec's "5-Year", approved by user: 5-year files mix 2010/2020 PUMA vintages). 2020-based PUMAs throughout.
- **Sample:** exactly 3,000 personas, age 18+, sampled with `PWGTP` weights, RNG seed `20260703`, `replace=False`.
- **Persona cards:** only PUMS-derived fields + factual `context_notes` (1–2 derived facts). No names, no personality, no backstory.
- **Group quarters excluded:** household `TYPEHUGQ != 1` records dropped.
- **Scripts, not notebooks.** Every stage runs as `python -m simnyc.<stage>` and is idempotent.
- **Validation gate:** all tracked marginals within 3pp of weighted-full-PUMS actuals, or deltas explained in the report.
- **Pass 2 tables** `poll_runs` / `poll_batch_results` created now, empty.
- **Branch:** `pass-1-personas` in `~/Documents/dev/nyc`.
- Raw census downloads and generated outputs go in `scripts/data/` and `scripts/out/` — both gitignored. The validation report (`scripts/out/validation.md`) is copied to `docs/validation-pass1.md` and committed.

## NYC PUMA reference (2020 vintage, state 36)

| Borough | PUMA range | Count |
|---|---|---|
| Bronx | 03701–03710 | 10 |
| Manhattan | 03801–03810 | 10 |
| Staten Island | 03901–03903 | 3 |
| Brooklyn | 04001–04018 | 18 |
| Queens | 04101–04114 | 14 |

Total: 55 PUMAs.

## Source URLs (verify with `curl -sI` in Task 1; adjust filename casing if 404)

- Person file: `https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_pny.zip`
- Household file: `https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_hny.zip`
- Data dictionary (CSV): `https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/PUMS_Data_Dictionary_2024.csv`
- PUMA names: `https://www2.census.gov/geo/docs/reference/puma2020/2020_PUMA_Names.txt`

## File Structure

```
scripts/
  requirements.txt
  .env.example              # SUPABASE_DB_URL=postgresql://...
  simnyc/
    __init__.py
    config.py               # paths, PUMA ranges, seed, field lists
    puma.py                 # PUMA → borough/neighborhood lookup
    dictionary.py           # PUMS data-dictionary → decode maps
    ingest.py               # download, filter, join, clean → out/nyc_pums.parquet
    sample.py               # weighted sample → out/sample.parquet
    cards.py                # persona cards → out/personas.jsonl
    load.py                 # personas.jsonl → Supabase
    validate.py             # out/validation.md
  tests/
    fixtures/               # tiny CSV fixtures, committed
    test_puma.py
    test_dictionary.py
    test_ingest.py
    test_sample.py
    test_cards.py
    test_validate.py
supabase/migrations/0001_pass1_schema.sql
docs/validation-pass1.md    # committed copy of the validation report
```

---

### Task 1: Branch, scaffolding, config

**Files:**
- Create: `scripts/requirements.txt`, `scripts/.env.example`, `scripts/simnyc/__init__.py`, `scripts/simnyc/config.py`, `scripts/tests/__init__.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `config.DATA_DIR`, `config.OUT_DIR` (Path), `config.NYC_PUMA_RANGES: dict[str, tuple[int,int]]`, `config.nyc_puma_codes() -> set[str]` (5-digit zero-padded strings), `config.SEED = 20260703`, `config.N_PERSONAS = 3000`, `config.URLS: dict[str,str]`.

- [ ] **Step 1: Branch and verify URLs**

```bash
cd ~/Documents/dev/nyc && git checkout -b pass-1-personas
for u in \
  https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_pny.zip \
  https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_hny.zip \
  https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/PUMS_Data_Dictionary_2024.csv \
  https://www2.census.gov/geo/docs/reference/puma2020/2020_PUMA_Names.txt ; do
  curl -sI -o /dev/null -w "%{http_code} $u\n" "$u"; done
```
Expected: four `200` lines. If a URL 404s, browse the parent directory listing and correct the filename in `config.py` (and this plan) before proceeding.

- [ ] **Step 2: Scaffolding**

`scripts/requirements.txt`:
```
pandas>=2.2
pyarrow>=16
numpy>=1.26
requests>=2.32
psycopg[binary]>=3.1
python-dotenv>=1.0
pytest>=8
```

`scripts/.env.example`:
```
# Supabase → Project Settings → Database → Connection string (session pooler)
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Append to `.gitignore`:
```
scripts/data/
scripts/out/
scripts/.env
scripts/.venv/
```

`scripts/simnyc/config.py`:
```python
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = SCRIPTS_DIR / "data"
OUT_DIR = SCRIPTS_DIR / "out"

SEED = 20260703
N_PERSONAS = 3000
MIN_AGE = 18

# 2020-vintage NYC PUMAs, NY state (36)
NYC_PUMA_RANGES = {
    "Bronx": (3701, 3710),
    "Manhattan": (3801, 3810),
    "Staten Island": (3901, 3903),
    "Brooklyn": (4001, 4018),
    "Queens": (4101, 4114),
}

URLS = {
    "person": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_pny.zip",
    "household": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/csv_hny.zip",
    "dictionary": "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/PUMS_Data_Dictionary_2024.csv",
    "puma_names": "https://www2.census.gov/geo/docs/reference/puma2020/2020_PUMA_Names.txt",
}

PERSON_FIELDS = ["SERIALNO", "AGEP", "SEX", "RAC1P", "HISP", "SCHL", "PINCP",
                 "ESR", "LANX", "LANP", "JWTRNS", "PUMA", "PWGTP"]
HOUSEHOLD_FIELDS = ["SERIALNO", "TEN", "HINCP", "NP", "GRNTP", "TYPEHUGQ"]


def nyc_puma_codes() -> set[str]:
    return {
        f"{code:05d}"
        for lo, hi in NYC_PUMA_RANGES.values()
        for code in range(lo, hi + 1)
    }


def borough_for_puma(puma: str) -> str | None:
    n = int(puma)
    for borough, (lo, hi) in NYC_PUMA_RANGES.items():
        if lo <= n <= hi:
            return borough
    return None
```

Create empty `scripts/simnyc/__init__.py` and `scripts/tests/__init__.py`.

- [ ] **Step 3: Venv + sanity test**

```bash
cd ~/Documents/dev/nyc/scripts && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -q
.venv/bin/python -c "from simnyc.config import nyc_puma_codes; assert len(nyc_puma_codes()) == 55; print('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add scripts .gitignore && git commit -m "chore: scaffold simnyc pipeline package"
```

---

### Task 2: PUMA lookup (borough + neighborhood names)

**Files:**
- Create: `scripts/simnyc/puma.py`, `scripts/tests/test_puma.py`, `scripts/tests/fixtures/puma_names_sample.txt`

**Interfaces:**
- Consumes: `config.URLS["puma_names"]`, `config.borough_for_puma`, `config.nyc_puma_codes`
- Produces: `puma.load_lookup(path: Path | None = None) -> dict[str, dict]` mapping 5-digit PUMA → `{"borough": str, "neighborhood": str}`. Downloads the names file to `DATA_DIR` if `path` is None. `puma.clean_name(raw: str) -> str` strips the `NYC-<Borough> Community District ...--` prefix and trailing ` PUMA`.

- [ ] **Step 1: Fixture + failing test**

`scripts/tests/fixtures/puma_names_sample.txt` (real format: `STATEFP,PUMA5CE,PUMA NAME` — verify against the downloaded file and adjust the parser if the delimiter differs):
```
36,03810,NYC-Manhattan Community District 3--Chinatown & Lower East Side PUMA
36,04001,NYC-Brooklyn Community District 1--Greenpoint & Williamsburg PUMA
36,00100,Northern Adirondacks PUMA
```

`scripts/tests/test_puma.py`:
```python
from pathlib import Path
from simnyc.puma import load_lookup, clean_name

FIXTURE = Path(__file__).parent / "fixtures" / "puma_names_sample.txt"

def test_lookup_maps_nyc_pumas_only():
    lookup = load_lookup(FIXTURE)
    assert lookup["03810"]["borough"] == "Manhattan"
    assert lookup["04001"]["borough"] == "Brooklyn"
    assert "00100" not in lookup  # not NYC

def test_clean_name_strips_boilerplate():
    raw = "NYC-Manhattan Community District 3--Chinatown & Lower East Side PUMA"
    assert clean_name(raw) == "Chinatown & Lower East Side"
```

Run: `cd scripts && .venv/bin/pytest tests/test_puma.py -v` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

`scripts/simnyc/puma.py`:
```python
import csv
import re
from pathlib import Path

import requests

from .config import DATA_DIR, URLS, borough_for_puma


def clean_name(raw: str) -> str:
    name = re.sub(r"\s*PUMA\s*$", "", raw.strip())
    if "--" in name:
        name = name.split("--", 1)[1]
    return name.strip()


def _download(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        r = requests.get(URLS["puma_names"], timeout=60)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def load_lookup(path: Path | None = None) -> dict[str, dict]:
    if path is None:
        path = _download(DATA_DIR / "2020_PUMA_Names.txt")
    lookup: dict[str, dict] = {}
    with open(path, newline="", encoding="latin-1") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 3 or row[0].strip() == "STATEFP":
                continue
            state, code, name = row[0].strip(), row[1].strip().zfill(5), ",".join(row[2:]).strip()
            if state != "36":
                continue
            borough = borough_for_puma(code)
            if borough is None:
                continue
            lookup[code] = {"borough": borough, "neighborhood": clean_name(name)}
    return lookup
```

- [ ] **Step 3: Tests pass, then real-file check**

```bash
cd scripts && .venv/bin/pytest tests/test_puma.py -v
.venv/bin/python -c "from simnyc.puma import load_lookup; l = load_lookup(); assert len(l) == 55, len(l); print('55 NYC PUMAs ok')"
```
Expected: PASS, then `55 NYC PUMAs ok`. If the count is wrong or parsing fails, inspect the first lines of the downloaded file and fix the parser (header/delimiter drift), not the test.

- [ ] **Step 4: Commit**

```bash
git add scripts && git commit -m "feat: PUMA to borough/neighborhood lookup"
```

---

### Task 3: Data-dictionary decode maps

**Files:**
- Create: `scripts/simnyc/dictionary.py`, `scripts/tests/test_dictionary.py`, `scripts/tests/fixtures/dict_sample.csv`

**Interfaces:**
- Produces: `dictionary.load_decode_maps(path: Path | None = None) -> dict[str, dict[str, str]]` — variable name → {code → label}, built from the official 2024 dictionary CSV (downloaded to `DATA_DIR` if path is None). Only variables in `config.PERSON_FIELDS + HOUSEHOLD_FIELDS` are kept.

- [ ] **Step 1: Fixture + failing test**

The 2024 dictionary CSV has rows shaped `NAME,...` and `VAL,<var>,<C/N>,<len>,<from>,<to>,<label>` (verify against the real file; adjust column indices if drifted). `scripts/tests/fixtures/dict_sample.csv`:
```
NAME,SEX,C,1,Sex
VAL,SEX,C,1,1,1,Male
VAL,SEX,C,1,2,2,Female
NAME,TEN,C,1,Tenure
VAL,TEN,C,1,1,1,Owned with mortgage or loan (include home equity loans)
VAL,TEN,C,1,3,3,Rented
NAME,ZZZ,C,1,Ignored variable
VAL,ZZZ,C,1,1,1,Should not appear
```

`scripts/tests/test_dictionary.py`:
```python
from pathlib import Path
from simnyc.dictionary import load_decode_maps

FIXTURE = Path(__file__).parent / "fixtures" / "dict_sample.csv"

def test_decode_maps():
    maps = load_decode_maps(FIXTURE)
    assert maps["SEX"]["1"] == "Male"
    assert maps["TEN"]["3"] == "Rented"
    assert "ZZZ" not in maps
```

Run: `cd scripts && .venv/bin/pytest tests/test_dictionary.py -v` — Expected: FAIL.

- [ ] **Step 2: Implement**

`scripts/simnyc/dictionary.py`:
```python
import csv
from pathlib import Path

import requests

from .config import DATA_DIR, HOUSEHOLD_FIELDS, PERSON_FIELDS, URLS

WANTED = set(PERSON_FIELDS) | set(HOUSEHOLD_FIELDS)


def load_decode_maps(path: Path | None = None) -> dict[str, dict[str, str]]:
    if path is None:
        path = DATA_DIR / "PUMS_Data_Dictionary_2024.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            r = requests.get(URLS["dictionary"], timeout=120)
            r.raise_for_status()
            path.write_bytes(r.content)
    maps: dict[str, dict[str, str]] = {}
    with open(path, newline="", encoding="latin-1") as f:
        for row in csv.reader(f):
            if len(row) >= 7 and row[0] == "VAL" and row[1] in WANTED:
                var, code_from, label = row[1], row[4].strip(), row[6].strip()
                maps.setdefault(var, {})[code_from.lstrip("0") or "0"] = label
                maps[var][code_from] = label  # keep zero-padded form too
    return maps
```

- [ ] **Step 3: Tests pass + real-file spot check**

```bash
cd scripts && .venv/bin/pytest tests/test_dictionary.py -v
.venv/bin/python -c "
from simnyc.dictionary import load_decode_maps
m = load_decode_maps()
print(m['SEX']); print(list(m['LANP'].items())[:3]); print(m['JWTRNS'])
"
```
Expected: PASS; SEX shows Male/Female; LANP shows language labels; JWTRNS shows transport modes. If the real file's columns differ from the fixture assumption, fix the parser and the fixture together.

- [ ] **Step 4: Commit**

```bash
git add scripts && git commit -m "feat: PUMS data-dictionary decode maps"
```

---

### Task 4: Ingest — download, filter, join, clean

**Files:**
- Create: `scripts/simnyc/ingest.py`, `scripts/tests/test_ingest.py`, `scripts/tests/fixtures/person_sample.csv`, `scripts/tests/fixtures/household_sample.csv`

**Interfaces:**
- Consumes: `config`, `dictionary.load_decode_maps`
- Produces: `ingest.build_dataset(person_csv, household_csv, decode_maps) -> pd.DataFrame` (pure, testable) and `ingest.main()` (downloads zips to `DATA_DIR`, extracts, runs `build_dataset`, writes `OUT_DIR/nyc_pums.parquet`). Output columns: `SERIALNO, PUMA (5-digit str), AGEP (int), PWGTP (int), PINCP (float, NaN ok), HINCP (float), GRNTP (float), NP (int), sex, race_ethnicity, education, employment, language_at_home, commute, housing` (decoded strings).

- [ ] **Step 1: Fixtures + failing tests**

`scripts/tests/fixtures/person_sample.csv`:
```
SERIALNO,AGEP,SEX,RAC1P,HISP,SCHL,PINCP,ESR,LANX,LANP,JWTRNS,PUMA,PWGTP
H1,34,2,6,01,21,68000,1,1,1970,03,03810,120
H1,4,1,6,01,01,,,2,,,03810,95
H2,52,1,2,01,16,41000,1,2,,02,04001,80
GQ1,20,1,1,01,19,3000,6,2,,,03810,60
H3,29,2,8,24,18,35000,3,1,1200,10,00100,70
```

`scripts/tests/fixtures/household_sample.csv`:
```
SERIALNO,TEN,HINCP,NP,GRNTP,TYPEHUGQ
H1,3,112000,3,2400,1
H2,1,41000,1,,1
GQ1,,,,,3
H3,3,35000,2,1100,1
```

`scripts/tests/test_ingest.py`:
```python
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
    assert set(df["PUMA"]) <= {"03810", "04001"}  # H3 (00100) excluded

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
```

Run: `cd scripts && .venv/bin/pytest tests/test_ingest.py -v` — Expected: FAIL.

- [ ] **Step 2: Implement**

`scripts/simnyc/ingest.py`:
```python
import io
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


def _read_csv(path: Path, fields: list[str]) -> pd.DataFrame:
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
        assert len(csv_names) == 1, csv_names
        z.extract(csv_names[0], DATA_DIR)
    return DATA_DIR / csv_names[0]


def _race_ethnicity(rac1p_label: str, hisp_code: str) -> str:
    if hisp_code not in HISPANIC_NOT:
        return "Hispanic or Latino"
    if "American Indian" in rac1p_label or "Alaska Native" in rac1p_label:
        return "American Indian/Alaska Native, non-Hispanic"
    return RACE_SIMPLE.get(rac1p_label, f"{rac1p_label}, non-Hispanic")


def build_dataset(person_csv: Path, household_csv: Path,
                  decode: dict[str, dict[str, str]]) -> pd.DataFrame:
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

    def dec(var: str, code) -> str | None:
        if pd.isna(code) or str(code).strip() == "":
            return None
        c = str(code).strip()
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


def _simplify_esr(label: str | None) -> str | None:
    if label is None:
        return None
    l = label.lower()
    if "unemployed" in l:
        return "Unemployed"
    if "armed forces" in l:
        return "Armed forces"
    if "not in labor force" in l:
        return "Not in labor force"
    if "employed" in l:
        return "Employed"
    return label


def _tenure(code) -> str | None:
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
```

- [ ] **Step 3: Tests pass**

Run: `cd scripts && .venv/bin/pytest tests/test_ingest.py -v` — Expected: all PASS.

- [ ] **Step 4: Run the real ingest (~1–2 GB download, several minutes)**

```bash
cd scripts && .venv/bin/python -m simnyc.ingest
```
Expected: a count in the tens of thousands (NYC share of the NY 1-year person file, GQ excluded) and `out/nyc_pums.parquet` written. Sanity: `.venv/bin/python -c "import pandas as pd; d = pd.read_parquet('out/nyc_pums.parquet'); print(d['PUMA'].nunique(), 'PUMAs'); print(d.head())"` → 55 PUMAs.

- [ ] **Step 5: Commit**

```bash
git add scripts && git commit -m "feat: PUMS ingest — filter NYC, join households, decode"
```

---

### Task 5: Weighted sampler

**Files:**
- Create: `scripts/simnyc/sample.py`, `scripts/tests/test_sample.py`

**Interfaces:**
- Consumes: `OUT_DIR/nyc_pums.parquet`
- Produces: `sample.draw(df, n, seed, min_age) -> pd.DataFrame` (pure) and `sample.main()` writing `OUT_DIR/sample.parquet`. Sampling: `PWGTP`-proportional probabilities, `numpy.random.default_rng(seed)`, without replacement, age ≥ 18.

- [ ] **Step 1: Failing tests**

`scripts/tests/test_sample.py`:
```python
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
    hit = out.index.isin(range(100)).sum() if out.index.max() < 5000 else None
    heavy = out["PWGTP"].eq(100_000).sum()
    assert heavy > 20  # heavily-weighted rows dominate vs ~4 expected uniformly
```

Run: `cd scripts && .venv/bin/pytest tests/test_sample.py -v` — Expected: FAIL.

- [ ] **Step 2: Implement**

`scripts/simnyc/sample.py`:
```python
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
```

- [ ] **Step 3: Tests pass, run for real**

```bash
cd scripts && .venv/bin/pytest tests/test_sample.py -v && .venv/bin/python -m simnyc.sample
```
Expected: PASS; 3,000 rows; prefixes 037/038/039/040/041 all present.

- [ ] **Step 4: Commit**

```bash
git add scripts && git commit -m "feat: PWGTP-weighted persona sampler (seeded)"
```

---

### Task 6: Persona card generator

**Files:**
- Create: `scripts/simnyc/cards.py`, `scripts/tests/test_cards.py`

**Interfaces:**
- Consumes: `OUT_DIR/sample.parquet`, `puma.load_lookup`
- Produces: `cards.build_card(row: dict, puma_lookup: dict) -> dict` (pure; no `id` field — the DB assigns UUIDs) and `cards.main()` writing `OUT_DIR/personas.jsonl` (one card per line). Card keys exactly: `puma, borough, neighborhood, age, sex, race_ethnicity, education, employment, personal_income, household_income, household_size, housing, gross_rent, language_at_home, commute, context_notes`.

- [ ] **Step 1: Failing tests**

`scripts/tests/test_cards.py`:
```python
from simnyc.cards import build_card

LOOKUP = {"03810": {"borough": "Manhattan", "neighborhood": "Chinatown & Lower East Side"}}

ROW = {
    "PUMA": "03810", "AGEP": 34, "sex": "Female",
    "race_ethnicity": "Asian, non-Hispanic", "education": "Bachelor's degree",
    "employment": "Employed", "PINCP": 68000.0, "HINCP": 112000.0, "NP": 3,
    "housing": "renter", "GRNTP": 2400.0, "language_at_home": "Cantonese",
    "commute": "Subway or elevated rail",
}

def test_card_fields():
    c = build_card(ROW, LOOKUP)
    assert c["borough"] == "Manhattan"
    assert c["neighborhood"] == "Chinatown & Lower East Side"
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
```

Run: `cd scripts && .venv/bin/pytest tests/test_cards.py -v` — Expected: FAIL.

- [ ] **Step 2: Implement**

`scripts/simnyc/cards.py`:
```python
import json
import math

import pandas as pd

from .config import OUT_DIR
from .puma import load_lookup


def _num(v) -> float | None:
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
    elif card["employment"] == "Unemployed":
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
```

- [ ] **Step 3: Tests pass, run for real, eyeball 3 cards**

```bash
cd scripts && .venv/bin/pytest tests/test_cards.py -v && .venv/bin/python -m simnyc.cards && head -3 out/personas.jsonl
```
Expected: PASS; 3,000 lines; cards look factual (no nulls where data should exist, boroughs/neighborhoods populated).

- [ ] **Step 4: Commit**

```bash
git add scripts && git commit -m "feat: persona card generator with factual context notes"
```

---

### Task 7: Supabase project + schema migration

**Files:**
- Create: `supabase/migrations/0001_pass1_schema.sql`

**Interfaces:**
- Produces: Supabase project (name `sim-nyc`) with tables `personas`, `poll_runs`, `poll_batch_results` exactly as spec'd. Project ref + region recorded in `scripts/.env.example` comment.

- [ ] **Step 1: Create project via Supabase MCP**

Use the Supabase MCP tools: `get_cost` (type: project) → `confirm_cost` → `create_project` (name `sim-nyc`). **Surface the cost to the user and get their OK in chat before `confirm_cost`.** Record the project ref.

- [ ] **Step 2: Write migration file**

`supabase/migrations/0001_pass1_schema.sql`:
```sql
create table personas (
  id uuid primary key default gen_random_uuid(),
  puma text not null,
  borough text not null,
  neighborhood text,
  card jsonb not null,
  created_at timestamptz default now()
);

create index personas_puma_idx on personas (puma);
create index personas_borough_idx on personas (borough);

create table poll_runs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text default 'running',
  created_at timestamptz default now()
);

create table poll_batch_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references poll_runs(id),
  puma text not null,
  batch_index int not null,
  results jsonb not null,
  created_at timestamptz default now()
);

create index poll_batch_results_run_idx on poll_batch_results (run_id);
create index poll_batch_results_puma_idx on poll_batch_results (puma);
```

- [ ] **Step 3: Apply via MCP `apply_migration`** (name: `pass1_schema`, same SQL). Verify with `list_tables` → `personas`, `poll_runs`, `poll_batch_results` exist.

- [ ] **Step 4: Commit**

```bash
git add supabase && git commit -m "feat: supabase schema — personas + pass-2 poll tables"
```

---

### Task 8: Loader

**Files:**
- Create: `scripts/simnyc/load.py`

**Interfaces:**
- Consumes: `OUT_DIR/personas.jsonl`, env `SUPABASE_DB_URL` (from `scripts/.env`)
- Produces: `load.main()` — idempotent: `truncate personas` then batch-insert all cards (500/batch), printing the final count.

- [ ] **Step 1: Implement** (no unit test — this is I/O glue; verification is the row count + validation task)

`scripts/simnyc/load.py`:
```python
import json
import os

import psycopg
from dotenv import load_dotenv

from .config import OUT_DIR, SCRIPTS_DIR

BATCH = 500


def main() -> None:
    load_dotenv(SCRIPTS_DIR / ".env")
    dsn = os.environ["SUPABASE_DB_URL"]
    cards = [json.loads(line) for line in open(OUT_DIR / "personas.jsonl")]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("truncate table personas")
        for i in range(0, len(cards), BATCH):
            batch = cards[i:i + BATCH]
            cur.executemany(
                "insert into personas (puma, borough, neighborhood, card) values (%s, %s, %s, %s)",
                [(c["puma"], c["borough"], c["neighborhood"], json.dumps(c)) for c in batch],
            )
        cur.execute("select count(*), count(distinct borough) from personas")
        n, b = cur.fetchone()
    print(f"loaded {n} personas across {b} boroughs")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Configure `.env` and run**

Get the session-pooler connection string for the `sim-nyc` project (user supplies the DB password — do not paste it into chat; ask the user to create `scripts/.env` from `.env.example`, or use MCP `execute_sql` fallback below if they prefer).

```bash
cd scripts && .venv/bin/python -m simnyc.load
```
Expected: `loaded 3000 personas across 5 boroughs`.

Fallback if no DB URL: generate `out/personas_insert.sql` with the same batching and apply via MCP `execute_sql` in ~6 chunks.

- [ ] **Step 3: Verify via MCP** — `execute_sql`: `select borough, count(*) from personas group by borough order by 2 desc;` → all 5 boroughs, plausible proportions (Brooklyn ≈ Queens > Manhattan ≈ Bronx > Staten Island).

- [ ] **Step 4: Commit**

```bash
git add scripts && git commit -m "feat: supabase persona loader"
```

---

### Task 9: Validation report (acceptance gate)

**Files:**
- Create: `scripts/simnyc/validate.py`, `scripts/tests/test_validate.py`, `docs/validation-pass1.md` (generated copy)

**Interfaces:**
- Consumes: `OUT_DIR/nyc_pums.parquet` (full, weighted = "actual"), `OUT_DIR/sample.parquet` (unweighted sample)
- Produces: `validate.marginals(df, weighted: bool) -> dict[str, dict[str, float]]` (pure; keys: `age_band, borough, race_ethnicity, housing, education_band`) — each inner dict is category → share (%). `validate.median_hincp_by_borough(df, weighted) -> dict[str, float]`. `validate.main()` writes `OUT_DIR/validation.md` with `sample % | actual % | delta` tables, flags any |delta| > 3pp, exits non-zero if unexplained flags exist.

- [ ] **Step 1: Failing tests**

`scripts/tests/test_validate.py`:
```python
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
```

Run: `cd scripts && .venv/bin/pytest tests/test_validate.py -v` — Expected: FAIL.

- [ ] **Step 2: Implement**

`scripts/simnyc/validate.py`:
```python
import sys

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


def education_band(label: str | None) -> str:
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
```

- [ ] **Step 3: Tests pass, generate report**

```bash
cd scripts && .venv/bin/pytest tests/test_validate.py -v && .venv/bin/python -m simnyc.validate; echo "exit=$?"
```
Expected: tests PASS; report prints. If any ⚠️ flags: investigate (small-category noise like Pacific Islander at <1% is explainable; a 5pp borough skew is a sampler bug — debug before proceeding). Add an "## Explanations" section to the report for any accepted deltas.

- [ ] **Step 4: Commit report copy**

```bash
cp scripts/out/validation.md docs/validation-pass1.md
git add scripts docs/validation-pass1.md && git commit -m "feat: validation report — sample vs ACS marginals"
```

---

### Task 10: Acceptance sweep + push

- [ ] **Step 1: Full test suite** — `cd scripts && .venv/bin/pytest -v` → all green.
- [ ] **Step 2: Acceptance checklist** — verify each item against reality (SQL counts via MCP, report contents), check off in this plan:
  - [ ] 3,000 personas in Supabase, all 5 boroughs (`select count(*), count(distinct borough) from personas`)
  - [ ] PWGTP-weighted, seeded sampling (code review: `sample.py` uses `SEED`, `p=w/w.sum()`)
  - [ ] All age 18+ (`select min((card->>'age')::int) from personas` ≥ 18)
  - [ ] Cards contain only PUMS fields + factual notes (spot-check 5 random rows)
  - [ ] Validation report committed; all deltas ≤3pp or explained
  - [ ] `poll_runs` / `poll_batch_results` exist and are empty
  - [ ] Re-runnable: `python -m simnyc.ingest|sample|cards|load|validate` each idempotent
- [ ] **Step 3: Push branch** — `git push -u origin pass-1-personas` (already authorized to push to this repo).

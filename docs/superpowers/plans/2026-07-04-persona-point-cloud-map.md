# Persona Point Cloud Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A WebGL `/map` page that renders the 3,000 synthetic NYC personas as a point cloud over a self-contained NYC basemap (55 PUMA polygons + borough outlines), colored and filtered by demographic attribute, with hover-for-persona-card and animated visual polish.

**Architecture:** Fully client-side. An offline node script bundles two static JSON files into `public/` (PUMA polygons + personas with precomputed lng/lat scattered inside their PUMA). The `/map` route dynamically imports a deck.gl canvas (no basemap tiles, no API keys) that draws a `GeoJsonLayer` for the polygons and two `ScatterplotLayer`s for the dots (a faint context layer + a colored active layer). All color/filter/banding logic lives in a pure, unit-tested `attributes.ts`.

**Tech Stack:** Next.js 16 App Router (React 19), TypeScript strict, Tailwind v4, shadcn/ui (existing radix-nova components), deck.gl 9 (`@deck.gl/core`, `@deck.gl/react`, `@deck.gl/layers`), Vitest for unit tests.

## Global Constraints

- Next.js 16.2.10 App Router; the map route and its children are **client components** (`'use client'`). deck.gl touches WebGL/`window`, so `PersonaMap` is loaded via `next/dynamic` with `{ ssr: false }`. Per `AGENTS.md`, this is not the Next.js in training data — consult `node_modules/next/dist/docs/01-app/` before writing route code.
- No external network at runtime. The app loads only `public/nyc_pumas.geojson` and `public/personas.geo.json`.
- TypeScript strict; import alias `@/*` → `src/*`.
- Persona positions are **illustrative** (seeded-random inside the PUMA), never real addresses — say so in the UI caption.
- Colorable/filterable attributes: `borough, race_ethnicity, housing, income_band, language_at_home (top-N + "Other"), age_band`. `income_band` bucket edges: `<$30k, $30–60k, $60–100k, $100–150k, $150k+` (household income; `null` → `Unknown`).
- Categorical palette must be colorblind-safe (Okabe–Ito). Ordinal attributes (income_band, age_band) use a sequential ramp.

---

### Task 1: Dependencies + Vitest harness

**Files:**
- Modify: `package.json` (deps + `test` scripts)
- Create: `vitest.config.ts`
- Create: `src/lib/map/smoke.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` (Vitest) with the `@/*` alias resolvable in tests; deck.gl installed for later tasks.

- [ ] **Step 1: Install runtime + dev dependencies**

Run:
```bash
npm install @deck.gl/core@^9 @deck.gl/react@^9 @deck.gl/layers@^9
npm install -D vitest@^3 vite-tsconfig-paths@^5
```
Expected: installs succeed; `package.json` gains the four `@deck.gl/*`/vitest entries.

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create a smoke test that exercises the alias**

`src/lib/map/smoke.test.ts`:
```ts
import { expect, test } from "vitest";
import { cn } from "@/lib/utils";

test("vitest runs and @/ alias resolves", () => {
  expect(cn("a", "b")).toBe("a b");
});
```

- [ ] **Step 5: Run the test**

Run: `npm test`
Expected: 1 passed. Alias resolves (no "cannot find module '@/lib/utils'").

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm src/lib/map/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add deck.gl deps and vitest harness"
```

---

### Task 2: Persona type + attribute model (pure, unit-tested)

**Files:**
- Create: `src/lib/map/persona.ts`
- Create: `src/lib/map/attributes.ts`
- Test: `src/lib/map/attributes.test.ts`

**Interfaces:**
- Consumes: nothing (pure logic).
- Produces:
  - `GeoPersona` interface (persona card + `id: number`, `lng: number`, `lat: number`).
  - `type RGB = [number, number, number]`
  - `type AttrKind = "categorical" | "ordinal"`
  - `interface AttrDef { key: string; label: string; kind: AttrKind; values: string[]; accessor: (p: GeoPersona) => string; color: (value: string) => RGB }`
  - `buildAttributes(personas: GeoPersona[]): AttrDef[]` — full ordered attribute list; the `language_at_home` def is data-derived (top 8 + `"Other"`).
  - `incomeBand(hh: number | null): string`
  - `ageBand(age: number): string`
  - `FADED_RGBA: [number, number, number, number]` = `[130, 130, 140, 26]`
  - `filterPredicate(attr: AttrDef, values: string[]): (p: GeoPersona) => boolean` — empty `values` ⇒ always true.

- [ ] **Step 1: Write `src/lib/map/persona.ts`**

```ts
export interface GeoPersona {
  id: number;
  lng: number;
  lat: number;
  puma: string;
  borough: string;
  neighborhood: string;
  age: number;
  sex: string;
  race_ethnicity: string;
  education: string;
  employment: string;
  personal_income: number | null;
  household_income: number | null;
  household_size: number;
  housing: string;
  gross_rent: number | null;
  language_at_home: string;
  commute: string;
  context_notes: string;
}
```

- [ ] **Step 2: Write the failing test `src/lib/map/attributes.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import type { GeoPersona } from "@/lib/map/persona";
import {
  ageBand,
  buildAttributes,
  filterPredicate,
  incomeBand,
} from "@/lib/map/attributes";

function persona(over: Partial<GeoPersona>): GeoPersona {
  return {
    id: 1, lng: -73.9, lat: 40.7, puma: "04110", borough: "Manhattan",
    neighborhood: "Harlem", age: 40, sex: "male", race_ethnicity: "Hispanic or Latino",
    education: "Bachelor's degree", employment: "Employed", personal_income: 20000,
    household_income: 45000, household_size: 2, housing: "renter", gross_rent: 1200,
    language_at_home: "English only", commute: "Bus", context_notes: "",
    ...over,
  };
}

describe("incomeBand", () => {
  test.each([
    [null, "Unknown"],
    [0, "<$30k"],
    [29999, "<$30k"],
    [30000, "$30–60k"],
    [59999, "$30–60k"],
    [60000, "$60–100k"],
    [100000, "$100–150k"],
    [150000, "$150k+"],
    [500000, "$150k+"],
  ])("hh %s → %s", (hh, band) => {
    expect(incomeBand(hh as number | null)).toBe(band);
  });
});

describe("ageBand", () => {
  test.each([
    [10, "<18"], [18, "18–29"], [29, "18–29"], [30, "30–44"],
    [44, "30–44"], [45, "45–64"], [64, "45–64"], [65, "65+"], [90, "65+"],
  ])("age %s → %s", (age, band) => {
    expect(ageBand(age as number)).toBe(band);
  });
});

describe("buildAttributes", () => {
  const people = [
    ...Array.from({ length: 3 }, (_, i) => persona({ id: i, language_at_home: "Spanish" })),
    persona({ id: 10, language_at_home: "Korean" }),
    persona({ id: 11, language_at_home: "Yiddish" }),
  ];
  const attrs = buildAttributes(people);
  const byKey = (k: string) => attrs.find((a) => a.key === k)!;

  test("exposes the six required attributes in order", () => {
    expect(attrs.map((a) => a.key)).toEqual([
      "borough", "race_ethnicity", "housing", "income_band",
      "language_at_home", "age_band",
    ]);
  });

  test("borough accessor + colorblind-safe RGB triple", () => {
    const b = byKey("borough");
    expect(b.accessor(persona({ borough: "Queens" }))).toBe("Queens");
    const c = b.color("Queens");
    expect(c).toHaveLength(3);
    for (const ch of c) expect(ch).toBeGreaterThanOrEqual(0), expect(ch).toBeLessThanOrEqual(255);
  });

  test("income_band ordinal values are low→high ordered", () => {
    expect(byKey("income_band").values).toEqual([
      "<$30k", "$30–60k", "$60–100k", "$100–150k", "$150k+", "Unknown",
    ]);
  });

  test("language keeps common values, folds rare ones into 'Other'", () => {
    const lang = byKey("language_at_home");
    // With top-N cap, a value present once among few can still be kept;
    // force folding by making the cap bite:
    const many = Array.from({ length: 20 }, (_, i) =>
      persona({ id: i, language_at_home: `Lang${i}` }),
    );
    const attr = buildAttributes(many).find((a) => a.key === "language_at_home")!;
    expect(attr.values).toContain("Other");
    expect(attr.values.length).toBeLessThanOrEqual(9); // top 8 + Other
    // a language outside the kept set maps to "Other"
    const rare = attr.values.includes("Lang19") ? "LangZZZ" : "Lang19";
    expect(attr.accessor(persona({ language_at_home: rare }))).toBe("Other");
  });

  test("color is stable for a repeated value", () => {
    const b = byKey("borough");
    expect(b.color("Queens")).toEqual(b.color("Queens"));
  });
});

describe("filterPredicate", () => {
  const attrs = buildAttributes([persona({})]);
  const housing = attrs.find((a) => a.key === "housing")!;

  test("empty values ⇒ everything passes", () => {
    const pred = filterPredicate(housing, []);
    expect(pred(persona({ housing: "owner" }))).toBe(true);
    expect(pred(persona({ housing: "renter" }))).toBe(true);
  });

  test("non-empty values ⇒ only matches pass", () => {
    const pred = filterPredicate(housing, ["renter"]);
    expect(pred(persona({ housing: "renter" }))).toBe(true);
    expect(pred(persona({ housing: "owner" }))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npm test`
Expected: FAIL — `attributes.ts` has no exports yet (cannot find `incomeBand`, etc.).

- [ ] **Step 4: Write `src/lib/map/attributes.ts`**

```ts
import type { GeoPersona } from "@/lib/map/persona";

export type RGB = [number, number, number];
export type AttrKind = "categorical" | "ordinal";

export interface AttrDef {
  key: string;
  label: string;
  kind: AttrKind;
  values: string[];
  accessor: (p: GeoPersona) => string;
  color: (value: string) => RGB;
}

export const FADED_RGBA: [number, number, number, number] = [130, 130, 140, 26];

// Okabe–Ito colorblind-safe categorical palette (+ neutral fallback).
const CATEGORICAL: RGB[] = [
  [230, 159, 0], [86, 180, 233], [0, 158, 115], [240, 228, 66],
  [0, 114, 178], [213, 94, 0], [204, 121, 167], [120, 120, 120],
];

// Sequential ramp (blue → magenta → yellow), interpolated for ordinal scales.
const RAMP: RGB[] = [
  [13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function rampColor(t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

function categorical(key: string, label: string, values: string[], accessor: (p: GeoPersona) => string): AttrDef {
  const index = new Map(values.map((v, i) => [v, i]));
  return {
    key, label, kind: "categorical", values, accessor,
    color: (v) => CATEGORICAL[(index.get(v) ?? values.length) % CATEGORICAL.length],
  };
}

function ordinal(key: string, label: string, values: string[], accessor: (p: GeoPersona) => string): AttrDef {
  const index = new Map(values.map((v, i) => [v, i]));
  const n = Math.max(1, values.length - 1);
  return {
    key, label, kind: "ordinal", values, accessor,
    color: (v) => rampColor((index.get(v) ?? 0) / n),
  };
}

export function incomeBand(hh: number | null): string {
  if (hh === null || hh === undefined || Number.isNaN(hh)) return "Unknown";
  if (hh < 30000) return "<$30k";
  if (hh < 60000) return "$30–60k";
  if (hh < 100000) return "$60–100k";
  if (hh < 150000) return "$100–150k";
  return "$150k+";
}

export function ageBand(age: number): string {
  if (age < 18) return "<18";
  if (age < 30) return "18–29";
  if (age < 45) return "30–44";
  if (age < 65) return "45–64";
  return "65+";
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function languageAttr(personas: GeoPersona[]): AttrDef {
  const counts = new Map<string, number>();
  for (const p of personas) counts.set(p.language_at_home, (counts.get(p.language_at_home) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([v]) => v);
  const keep = new Set(top);
  const values = keep.size < counts.size ? [...top, "Other"] : top;
  return categorical("language_at_home", "Language at home", values, (p) =>
    keep.has(p.language_at_home) ? p.language_at_home : "Other",
  );
}

export function buildAttributes(personas: GeoPersona[]): AttrDef[] {
  return [
    categorical("borough", "Borough", distinct(personas.map((p) => p.borough)).sort(), (p) => p.borough),
    categorical("race_ethnicity", "Race / ethnicity", distinct(personas.map((p) => p.race_ethnicity)).sort(), (p) => p.race_ethnicity),
    categorical("housing", "Housing", distinct(personas.map((p) => p.housing)).sort(), (p) => p.housing),
    ordinal("income_band", "Household income", ["<$30k", "$30–60k", "$60–100k", "$100–150k", "$150k+", "Unknown"], (p) => incomeBand(p.household_income)),
    languageAttr(personas),
    ordinal("age_band", "Age", ["<18", "18–29", "30–44", "45–64", "65+"], (p) => ageBand(p.age)),
  ];
}

export function filterPredicate(attr: AttrDef, values: string[]): (p: GeoPersona) => boolean {
  if (values.length === 0) return () => true;
  const set = new Set(values);
  return (p) => set.has(attr.accessor(p));
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/map/persona.ts src/lib/map/attributes.ts src/lib/map/attributes.test.ts
git commit -m "feat: persona type + pure attribute/color/filter model with tests"
```

---

### Task 3: Geo build script (bundles the two static JSON files)

**Files:**
- Create: `scripts/geo/build_geo.mjs`
- Create: `public/nyc_pumas.geojson` (generated output — committed)
- Create: `public/personas.geo.json` (generated output — committed)
- Cache (gitignored): `scripts/geo/nyc_pumas_raw.geojson`

**Interfaces:**
- Consumes: `scripts/simnyc/data/nyc_pumas_2020.csv` (puma→borough,neighborhood; 55 rows), `scripts/out/personas.jsonl` (3,000 personas).
- Produces:
  - `public/nyc_pumas.geojson` — `FeatureCollection` of 55 polygons, each `properties = { puma, borough, neighborhood }`.
  - `public/personas.geo.json` — JSON array of `GeoPersona` (card + `id`, `lng`, `lat`), 3,000 entries.

- [ ] **Step 1: Obtain raw PUMA boundaries (once)**

The script auto-fetches from the Census TIGERweb ArcGIS endpoint (2020 PUMAs, NY state) and caches to `scripts/geo/nyc_pumas_raw.geojson`. If the network is unavailable, download NY-state 2020 PUMA boundaries as GeoJSON (WGS84 / EPSG:4326) manually and save them to that exact path, then re-run. The fetch URL used by the script:
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/0/query?where=STATE%3D36&outFields=*&outSR=4326&f=geojson
```

- [ ] **Step 2: Write `scripts/geo/build_geo.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = path.join(ROOT, "scripts/geo/nyc_pumas_raw.geojson");
const CSV = path.join(ROOT, "scripts/simnyc/data/nyc_pumas_2020.csv");
const PERSONAS = path.join(ROOT, "scripts/out/personas.jsonl");
const OUT_PUMAS = path.join(ROOT, "public/nyc_pumas.geojson");
const OUT_PERSONAS = path.join(ROOT, "public/personas.geo.json");
const TIGER =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/0/query?where=STATE%3D36&outFields=*&outSR=4326&f=geojson";
const NYC_BBOX = [-74.3, 40.4, -73.6, 41.0]; // [minLng,minLat,maxLng,maxLat]

// --- seeded RNG (deterministic scatter) ---
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// --- point-in-polygon (ray casting) over a single ring ---
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
// Polygon = [outer, hole1, ...]; point is in polygon if in outer and in no hole.
function inPolygon(x, y, poly) {
  if (!inRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
  return true;
}
// geometry may be Polygon or MultiPolygon
function polygonsOf(geom) {
  return geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
}
function inGeometry(x, y, geom) {
  return polygonsOf(geom).some((poly) => inPolygon(x, y, poly));
}
function bboxOf(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygonsOf(geom))
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
  return [minX, minY, maxX, maxY];
}

async function loadRaw() {
  if (fs.existsSync(RAW)) return JSON.parse(fs.readFileSync(RAW, "utf8"));
  console.log("fetching PUMA boundaries from TIGERweb…");
  const res = await fetch(TIGER);
  assert.ok(res.ok, `TIGERweb fetch failed: ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(RAW), { recursive: true });
  fs.writeFileSync(RAW, text);
  return JSON.parse(text);
}

function loadCsv() {
  const lines = fs.readFileSync(CSV, "utf8").trim().split("\n").slice(1);
  const map = new Map();
  for (const line of lines) {
    // neighborhood may contain commas → split only first two.
    const first = line.indexOf(",");
    const second = line.indexOf(",", first + 1);
    const puma = line.slice(0, first).trim();
    const borough = line.slice(first + 1, second).trim();
    const neighborhood = line.slice(second + 1).trim().replace(/^"|"$/g, "");
    map.set(puma.padStart(5, "0"), { borough, neighborhood });
  }
  return map;
}

// find the 5-digit PUMA code on a raw feature that matches our known set
function matchPuma(props, known) {
  for (const v of Object.values(props)) {
    if (v == null) continue;
    const code = String(v).padStart(5, "0");
    if (/^\d{5}$/.test(code) && known.has(code)) return code;
  }
  return null;
}

async function main() {
  const meta = loadCsv();
  const known = new Set(meta.keys());
  const raw = await loadRaw();

  // --- build PUMA FeatureCollection ---
  const features = [];
  const geomByPuma = new Map();
  for (const f of raw.features) {
    const puma = matchPuma(f.properties, known);
    if (!puma || geomByPuma.has(puma)) continue;
    const info = meta.get(puma);
    const geom = roundGeom(f.geometry);
    geomByPuma.set(puma, geom);
    features.push({ type: "Feature", properties: { puma, ...info }, geometry: geom });
  }
  assert.equal(features.length, 55, `expected 55 PUMA polygons, got ${features.length}`);
  fs.writeFileSync(OUT_PUMAS, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`wrote ${OUT_PUMAS} (${features.length} polygons)`);

  // --- scatter personas ---
  const personaLines = fs.readFileSync(PERSONAS, "utf8").trim().split("\n");
  const out = [];
  personaLines.forEach((line, i) => {
    const card = JSON.parse(line);
    const puma = String(card.puma).padStart(5, "0");
    const geom = geomByPuma.get(puma);
    assert.ok(geom, `no geometry for PUMA ${puma} (persona ${i})`);
    const [minX, minY, maxX, maxY] = bboxOf(geom);
    const rng = mulberry32(i + 1);
    let x = 0, y = 0, ok = false;
    for (let tries = 0; tries < 2000 && !ok; tries++) {
      x = minX + rng() * (maxX - minX);
      y = minY + rng() * (maxY - minY);
      ok = inGeometry(x, y, geom);
    }
    assert.ok(ok, `could not place persona ${i} in PUMA ${puma}`);
    out.push({ id: i, lng: round5(x), lat: round5(y), ...card, puma });
  });

  // --- assertions ---
  assert.equal(out.length, personaLines.length, "persona count mismatch");
  for (const p of out) {
    assert.ok(
      p.lng >= NYC_BBOX[0] && p.lng <= NYC_BBOX[2] && p.lat >= NYC_BBOX[1] && p.lat <= NYC_BBOX[3],
      `persona ${p.id} outside NYC bbox`,
    );
    assert.ok(inGeometry(p.lng, p.lat, geomByPuma.get(p.puma)), `persona ${p.id} outside its PUMA`);
  }
  fs.writeFileSync(OUT_PERSONAS, JSON.stringify(out));
  console.log(`wrote ${OUT_PERSONAS} (${out.length} personas)`);
}

function roundGeom(geom) {
  const r = (ring) => ring.map(([x, y]) => [round5(x), round5(y)]);
  if (geom.type === "Polygon") return { type: "Polygon", coordinates: geom.coordinates.map(r) };
  return { type: "MultiPolygon", coordinates: geom.coordinates.map((poly) => poly.map(r)) };
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Ignore the raw cache**

Append to `.gitignore`:
```
scripts/geo/nyc_pumas_raw.geojson
```

- [ ] **Step 4: Run the build script**

Run: `node scripts/geo/build_geo.mjs`
Expected output:
```
wrote .../public/nyc_pumas.geojson (55 polygons)
wrote .../public/personas.geo.json (3000 personas)
```
(No assertion errors. If the TIGERweb fetch fails, follow Step 1's manual-download fallback and re-run.)

- [ ] **Step 5: Sanity-check the outputs**

Run:
```bash
node -e "const g=require('./public/nyc_pumas.geojson');console.log('pumas',g.features.length);const p=require('./public/personas.geo.json');console.log('personas',p.length,'sample',JSON.stringify(p[0]).slice(0,120))"
```
Expected: `pumas 55` and `personas 3000` with a sample showing `id`, `lng`, `lat`, and card fields.

- [ ] **Step 6: Commit**

```bash
git add scripts/geo/build_geo.mjs public/nyc_pumas.geojson public/personas.geo.json .gitignore
git commit -m "feat: geo build script + bundled PUMA polygons and scattered personas"
```

---

### Task 4: PersonaMap deck.gl canvas (polygons + dots + hover)

**Files:**
- Create: `src/components/map/PersonaMap.tsx`
- Modify: `next.config.ts` (transpile deck.gl if the build needs it)

**Interfaces:**
- Consumes: `GeoPersona` (Task 2), `AttrDef` + `FADED_RGBA` + `filterPredicate` (Task 2), `public/nyc_pumas.geojson` + `public/personas.geo.json` (Task 3).
- Produces (default export): `PersonaMap` — a client component with props
  `{ personas: GeoPersona[]; pumas: GeoJSON.FeatureCollection; colorAttr: AttrDef; filterValues: string[] }`.
  Renders the deck.gl canvas; owns its own hover state and tooltip.

- [ ] **Step 1: Write `src/components/map/PersonaMap.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { AttrDef } from "@/lib/map/attributes";
import { FADED_RGBA, filterPredicate } from "@/lib/map/attributes";
import type { GeoPersona } from "@/lib/map/persona";

const INITIAL_VIEW_STATE = {
  longitude: -73.94,
  latitude: 40.7,
  zoom: 9.4,
  pitch: 40,
  bearing: -18,
};

const BOROUGH_OUTLINE: Record<string, [number, number, number]> = {
  Manhattan: [86, 180, 233], Brooklyn: [0, 158, 115], Queens: [230, 159, 0],
  Bronx: [213, 94, 0], "Staten Island": [204, 121, 167],
};

interface Props {
  personas: GeoPersona[];
  pumas: GeoJSON.FeatureCollection;
  colorAttr: AttrDef;
  filterValues: string[];
}

interface Hover { x: number; y: number; p: GeoPersona }

export default function PersonaMap({ personas, pumas, colorAttr, filterValues }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  const pass = useMemo(
    () => filterPredicate(colorAttr, filterValues),
    [colorAttr, filterValues],
  );
  const active = useMemo(() => personas.filter(pass), [personas, pass]);

  const layers = [
    new GeoJsonLayer({
      id: "pumas",
      data: pumas,
      stroked: true,
      filled: true,
      getFillColor: [255, 255, 255, 8],
      getLineColor: (f: GeoJSON.Feature) =>
        [...(BOROUGH_OUTLINE[(f.properties?.borough as string) ?? ""] ?? [120, 120, 130]), 160] as
          [number, number, number, number],
      getLineWidth: 40,
      lineWidthMinPixels: 1,
      pickable: false,
    }),
    // faint context layer: every persona, always drawn underneath
    new ScatterplotLayer({
      id: "context",
      data: personas,
      getPosition: (p: GeoPersona) => [p.lng, p.lat],
      getFillColor: FADED_RGBA,
      getRadius: 3,
      radiusMinPixels: 1.2,
      radiusMaxPixels: 4,
      pickable: false,
    }),
    // active layer: only rows passing the filter, colored by the attribute
    new ScatterplotLayer({
      id: "active",
      data: active,
      getPosition: (p: GeoPersona) => [p.lng, p.lat],
      getFillColor: (p: GeoPersona) => {
        const [r, g, b] = colorAttr.color(colorAttr.accessor(p));
        return [r, g, b, 220];
      },
      getRadius: 4,
      radiusMinPixels: 1.6,
      radiusMaxPixels: 6,
      stroked: false,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 255],
      transitions: { getFillColor: { duration: 400 } },
      updateTriggers: { getFillColor: [colorAttr.key] },
      onHover: (info) =>
        setHover(
          info.object ? { x: info.x, y: info.y, p: info.object as GeoPersona } : null,
        ),
    }),
  ];

  return (
    <>
      <DeckGL
        views={new MapView({ repeat: false })}
        initialViewState={INITIAL_VIEW_STATE}
        controller={{ dragRotate: true, minZoom: 8.5, maxZoom: 13 }}
        layers={layers}
        style={{ background: "transparent" }}
      />
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-white/15 bg-neutral-900/95 p-3 text-xs text-neutral-100 shadow-xl backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="font-medium text-neutral-200">
            {hover.p.neighborhood} · {hover.p.borough}
          </div>
          <div className="mt-1 text-neutral-400">
            {hover.p.age} · {hover.p.race_ethnicity} · {hover.p.housing}
          </div>
          <div className="text-neutral-400">
            HH income {hover.p.household_income == null ? "—" : `$${hover.p.household_income.toLocaleString()}`} · {hover.p.language_at_home}
          </div>
          {hover.p.context_notes && (
            <div className="mt-1 italic text-neutral-500">{hover.p.context_notes}</div>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add deck.gl transpile guard to `next.config.ts`**

Read the current file first, then set:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@deck.gl/react", "@deck.gl/core", "@deck.gl/layers"],
};

export default nextConfig;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `PersonaMap.tsx`. (If deck.gl JSX prop types complain about `views`, confirm `@deck.gl/react` is the `^9` version installed in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add src/components/map/PersonaMap.tsx next.config.ts
git commit -m "feat: deck.gl PersonaMap canvas — polygons, dot layers, hover card"
```

---

### Task 5: Control panel + legend

**Files:**
- Create: `src/components/map/ControlPanel.tsx`
- Create: `src/components/map/Legend.tsx`

**Interfaces:**
- Consumes: `AttrDef` (Task 2).
- Produces:
  - `ControlPanel` — props `{ attrs: AttrDef[]; colorKey: string; onColorKey: (k: string) => void; filterValues: string[]; onFilterValues: (v: string[]) => void; shown: number; total: number }`. A color-by chooser (buttons over `attrs`), filter chips over the active attribute's `values`, and a live "showing N of M" count.
  - `Legend` — props `{ attr: AttrDef }`. Swatch+label rows (categorical) or a gradient bar with end labels (ordinal).

- [ ] **Step 1: Write `src/components/map/ControlPanel.tsx`**

```tsx
"use client";

import type { AttrDef } from "@/lib/map/attributes";
import { cn } from "@/lib/utils";

interface Props {
  attrs: AttrDef[];
  colorKey: string;
  onColorKey: (k: string) => void;
  filterValues: string[];
  onFilterValues: (v: string[]) => void;
  shown: number;
  total: number;
}

export function ControlPanel({
  attrs, colorKey, onColorKey, filterValues, onFilterValues, shown, total,
}: Props) {
  const active = attrs.find((a) => a.key === colorKey)!;

  function toggle(v: string) {
    onFilterValues(
      filterValues.includes(v) ? filterValues.filter((x) => x !== v) : [...filterValues, v],
    );
  }

  return (
    <div className="absolute left-4 top-4 z-40 w-64 rounded-xl border border-white/15 bg-neutral-900/70 p-4 text-neutral-100 shadow-2xl backdrop-blur-md">
      <h1 className="text-sm font-semibold tracking-tight">NYC persona cloud</h1>
      <p className="mt-0.5 text-[11px] text-neutral-400">
        3,000 synthetic New Yorkers · illustrative positions
      </p>

      <div className="mt-4 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Color by
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attrs.map((a) => (
          <button
            key={a.key}
            onClick={() => { onColorKey(a.key); onFilterValues([]); }}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              a.key === colorKey
                ? "bg-white text-neutral-900"
                : "bg-white/10 text-neutral-200 hover:bg-white/20",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Filter
        </span>
        {filterValues.length > 0 && (
          <button
            onClick={() => onFilterValues([])}
            className="text-[11px] text-neutral-400 underline hover:text-neutral-200"
          >
            clear
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {active.values.map((v) => {
          const on = filterValues.includes(v);
          const [r, g, b] = active.color(v);
          return (
            <button
              key={v}
              onClick={() => toggle(v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-colors",
                on ? "bg-white/20 text-white" : "bg-white/5 text-neutral-300 hover:bg-white/10",
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: `rgb(${r},${g},${b})` }}
              />
              {v}
            </button>
          );
        })}
      </div>

      <div className="mt-4 text-xs text-neutral-400">
        showing <span className="font-medium text-neutral-100">{shown.toLocaleString()}</span> of{" "}
        {total.toLocaleString()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/map/Legend.tsx`**

```tsx
"use client";

import type { AttrDef } from "@/lib/map/attributes";

export function Legend({ attr }: { attr: AttrDef }) {
  if (attr.kind === "ordinal") {
    const stops = attr.values.map((v) => {
      const [r, g, b] = attr.color(v);
      return `rgb(${r},${g},${b})`;
    });
    return (
      <div className="absolute bottom-4 left-4 z-40 rounded-xl border border-white/15 bg-neutral-900/70 p-3 text-neutral-100 shadow-2xl backdrop-blur-md">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          {attr.label}
        </div>
        <div
          className="h-2 w-48 rounded-full"
          style={{ background: `linear-gradient(to right, ${stops.join(",")})` }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
          <span>{attr.values[0]}</span>
          <span>{attr.values[attr.values.length - 1]}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 z-40 max-w-xs rounded-xl border border-white/15 bg-neutral-900/70 p-3 text-neutral-100 shadow-2xl backdrop-blur-md">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {attr.label}
      </div>
      <div className="flex flex-col gap-1">
        {attr.values.map((v) => {
          const [r, g, b] = attr.color(v);
          return (
            <div key={v} className="flex items-center gap-2 text-xs text-neutral-200">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: `rgb(${r},${g},${b})` }} />
              {v}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/map/ControlPanel.tsx src/components/map/Legend.tsx
git commit -m "feat: map control panel + legend"
```

---

### Task 6: `/map` route — data loading, state wiring, entrance polish

**Files:**
- Create: `src/app/map/page.tsx`
- Create: `src/app/map/MapClient.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: the working `/map` page. `page.tsx` is a thin server component that renders `<MapClient/>`; `MapClient` (client) fetches the two JSONs, holds `colorKey`/`filterValues` state, computes the shown count, and renders `PersonaMap` (via `next/dynamic`, `ssr:false`), `ControlPanel`, and `Legend`.

- [ ] **Step 1: Write `src/app/map/MapClient.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { buildAttributes, filterPredicate } from "@/lib/map/attributes";
import type { GeoPersona } from "@/lib/map/persona";
import { ControlPanel } from "@/components/map/ControlPanel";
import { Legend } from "@/components/map/Legend";

const PersonaMap = dynamic(() => import("@/components/map/PersonaMap"), { ssr: false });

export function MapClient() {
  const [personas, setPersonas] = useState<GeoPersona[] | null>(null);
  const [pumas, setPumas] = useState<GeoJSON.FeatureCollection | null>(null);
  const [colorKey, setColorKey] = useState("borough");
  const [filterValues, setFilterValues] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/personas.geo.json").then((r) => r.json()),
      fetch("/nyc_pumas.geojson").then((r) => r.json()),
    ]).then(([p, g]) => {
      setPersonas(p);
      setPumas(g);
      requestAnimationFrame(() => setReady(true)); // triggers fade-in
    });
  }, []);

  const attrs = useMemo(() => (personas ? buildAttributes(personas) : []), [personas]);
  const colorAttr = attrs.find((a) => a.key === colorKey) ?? attrs[0];

  const shown = useMemo(() => {
    if (!personas || !colorAttr) return 0;
    return personas.filter(filterPredicate(colorAttr, filterValues)).length;
  }, [personas, colorAttr, filterValues]);

  const loaded = personas && pumas && colorAttr;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0a0e17]">
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">
          loading 3,000 New Yorkers…
        </div>
      )}
      {loaded && (
        <div
          className="h-full w-full transition-opacity duration-700"
          style={{ opacity: ready ? 1 : 0 }}
        >
          <PersonaMap
            personas={personas}
            pumas={pumas}
            colorAttr={colorAttr}
            filterValues={filterValues}
          />
          <ControlPanel
            attrs={attrs}
            colorKey={colorAttr.key}
            onColorKey={setColorKey}
            filterValues={filterValues}
            onFilterValues={setFilterValues}
            shown={shown}
            total={personas.length}
          />
          <Legend attr={colorAttr} />
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write `src/app/map/page.tsx`**

```tsx
import { MapClient } from "./MapClient";

export const metadata = { title: "NYC persona cloud" };

export default function MapPage() {
  return <MapClient />;
}
```

- [ ] **Step 3: Run the dev server and load the page**

Run: `npm run dev` (background), then open `http://localhost:3000/map`.
Expected: the five boroughs render as outlined shapes on a dark canvas; ~3,000 colored dots fade in; the control panel and legend appear.

- [ ] **Step 4: Production build check**

Run: `npm run build`
Expected: build succeeds. (If it fails on a deck.gl ESM/`window` reference, confirm `PersonaMap` is imported via `next/dynamic` with `ssr:false` and that `transpilePackages` from Task 4 is present.)

- [ ] **Step 5: Commit**

```bash
git add src/app/map/page.tsx src/app/map/MapClient.tsx
git commit -m "feat: /map route — persona point cloud with color, filter, hover, fade-in"
```

---

### Task 7: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** consumes the running app.

- [ ] **Step 1: Full interaction pass**

With `npm run dev` running, at `http://localhost:3000/map` verify each:
1. Dots fade in on load; NYC borough shapes are recognizable with distinct outline colors.
2. Click each **Color by** button (Borough, Race/ethnicity, Housing, Household income, Language, Age) — dots recolor with a smooth transition; the legend swaps between swatch-list (categorical) and gradient bar (ordinal).
3. Click filter chips — non-matching dots drop to faint gray, matching stay colored on top; the "showing N of M" count updates and N ≤ M.
4. "clear" resets the filter; switching Color-by also clears the filter.
5. Hover a dot — the persona card tooltip shows neighborhood, borough, age, income, housing, language, and context notes, and tracks the cursor.
6. Pan / zoom / drag-rotate stay within the constrained bounds; the city can't be lost off-screen.

- [ ] **Step 2: Confirm no console errors**

In the browser devtools console, confirm no WebGL/deck.gl errors during load and interaction.

- [ ] **Step 3: Record verification**

No code change. If all steps pass, the feature is complete. If any fail, file the specific failure and route back to the owning task (rendering/hover → Task 4; controls/legend → Task 5; data → Task 3).

---

## Self-Review Notes

- **Spec coverage:** persona point cloud (T3, T4) ✓; self-contained PUMA/borough shapes (T3, T4) ✓; deck.gl standalone no-basemap (T4) ✓; two static bundled JSONs (T3) ✓; seeded placement inside PUMA (T3) ✓; color-by / filter / hover interactions (T4, T5, T6) ✓; six attributes incl. income & age banding + language top-N (T2) ✓; colorblind-safe categorical + sequential ordinal palettes (T2) ✓; visual polish — dark theme, color/alpha transitions, entrance fade, pitched constrained camera, glassy panel/legend, illustrative caption (T4, T5, T6) ✓; pure tested `attributes.ts` + geo assertions (T2, T3) ✓.
- **Deferred (out of scope, matches spec):** click-through PUMA stats panel, real basemap tiles, poll overlays, Supabase-backed loading, light theme/mobile, per-address geocoding.
- **Type consistency:** `GeoPersona`, `AttrDef`, `filterPredicate`, `FADED_RGBA`, `buildAttributes` names/signatures are consistent across T2→T4→T5→T6. `PersonaMap` default export consumed via `next/dynamic` in T6.

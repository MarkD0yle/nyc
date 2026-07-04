# Persona Point Cloud Map (Pass 3) — design

**Date:** 2026-07-04
**Status:** Approved (pending spec review)

## Purpose

Visualize the 3,000 synthetic NYC personas as a WebGL point cloud scattered
across a self-contained NYC basemap (the 55 PUMA polygons + borough outlines),
colored and filtered by demographic attribute. A spatial "who lives where" lens
over the Pass 1 persona data. No polling engine, no backend, no API keys.

## Background

- Pass 1 produced **3,000 weighted personas** (`scripts/out/personas.jsonl`),
  each tagged to one of **55 NYC PUMAs (2020)** with borough + neighborhood, plus
  `age, sex, race_ethnicity, education, employment, personal_income,
  household_income, household_size, housing, gross_rent, language_at_home,
  commute, context_notes`.
- The Next.js app (App Router, Next 16.2.10, React 19, Tailwind v4, shadcn/ui) is
  still the scaffold — home page is a smoke-test card; no routes beyond `/`.
- Pass 2 (polling engine) is designed but not built and explicitly deferred
  PUMA-level map visualization. This feature does **not** depend on Pass 2 and
  does not touch Supabase.

## Key decisions (locked in brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| What the map shows | **Persona point cloud** — 3,000 dots | Spatial view of existing data; buildable now |
| Basemap | **Self-contained shapes** (PUMA polygons + borough outlines), no tiles | Fully offline, no API keys, clean data-viz look |
| WebGL engine | **deck.gl** standalone (`MapView`, no basemap library) | Purpose-built for large GPU point clouds + GeoJSON + hover picking |
| Data source | **Two bundled static JSON files** in `public/` | No backend; instant load; matches self-contained ethos |
| Point placement | **Seeded-random point inside each persona's PUMA polygon**, precomputed | Dots stable across reloads; positions are illustrative, not real addresses |
| v1 interactions | **Color-by-attribute, filter-to-subset, hover-for-card** | Approved scope; no click-through PUMA stats panel |

## Architecture

```
/map (client route)
  loads:  public/nyc_pumas.geojson   (55 PUMA polygons, borough tagged)
          public/personas.geo.json   (3,000 personas: card + lng/lat)
  state:  colorBy (attribute), filter (attribute + selected values), hovered
  render: <PersonaMap>
            DeckGL (MapView, no basemap)
              GeoJsonLayer   — PUMA polygons: faint fill, borough-colored borders
              ScatterplotLayer — 3,000 persona dots, GPU color + filter alpha
            <ControlPanel>  — color-by dropdown, filter controls, live count
            <Legend>        — swatches for active color attribute
            hover tooltip   — persona card
```

Everything runs client-side. No route handlers, no DB.

## Data prep (one-time offline step)

A small script (`scripts/geo/build_geo.mjs`, node) builds both bundled files:

1. **PUMA geometry** — download NYC 2020 PUMA boundaries (Census TIGER 2020
   `tl_2020_36_puma20` filtered to NYC's 55 PUMAs, or NYC Open Data 2020 PUMA
   layer). Reproject to WGS84 (lng/lat) if needed, simplify (target < ~300 KB),
   tag each feature with `puma`, `borough`, `neighborhood`. Write
   `public/nyc_pumas.geojson`.
2. **Persona placement** — read `scripts/out/personas.jsonl`; for each persona,
   generate a **seeded** uniform-random point inside its PUMA polygon
   (rejection sampling within the polygon bbox; seed derived from persona index
   so output is deterministic). Emit `public/personas.geo.json` as
   `{ id, lng, lat, ...card }`. Target file size kept small (round coords to
   ~5 decimals).

The script is idempotent and committed so the bundled JSON can be regenerated.
If the network fetch of boundaries is unavailable at build time, the script
accepts a local path to a pre-downloaded PUMA shapefile/GeoJSON.

## Attribute model — `src/lib/map/attributes.ts`

Single source of truth. Each colorable/filterable attribute is a definition:

```ts
type AttrKind = 'categorical' | 'ordinal'
interface AttrDef {
  key: string                 // 'borough', 'income_band', ...
  label: string               // 'Borough'
  kind: AttrKind
  values: string[]            // ordered category list (bands ordered low→high)
  accessor: (p: GeoPersona) => string     // maps a persona to a category
  color: (value: string) => [number, number, number]  // RGB
}
```

Attributes exposed in v1: **borough, race_ethnicity, housing, income_band,
language_at_home (top N + "Other"), age_band**. `income_band` reuses the Pass 2
bucket boundaries (`<$30k, $30–60k, $60–100k, $100–150k, $150k+`); `age_band`
buckets into decades. Palettes:

- **Categorical** attributes → a fixed colorblind-safe categorical palette
  (Okabe–Ito / Tableau-10 style), assigned by value order.
- **Ordinal** attributes (income, age) → a sequential ramp so magnitude reads
  visually.

All color and filter logic is pure functions here — the primary unit-test target.

## Interactions

- **Color by** — dropdown (shadcn `Select`) over the attribute list. Changing it
  recolors every dot and rebuilds the legend. Dots animate to new colors
  (deck.gl `transitions` on `getFillColor`).
- **Filter** — choose an attribute, then toggle its values (chips/checkboxes).
  Non-matching dots don't vanish — they drop to a **faint desaturated gray with
  low alpha** so the city's shape stays legible; matching dots stay full color
  and render on top. A live count reads "showing 412 of 3,000." Filter alpha is
  animated (deck.gl transition on `getFillColor` alpha).
- **Hover** — deck.gl picking. Tooltip is a small shadcn `Card` showing
  neighborhood + borough, age, household income, housing, language, and
  `context_notes`. The hovered dot gets a highlight ring (deck.gl
  `autoHighlight` / `highlightColor`).

## Visual polish

Polish is a first-class requirement, not an afterthought:

- **Theme** — dark canvas (deep navy/near-black) so luminous dots pop; PUMA fills
  very low-opacity, borough outlines thin and slightly brighter. Light-theme
  variant deferred.
- **Dots** — small radius with subtle radius scaling by zoom (`radiusMinPixels`
  /`radiusMaxPixels`), soft edges (`stroked: false`, slight `opacity`), giving a
  gentle glow-cluster feel where personas concentrate.
- **Motion** — animated color/alpha transitions (~300–500ms `interpolation`) on
  every recolor and filter change; a brief **entrance stagger/fade-in** of the
  dots on first load; smooth eased initial camera framing of NYC.
- **Camera** — initial `viewState` framed on the five boroughs with a slight
  pitch (subtle 3D tilt) for depth; constrained pan/zoom bounds so you can't lose
  the city.
- **Chrome** — floating glassy control panel (backdrop blur, rounded, subtle
  border) top-left; legend bottom-left; live count and a one-line caption
  ("3,000 synthetic New Yorkers · illustrative positions"). Geist type, generous
  spacing, restrained.
- **Legend** — swatch + label rows; for ordinal attributes a continuous gradient
  bar with end labels.

Performance note: 3,000 points is trivial for deck.gl; transitions and glow are
essentially free at this scale.

## Component breakdown

| File | Purpose | Depends on |
|---|---|---|
| `src/app/map/page.tsx` | `/map` route (client); fetches both JSONs; owns colorBy/filter/hover state | components below |
| `src/components/map/PersonaMap.tsx` | DeckGL canvas, MapView, the two layers, hover wiring, transitions | `attributes.ts`, deck.gl |
| `src/components/map/ControlPanel.tsx` | Color-by `Select`, filter chips, live count | shadcn ui, `attributes.ts` |
| `src/components/map/Legend.tsx` | Swatches / gradient bar for active attribute | `attributes.ts` |
| `src/lib/map/attributes.ts` | Attribute defs, palettes, accessors, filter predicate — pure fns | `persona.ts` |
| `src/lib/map/persona.ts` | `GeoPersona` type | — |
| `scripts/geo/build_geo.mjs` | One-time builder for `nyc_pumas.geojson` + `personas.geo.json` | node, personas.jsonl |

Layout goal: deck.gl components stay thin/presentational; all category/color/
filter decisions live in `attributes.ts` so they can be understood and tested
without a browser.

## Dependencies to add

`@deck.gl/core`, `@deck.gl/react`, `@deck.gl/layers` (runtime). Geometry-prep
script may use a lightweight point-in-polygon helper (e.g. `@turf/boolean-point-in-polygon`)
as a devDependency; no runtime geo library needed.

## Testing

- **`attributes.ts` — unit tests (primary):** each attribute's accessor maps a
  known persona to the expected category; income/age banding boundaries;
  categorical palette assignment is stable and within range; filter predicate
  includes/excludes correctly (empty filter = all pass).
- **`build_geo.mjs` — sanity assertions:** every emitted persona point falls
  inside its PUMA polygon; output count = input count (3,000); coords within NYC
  bbox. Runnable as a one-off check, not CI.
- **Manual E2E:** load `/map`, recolor by each attribute, apply a filter, hover a
  dot — verify counts, legend, tooltip, and transitions.

## Out of scope for Pass 3

- Click-through PUMA aggregate panel (deferred; may return in a later pass).
- Real street basemap / vector tiles.
- Poll-result overlay (arrives when Pass 2 exists; the map shell can host it later).
- Supabase-backed live persona loading (static bundle only in v1).
- Light theme, mobile-optimized layout, deep zoom to street level.
- Real per-address geocoding (positions are illustrative by design).

## Tech constraints

- Next.js App Router; the map route is a **client component** (deck.gl needs the
  DOM/WebGL). Per `AGENTS.md`, this is not the Next.js in training data — read the
  relevant App Router / client-component guides in `node_modules/next/dist/docs/`
  before writing route code.
- TypeScript strict; Tailwind v4; shadcn/ui for chrome.
- No external network at runtime (self-contained bundle).

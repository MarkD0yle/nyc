# Make the persona map read as NYC in shape

**Date:** 2026-07-04

## Problem

Persona dots already sit at real lat/lng inside the 55 NYC PUMA polygons, so the
geographic shape is technically present. But land and water share the same dark
background, so the map reads as a formless dot cloud rather than the recognizable
five-borough silhouette. NYC is legible only when *water* carves the land apart
(Manhattan-as-island, the Hudson/East rivers, the harbor).

## Goals

1. **Water contrast** — a distinct water background so land reads as negative-space land.
2. **Land silhouette fill** — an opaque, muted land shape beneath the dots so sparse
   areas still read as land; tinted subtly per borough.
3. **Sharper borough outlines** — clean dissolved borough boundaries/coastline instead
   of 55 cluttered internal PUMA seams.

Non-goals: no change to the 3D tilt/bearing, dot layers, hover, filters, legend, or
color-by-attribute behavior. Personas are not regenerated.

## Approach

### Build step (dev-only)
Add a small script that reads the existing `public/nyc_pumas.geojson`, dissolves the
55 PUMAs into **5 borough polygons** (grouped by the `borough` property), and writes
`public/nyc_boroughs.geojson` (a FeatureCollection of 5 features, each with a
`borough` property). Uses `@turf/turf` added as a **devDependency** — used only in the
build, never shipped to the browser. Wired as an npm script alongside the existing geo
build.

### Rendering (`PersonaMap.tsx` + `MapClient.tsx`)
- Container/DeckGL background → deep water tone (replace `#0a0e17`).
- New `GeoJsonLayer` for boroughs: opaque fill, muted per-borough land tint; crisp,
  brighter line for the dissolved coastline/borough outline.
- Replace the existing per-PUMA `GeoJsonLayer` with the borough layer (drop the 55
  internal seams). `MapClient` fetches `nyc_boroughs.geojson` instead of / in addition
  to `nyc_pumas.geojson`.
- Dot layers, hover, filters, legend unchanged, drawn on top.

Layer stack (bottom → top): water background → borough land fill + outline →
faint context dots → active colored dots → hover.

## Risks

- Turf dissolve on 5-decimal-rounded coords may leave minor slivers — acceptable at
  this zoom. Verify the output has exactly 5 features.
- Land fill must stay darker/muted than the dots so dots remain the focus.

## Verification

Regenerate `nyc_boroughs.geojson` (assert 5 features), run the app at `/map`, confirm
the five-borough silhouette with visible water and clean borough outlines, dots still
legible and colored on top.

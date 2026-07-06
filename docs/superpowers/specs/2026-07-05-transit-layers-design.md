# Transit & Mobility Layers — Design Spec

**Date:** 2026-07-05  
**Branch:** pass-4-transit-layers

## Problem

The persona map visualises who lives where, but has no real city context. A renter in Canarsie and a renter in Park Slope look identical — even though one is a 45-min commute from the nearest subway. Adding transit data makes the app actually useful: you can ask "show renters who live far from the subway" or "which borough's ADA coverage is worst".

## Decision

Add a **transit & mobility data layer** to the `/map` route, consisting of:

1. **Toggleable map layers** — subway lines, subway stations, bike routes, Citi Bike stations.
2. **Derived per-persona attributes** — nearest-subway distance, nearest station name/lines, ADA accessibility — wired into the existing color-by and filter system.

Persona and transit data actually interact, not just decorate.

## Out of scope (v1)

- PUMA commute choropleth (ACS B08301)
- Station ridership sizing
- Polling engine (Pass 2)

## Data sources (verified 2026-07-05)

| Dataset | Endpoint |
|---|---|
| Subway lines | `https://data.ny.gov/resource/s692-irgq.json?$limit=100` (29 features) |
| Subway stations | `https://data.ny.gov/resource/39hk-dx4f.json?$limit=1000` (496 rows) |
| Bike routes | `https://data.cityofnewyork.us/resource/mzxg-pwib.json?$where=status='Current'` |
| Citi Bike | `https://gbfs.citibikenyc.com/gbfs/en/station_information.json` (GBFS live) |

**Note:** NYC Open Data `3qz8-muuu` (subway lines) and `9e2b-mctv` (bike routes) are retired/hollow — `s692-irgq` and `mzxg-pwib` are the verified replacements.

## Architecture

### Build pipeline (scripts/geo/)

```
build_transit.mjs   → public/subway_lines.geojson
                       public/subway_stations.json
                       public/bike_routes.geojson
                       public/citibike_stations.json

enrich_transit.mjs  → rewrites public/personas.geo.json
                       (adds subway_distance_m, nearest_station_name,
                        nearest_station_lines, ada_nearby per persona)
```

Runs after `build_geo.mjs`. `npm run geo:all` chains all four scripts.

### Shared pure math (src/lib/geo/transit.ts)

- `haversineMeters(lat1, lng1, lat2, lng2): number`
- `nearestStation(persona, stations): { station, distanceM }`

Imported by `enrich_transit.mjs` (Node 25 native TS strip). Unit-tested via vitest.

### Client types (src/lib/map/transit.ts)

- `SubwayStation`, `CitiBikeStation` interfaces
- `TransitLayerKey` union type, `TRANSIT_LAYERS` list
- `routeColor(service): RGB` — official MTA hex colors per line group
- Bike facility class colors (muted dark-theme greens)

### Map changes

**MapClient.tsx** — `transitOn: Record<TransitLayerKey, boolean>` state (all default off); lazy-fetch per layer on first toggle. Persona card gains nearest-station line in hover.

**ControlPanel.tsx** — "Transit" section with four pill toggles.

**PersonaMap.tsx** — layer draw order:
1. Borough polygons
2. Bike routes (`GeoJsonLayer`, by class color, not pickable)
3. Subway lines (`GeoJsonLayer`, by `routeColor`, not pickable)
4. Context dots (existing)
5. Subway stations (`ScatterplotLayer`, pickable — hover card)
6. Citi Bike stations (`ScatterplotLayer`, not pickable in v1)
7. Active persona dots (on top)

Hover becomes a discriminated union `{kind: "persona"} | {kind: "station"}`.

### Persona model + attributes

`GeoPersona` gains four optional fields: `subway_distance_m`, `nearest_station_name`, `nearest_station_lines`, `ada_nearby`.

`buildAttributes()` gains two new entries (count 6 → 8):
- `ordinal("subway_distance", "Subway access", ["<400m","400–800m","800–1600m",">1600m","Unknown"], ["Unknown"])`
- `categorical("ada_nearby", "Nearest station ADA", ["ADA accessible","Not accessible","Unknown"])`

## Risks

- Bike routes file may hit 5 MB after simplification; `shared`-class trim or tolerance increase is the safety valve.
- GBFS is a live feed — Citi Bike snapshot diffs on re-run; `fetched_at` key documents this.
- Overlapping trunk services (1/2/3 on 7th Ave) render last-on-top single-color — cosmetic, noted in code.

## Roadmap (post-v1)

1. PUMA commute choropleth (ACS B08301 mode share on existing polygons)
2. Station ridership sizing (Socrata `5wq4-mkjj`)
3. Poll breakdowns by transit attributes (Pass 2)

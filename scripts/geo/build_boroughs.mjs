// Dissolve the 55 NYC PUMA polygons into 5 clean borough polygons.
// Reads the already-built public/nyc_pumas.geojson (does NOT regenerate personas)
// and writes public/nyc_boroughs.geojson — used by the map for the land silhouette
// fill + a crisp dissolved coastline/borough outline.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dissolve, flatten, featureCollection } from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IN = path.join(ROOT, "public/nyc_pumas.geojson");
const OUT = path.join(ROOT, "public/nyc_boroughs.geojson");
const round5 = (n) => Math.round(n * 1e5) / 1e5;

const pumas = JSON.parse(fs.readFileSync(IN, "utf8"));

// turf.dissolve merges adjacent Polygons sharing a property value, but only
// accepts Polygon features — flatten any MultiPolygon into its parts first.
const flat = flatten(featureCollection(pumas.features));
const dissolved = dissolve(flat, { propertyName: "borough" });

// dissolve returns one feature per resulting ring group; regroup by borough so
// each borough is a single (Multi)Polygon feature with clean outer boundaries.
const byBorough = new Map();
for (const f of dissolved.features) {
  const b = f.properties.borough;
  if (!byBorough.has(b)) byBorough.set(b, []);
  byBorough.get(b).push(f.geometry);
}

const round = (coords) =>
  Array.isArray(coords[0])
    ? coords.map(round)
    : [round5(coords[0]), round5(coords[1])];

const features = [...byBorough.entries()].map(([borough, geoms]) => {
  const polys = geoms.flatMap((g) =>
    g.type === "MultiPolygon" ? g.coordinates : [g.coordinates],
  );
  return {
    type: "Feature",
    properties: { borough },
    geometry:
      polys.length === 1
        ? { type: "Polygon", coordinates: round(polys[0]) }
        : { type: "MultiPolygon", coordinates: round(polys) },
  };
});

assert.equal(features.length, 5, `expected 5 boroughs, got ${features.length}`);
fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(
  `wrote ${OUT} (${features.length} boroughs: ${features
    .map((f) => f.properties.borough)
    .join(", ")})`,
);

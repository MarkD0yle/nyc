import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { haversineMeters } from "../../src/lib/geo/transit.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATIONS = path.join(ROOT, "public/subway_stations.json");
const PERSONAS = path.join(ROOT, "public/personas.geo.json");

function main() {
  // --- Load stations ---
  const stations = JSON.parse(fs.readFileSync(STATIONS, "utf8"));
  assert.ok(stations.length > 0, "No stations loaded");
  console.log(`Loaded ${stations.length} subway stations`);

  // --- Load personas ---
  const personas = JSON.parse(fs.readFileSync(PERSONAS, "utf8"));
  assert.equal(personas.length, 3000, `Expected 3000 personas, got ${personas.length}`);
  console.log(`Loaded ${personas.length} personas`);

  // --- Enrich each persona with nearest subway station data ---
  const distances = [];
  for (const persona of personas) {
    let minDistance = Infinity;
    let nearestStation = null;

    for (const station of stations) {
      const distance = haversineMeters(persona.lat, persona.lng, station.lat, station.lng);
      if (distance < minDistance) {
        minDistance = distance;
        nearestStation = station;
      }
    }

    assert.ok(nearestStation !== null, `No nearest station found for persona ${persona.id}`);

    // Add four fields to persona
    persona.subway_distance_m = Math.round(minDistance);
    persona.nearest_station_name = nearestStation.name;
    persona.nearest_station_lines = nearestStation.routes;
    persona.ada_nearby = nearestStation.ada >= 1;

    distances.push(minDistance);
  }

  // --- Assertions on enriched data ---
  for (const persona of personas) {
    assert.ok(
      Number.isFinite(persona.subway_distance_m) && persona.subway_distance_m > 0 && persona.subway_distance_m < 10000,
      `Invalid subway_distance_m for persona ${persona.id}: ${persona.subway_distance_m}`,
    );
    assert.ok(
      typeof persona.nearest_station_name === "string" && persona.nearest_station_name.length > 0,
      `Invalid nearest_station_name for persona ${persona.id}`,
    );
    assert.ok(typeof persona.ada_nearby === "boolean", `Invalid ada_nearby for persona ${persona.id}`);
  }

  // --- Distribution statistics ---
  distances.sort((a, b) => a - b);
  const minDist = distances[0];
  const maxDist = distances[distances.length - 1];
  const medianDist = distances[Math.floor(distances.length / 2)];

  console.log(`\nDistance distribution (meters):`);
  console.log(`  Min:    ${minDist.toFixed(1)}`);
  console.log(`  Median: ${medianDist.toFixed(1)}`);
  console.log(`  Max:    ${maxDist.toFixed(1)}`);

  // Count personas far from subway
  const farCount = personas.filter((p) => p.subway_distance_m > 1600).length;
  console.log(`\nPersonas > 1600m from subway: ${farCount}`);

  // --- Write enriched personas back (minified) ---
  fs.writeFileSync(PERSONAS, JSON.stringify(personas));
  console.log(`\nWrote enriched personas to ${PERSONAS}`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}

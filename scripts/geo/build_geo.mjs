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
      // Validate the *rounded* point (what we actually store/assert below), not the raw
      // point — a raw point can be inside the polygon while its 5-decimal rounding
      // (~1.1m grid) lands just outside a boundary edge.
      ok = inGeometry(round5(x), round5(y), geom);
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

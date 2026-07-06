import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_SUBWAY_LINES    = path.join(ROOT, "scripts/geo/subway_lines_raw.json");
const RAW_SUBWAY_STATIONS = path.join(ROOT, "scripts/geo/subway_stations_raw.json");
const RAW_BIKE_ROUTES     = path.join(ROOT, "scripts/geo/bike_routes_raw.json");
const RAW_CITIBIKE        = path.join(ROOT, "scripts/geo/citibike_raw.json");
const BOROUGHS_FILE       = path.join(ROOT, "public/nyc_boroughs.geojson");
const OUT_SUBWAY_LINES    = path.join(ROOT, "public/subway_lines.geojson");
const OUT_SUBWAY_STATIONS = path.join(ROOT, "public/subway_stations.json");
const OUT_BIKE_ROUTES     = path.join(ROOT, "public/bike_routes.geojson");
const OUT_CITIBIKE        = path.join(ROOT, "public/citibike_stations.json");

const NYC_BBOX = [-74.3, 40.4, -73.6, 41.0]; // [minLng, minLat, maxLng, maxLat]

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

// ── helpers ────────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  assert.ok(res.ok, `fetch failed (${res.status}): ${url}`);
  return res.json();
}

async function loadOrFetch(rawPath, fetchFn, label) {
  if (fs.existsSync(rawPath)) {
    console.log(`cache hit: ${path.basename(rawPath)}`);
    return JSON.parse(fs.readFileSync(rawPath, "utf8"));
  }
  console.log(`fetching ${label}…`);
  const data = await fetchFn();
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  fs.writeFileSync(rawPath, JSON.stringify(data));
  return data;
}

// Douglas-Peucker line simplification (inlined — no npm deps)
function dpSimplify(pts, eps) {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1e-10;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs((dy * px - dx * py + x2 * y1 - y2 * x1) / len);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const l = dpSimplify(pts.slice(0, idx + 1), eps);
    const r = dpSimplify(pts.slice(idx), eps);
    return [...l.slice(0, -1), ...r];
  }
  return [pts[0], pts[pts.length - 1]];
}

// Round all coords in a MultiLineString geometry, then simplify
function roundMultiLineString(geom) {
  // round5 first (≈1.1m grid), then Douglas-Peucker at 0.0001° (≈11m) to hit < 2 MB
  return {
    type: "MultiLineString",
    coordinates: geom.coordinates.map((line) =>
      dpSimplify(line.map(([x, y]) => [round5(x), round5(y)]), 0.0001)
    ),
  };
}

// Round all coords in any geometry (Polygon, MultiPolygon, LineString,
// MultiLineString, Point — whatever comes back from bike routes)
function roundGeom(geom) {
  if (!geom) return geom;
  if (geom.type === "Point") {
    return { type: "Point", coordinates: [round5(geom.coordinates[0]), round5(geom.coordinates[1])] };
  }
  if (geom.type === "LineString") {
    return { type: "LineString", coordinates: geom.coordinates.map(([x, y]) => [round5(x), round5(y)]) };
  }
  if (geom.type === "MultiLineString") {
    return roundMultiLineString(geom);
  }
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates.map((ring) => ring.map(([x, y]) => [round5(x), round5(y)])) };
  }
  if (geom.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geom.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [round5(x), round5(y)]))) };
  }
  return geom;
}

// ── 1. Subway lines ────────────────────────────────────────────────────────────

async function buildSubwayLines() {
  const raw = await loadOrFetch(
    RAW_SUBWAY_LINES,
    () => fetchJson("https://data.ny.gov/resource/s692-irgq.json?$limit=100"),
    "subway lines",
  );

  const features = raw.map((row) => {
    assert.ok(row.geometry, "subway line row missing geometry");
    assert.equal(row.geometry.type, "MultiLineString", `unexpected geometry type: ${row.geometry.type}`);
    return {
      type: "Feature",
      properties: { service: row.service, service_name: row.service_name },
      geometry: roundMultiLineString(row.geometry),
    };
  });

  assert.equal(features.length, 29, `expected 29 subway line features, got ${features.length}`);
  for (const f of features) {
    assert.ok(f.properties.service, "subway line missing service");
    assert.ok(f.geometry, "subway line missing geometry");
    assert.equal(f.geometry.type, "MultiLineString");
  }

  const out = JSON.stringify({ type: "FeatureCollection", features });
  fs.writeFileSync(OUT_SUBWAY_LINES, out);
  const size = Buffer.byteLength(out);
  assert.ok(size < 2_000_000, `subway_lines.geojson too large: ${size} bytes`);
  console.log(`wrote ${OUT_SUBWAY_LINES} (${features.length} features, ${size} bytes)`);
}

// ── 2. Subway stations ─────────────────────────────────────────────────────────

async function buildSubwayStations() {
  const raw = await loadOrFetch(
    RAW_SUBWAY_STATIONS,
    () => fetchJson("https://data.ny.gov/resource/39hk-dx4f.json?$limit=1000"),
    "subway stations",
  );

  const stations = [];
  for (const row of raw) {
    const lat = parseFloat(row.gtfs_latitude);
    const lng = parseFloat(row.gtfs_longitude);
    if (isNaN(lat) || isNaN(lng)) continue;
    if (lng < NYC_BBOX[0] || lng > NYC_BBOX[2] || lat < NYC_BBOX[1] || lat > NYC_BBOX[3]) continue;
    const ada = parseInt(row.ada ?? "0", 10);
    stations.push({
      id:     row.gtfs_stop_id,
      name:   row.stop_name,
      lat,
      lng,
      routes: row.daytime_routes ?? "",
      ada,
    });
  }

  assert.ok(stations.length >= 450, `expected >= 450 stations, got ${stations.length}`);
  for (const s of stations) {
    assert.ok(s.id,   "station missing id");
    assert.ok(s.name, "station missing name");
    assert.ok(!isNaN(s.lat) && !isNaN(s.lng), `station ${s.id} has NaN coords`);
    assert.ok([0, 1, 2].includes(s.ada), `station ${s.id} has invalid ada: ${s.ada}`);
  }

  const out = JSON.stringify(stations);
  fs.writeFileSync(OUT_SUBWAY_STATIONS, out);
  console.log(`wrote ${OUT_SUBWAY_STATIONS} (${stations.length} stations, ${Buffer.byteLength(out)} bytes)`);
}

// ── 3. Bike routes ─────────────────────────────────────────────────────────────

const BIKE_PROTECTED = ["Protected", "Greenway", "Boardwalk", "Curbside Protected"];
const BIKE_LANE      = ["Conventional", "Buffered"];

function classifyBike(row) {
  const candidates = [row.tf_facilit, row.ft_facilit, row.facilitycl];
  for (const val of candidates) {
    if (!val) continue;
    if (BIKE_PROTECTED.some((k) => val.includes(k))) return "p";
    if (BIKE_LANE.some((k) => val.includes(k))) return "l";
    return "s";
  }
  return "s";
}

async function buildBikeRoutes() {
  const raw = await loadOrFetch(
    RAW_BIKE_ROUTES,
    async () => {
      const baseUrl = "https://data.cityofnewyork.us/resource/mzxg-pwib.json";
      const selectFields = "$select=the_geom,tf_facilit,ft_facilit,facilitycl";
      const whereClause  = "&$where=status='Current'";
      const limitParam   = "&$limit=1000";
      const all = [];
      let offset = 0;
      while (all.length < 50000) {
        const url = `${baseUrl}?${selectFields}${whereClause}${limitParam}&$offset=${offset}`;
        console.log(`  fetching bike routes page offset=${offset}…`);
        const page = await fetchJson(url);
        all.push(...page);
        if (page.length < 1000) break;
        offset += 1000;
      }
      return all;
    },
    "bike routes",
  );

  const features = raw
    .filter((row) => row.the_geom)
    .map((row) => ({
      type: "Feature",
      properties: { c: classifyBike(row) },
      geometry: roundGeom(row.the_geom),
    }));

  assert.ok(features.length > 20000, `expected > 20000 bike route features, got ${features.length}`);
  const validC = new Set(["p", "l", "s"]);
  for (const f of features) {
    assert.ok(validC.has(f.properties.c), `invalid bike class: ${f.properties.c}`);
  }

  const out = JSON.stringify({ type: "FeatureCollection", features });
  fs.writeFileSync(OUT_BIKE_ROUTES, out);
  const size = Buffer.byteLength(out);
  if (size > 5_000_000) {
    console.warn(`WARNING: bike_routes.geojson is ${size} bytes (> 5 MB) — lazy loading handles this`);
  }
  console.log(`wrote ${OUT_BIKE_ROUTES} (${features.length} features, ${size} bytes)`);
}

// ── 4. Citi Bike stations ──────────────────────────────────────────────────────

async function buildCitiBikeStations() {
  const boroughsGeoJSON = JSON.parse(fs.readFileSync(BOROUGHS_FILE, "utf8"));
  const boroughFeatures = boroughsGeoJSON.features;

  let fetchedAt;
  const raw = await loadOrFetch(
    RAW_CITIBIKE,
    async () => {
      fetchedAt = new Date().toISOString();
      const json = await fetchJson("https://gbfs.citibikenyc.com/gbfs/en/station_information.json");
      // store fetched_at alongside stations so cache preserves it
      return { fetched_at: fetchedAt, stations: json.data.stations };
    },
    "Citi Bike stations",
  );

  const allStations = raw.stations;
  fetchedAt = fetchedAt ?? raw.fetched_at ?? new Date().toISOString();

  const stations = allStations.filter((s) => {
    if (!s.capacity || s.capacity <= 0) return false;
    const lng = s.lon;
    const lat = s.lat;
    return boroughFeatures.some((bf) => inGeometry(lng, lat, bf.geometry));
  }).map((s) => ({
    name:     s.name,
    lat:      round5(s.lat),
    lng:      round5(s.lon),
    capacity: s.capacity,
  }));

  assert.ok(stations.length > 1500, `expected > 1500 Citi Bike stations, got ${stations.length}`);
  for (const s of stations) {
    assert.ok(s.name,          "citibike station missing name");
    assert.ok(s.lat != null,   "citibike station missing lat");
    assert.ok(s.lng != null,   "citibike station missing lng");
    assert.ok(s.capacity > 0,  "citibike station has zero capacity");
  }

  const result = { fetched_at: fetchedAt, stations };
  const out = JSON.stringify(result);
  fs.writeFileSync(OUT_CITIBIKE, out);
  console.log(`wrote ${OUT_CITIBIKE} (${stations.length} stations, ${Buffer.byteLength(out)} bytes)`);
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== build_transit.mjs ===");
  await buildSubwayLines();
  await buildSubwayStations();
  await buildBikeRoutes();
  await buildCitiBikeStations();
  console.log("=== done ===");
}

main().catch((e) => { console.error(e); process.exit(1); });

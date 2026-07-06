import { describe, expect, test } from "vitest";
import { haversineMeters, nearestStation } from "@/lib/geo/transit";

describe("haversineMeters", () => {
  test("same point → 0", () => {
    const distance = haversineMeters(40.7554, -73.9870, 40.7554, -73.9870);
    expect(distance).toBeCloseTo(0, 5);
  });

  test("symmetry: (a,b,c,d) === (c,d,a,b) within float epsilon", () => {
    const d1 = haversineMeters(40.7554, -73.9870, 40.7527, -73.9772);
    const d2 = haversineMeters(40.7527, -73.9772, 40.7554, -73.9870);
    expect(d1).toBeCloseTo(d2, 5);
  });

  test("Times Square to Grand Central within 5% of 870 m", () => {
    const distance = haversineMeters(40.7554, -73.9870, 40.7527, -73.9772);
    const expected = 870;
    const tolerance = expected * 0.05;
    expect(distance).toBeGreaterThan(expected - tolerance);
    expect(distance).toBeLessThan(expected + tolerance);
  });
});

describe("nearestStation", () => {
  test("empty array → null", () => {
    const result = nearestStation(40.7554, -73.9870, []);
    expect(result).toBeNull();
  });

  test("single station → returns that station with correct distance", () => {
    const station = { lat: 40.7554, lng: -73.9870 };
    const result = nearestStation(40.7554, -73.9870, [station]);
    expect(result).not.toBeNull();
    expect(result!.station).toBe(station);
    expect(result!.distanceM).toBeCloseTo(0, 5);
  });

  test("three stations at varying distances → returns closest", () => {
    const stations = [
      { id: 1, lat: 40.7554, lng: -73.9870 },
      { id: 2, lat: 40.7527, lng: -73.9772 },
      { id: 3, lat: 40.7480, lng: -73.9862 },
    ];
    const result = nearestStation(40.7554, -73.9870, stations);
    expect(result).not.toBeNull();
    expect(result!.station.id).toBe(1);
  });

  test("result station is the exact same reference from input array", () => {
    const station1 = { id: 1, lat: 40.7554, lng: -73.9870 };
    const station2 = { id: 2, lat: 40.7527, lng: -73.9772 };
    const stations = [station1, station2];
    const result = nearestStation(40.7527, -73.9772, stations);
    expect(result).not.toBeNull();
    expect(result!.station).toBe(station2);
  });
});

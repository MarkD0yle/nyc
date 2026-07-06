const EARTH_RADIUS_METERS = 6371008.8;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export interface StationLike {
  lat: number;
  lng: number;
  [key: string]: unknown;
}

export function nearestStation<T extends StationLike>(
  lat: number,
  lng: number,
  stations: T[],
): { station: T; distanceM: number } | null {
  if (stations.length === 0) return null;

  let minDistance = Infinity;
  let nearest: T | null = null;

  for (const station of stations) {
    const distance = haversineMeters(lat, lng, station.lat, station.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = station;
    }
  }

  return nearest === null ? null : { station: nearest, distanceM: minDistance };
}

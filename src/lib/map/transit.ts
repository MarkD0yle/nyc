export type RGB = [number, number, number];

export interface SubwayStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  routes: string; // e.g. "N W"
  ada: number; // 0=none, 1=full, 2=partial
}

export interface CitiBikeStation {
  name: string;
  lat: number;
  lng: number;
  capacity: number;
}

// { fetched_at: string; stations: CitiBikeStation[] }
export interface CitiBikeData {
  fetched_at: string;
  stations: CitiBikeStation[];
}

export type TransitLayerKey = "subwayLines" | "subwayStations" | "bikeRoutes" | "citibike";

export const TRANSIT_LAYERS: { key: TransitLayerKey; label: string }[] = [
  { key: "subwayLines", label: "Subway lines" },
  { key: "subwayStations", label: "Subway stations" },
  { key: "bikeRoutes", label: "Bike routes" },
  { key: "citibike", label: "Citi Bike" },
];

export function routeColor(service: string): RGB {
  const normalized = service.trim().split(" ")[0];
  const key = ["SF", "SR", "ST"].includes(normalized) ? "shuttle" : normalized;

  switch (key) {
    case "1":
    case "2":
    case "3":
      return [238, 53, 46];
    case "4":
    case "5":
    case "6":
      return [0, 147, 60];
    case "7":
      return [185, 51, 173];
    case "A":
    case "C":
    case "E":
      return [0, 57, 166];
    case "B":
    case "D":
    case "F":
    case "M":
      return [255, 99, 25];
    case "G":
      return [108, 190, 69];
    case "J":
    case "Z":
      return [153, 102, 51];
    case "L":
      return [167, 169, 172];
    case "N":
    case "Q":
    case "R":
    case "W":
      return [252, 204, 10];
    case "SIR":
      return [0, 57, 166];
    default:
      return [128, 129, 131];
  }
}

export const BIKE_CLASS_COLOR: Record<"p" | "l" | "s", RGB> = {
  p: [60, 145, 90],
  l: [52, 116, 82],
  s: [60, 86, 72],
};

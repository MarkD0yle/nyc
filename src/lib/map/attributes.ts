import type { GeoPersona } from "@/lib/map/persona";

export type RGB = [number, number, number];
export type AttrKind = "categorical" | "ordinal";

export interface AttrDef {
  key: string;
  label: string;
  kind: AttrKind;
  values: string[];
  accessor: (p: GeoPersona) => string;
  color: (value: string) => RGB;
}

export const FADED_RGBA: [number, number, number, number] = [130, 130, 140, 55];

// Neutral gray used for "Unknown"/non-ramp ordinal values, rendered outside the ramp.
const NEUTRAL_RGB: RGB = [120, 120, 130];

// Okabe–Ito colorblind-safe categorical palette (+ neutral fallback).
const CATEGORICAL: RGB[] = [
  [230, 159, 0], [86, 180, 233], [0, 158, 115], [240, 228, 66],
  [0, 114, 178], [213, 94, 0], [204, 121, 167], [120, 120, 120],
];

// Sequential ramp (blue → magenta → yellow), interpolated for ordinal scales.
const RAMP: RGB[] = [
  [13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function rampColor(t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

function categorical(key: string, label: string, values: string[], accessor: (p: GeoPersona) => string): AttrDef {
  const index = new Map(values.map((v, i) => [v, i]));
  return {
    key, label, kind: "categorical", values, accessor,
    color: (v) => CATEGORICAL[(index.get(v) ?? values.length) % CATEGORICAL.length],
  };
}

function ordinal(
  key: string,
  label: string,
  values: string[],
  accessor: (p: GeoPersona) => string,
  neutralValues: string[] = [],
): AttrDef {
  const neutral = new Set(neutralValues);
  const rampValues = values.filter((v) => !neutral.has(v));
  const index = new Map(rampValues.map((v, i) => [v, i]));
  const n = Math.max(1, rampValues.length - 1);
  return {
    key, label, kind: "ordinal", values, accessor,
    color: (v) => (neutral.has(v) ? NEUTRAL_RGB : rampColor((index.get(v) ?? 0) / n)),
  };
}

export function incomeBand(hh: number | null): string {
  if (hh === null || hh === undefined || Number.isNaN(hh)) return "Unknown";
  if (hh < 30000) return "<$30k";
  if (hh < 60000) return "$30–60k";
  if (hh < 100000) return "$60–100k";
  if (hh < 150000) return "$100–150k";
  return "$150k+";
}

export function ageBand(age: number): string {
  if (age < 18) return "<18";
  if (age < 30) return "18–29";
  if (age < 45) return "30–44";
  if (age < 65) return "45–64";
  return "65+";
}

export function subwayDistanceBand(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return "Unknown";
  if (m < 400) return "<400m";
  if (m < 800) return "400–800m";
  if (m < 1600) return "800–1600m";
  return ">1600m";
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function languageAttr(personas: GeoPersona[]): AttrDef {
  const counts = new Map<string, number>();
  for (const p of personas) counts.set(p.language_at_home, (counts.get(p.language_at_home) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 7)
    .map(([v]) => v);
  const keep = new Set(top);
  const values = keep.size < counts.size ? [...top, "Other"] : top;
  return categorical("language_at_home", "Language at home", values, (p) =>
    keep.has(p.language_at_home) ? p.language_at_home : "Other",
  );
}

export function buildAttributes(personas: GeoPersona[]): AttrDef[] {
  return [
    categorical("borough", "Borough", distinct(personas.map((p) => p.borough)).sort(), (p) => p.borough),
    categorical("race_ethnicity", "Race / ethnicity", distinct(personas.map((p) => p.race_ethnicity)).sort(), (p) => p.race_ethnicity),
    categorical("housing", "Housing", distinct(personas.map((p) => p.housing)).sort(), (p) => p.housing),
    ordinal("income_band", "Household income", ["<$30k", "$30–60k", "$60–100k", "$100–150k", "$150k+", "Unknown"], (p) => incomeBand(p.household_income), ["Unknown"]),
    languageAttr(personas),
    ordinal("age_band", "Age", ["<18", "18–29", "30–44", "45–64", "65+"], (p) => ageBand(p.age)),
    ordinal(
      "subway_distance",
      "Subway access",
      ["<400m", "400–800m", "800–1600m", ">1600m", "Unknown"],
      (p) => subwayDistanceBand(p.subway_distance_m),
      ["Unknown"],
    ),
    categorical(
      "ada_nearby",
      "Nearest station ADA",
      ["ADA accessible", "Not accessible", "Unknown"],
      (p) => p.ada_nearby == null ? "Unknown" : p.ada_nearby ? "ADA accessible" : "Not accessible",
    ),
  ];
}

export function filterPredicate(attr: AttrDef, values: string[]): (p: GeoPersona) => boolean {
  if (values.length === 0) return () => true;
  const set = new Set(values);
  return (p) => set.has(attr.accessor(p));
}

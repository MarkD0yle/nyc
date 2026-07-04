import { describe, expect, test } from "vitest";
import type { GeoPersona } from "@/lib/map/persona";
import {
  ageBand,
  buildAttributes,
  filterPredicate,
  incomeBand,
} from "@/lib/map/attributes";

function persona(over: Partial<GeoPersona>): GeoPersona {
  return {
    id: 1, lng: -73.9, lat: 40.7, puma: "04110", borough: "Manhattan",
    neighborhood: "Harlem", age: 40, sex: "male", race_ethnicity: "Hispanic or Latino",
    education: "Bachelor's degree", employment: "Employed", personal_income: 20000,
    household_income: 45000, household_size: 2, housing: "renter", gross_rent: 1200,
    language_at_home: "English only", commute: "Bus", context_notes: "",
    ...over,
  };
}

describe("incomeBand", () => {
  test.each([
    [null, "Unknown"],
    [0, "<$30k"],
    [29999, "<$30k"],
    [30000, "$30–60k"],
    [59999, "$30–60k"],
    [60000, "$60–100k"],
    [100000, "$100–150k"],
    [150000, "$150k+"],
    [500000, "$150k+"],
  ])("hh %s → %s", (hh, band) => {
    expect(incomeBand(hh as number | null)).toBe(band);
  });
});

describe("ageBand", () => {
  test.each([
    [10, "<18"], [18, "18–29"], [29, "18–29"], [30, "30–44"],
    [44, "30–44"], [45, "45–64"], [64, "45–64"], [65, "65+"], [90, "65+"],
  ])("age %s → %s", (age, band) => {
    expect(ageBand(age as number)).toBe(band);
  });
});

describe("buildAttributes", () => {
  const people = [
    ...Array.from({ length: 3 }, (_, i) => persona({ id: i, language_at_home: "Spanish" })),
    persona({ id: 10, language_at_home: "Korean" }),
    persona({ id: 11, language_at_home: "Yiddish" }),
  ];
  const attrs = buildAttributes(people);
  const byKey = (k: string) => attrs.find((a) => a.key === k)!;

  test("exposes the six required attributes in order", () => {
    expect(attrs.map((a) => a.key)).toEqual([
      "borough", "race_ethnicity", "housing", "income_band",
      "language_at_home", "age_band",
    ]);
  });

  test("borough accessor + colorblind-safe RGB triple", () => {
    const b = byKey("borough");
    expect(b.accessor(persona({ borough: "Queens" }))).toBe("Queens");
    const c = b.color("Queens");
    expect(c).toHaveLength(3);
    for (const ch of c) expect(ch).toBeGreaterThanOrEqual(0), expect(ch).toBeLessThanOrEqual(255);
  });

  test("income_band ordinal values are low→high ordered", () => {
    expect(byKey("income_band").values).toEqual([
      "<$30k", "$30–60k", "$60–100k", "$100–150k", "$150k+", "Unknown",
    ]);
  });

  test("language keeps common values, folds rare ones into 'Other'", () => {
    const lang = byKey("language_at_home");
    // With top-N cap, a value present once among few can still be kept;
    // force folding by making the cap bite:
    const many = Array.from({ length: 20 }, (_, i) =>
      persona({ id: i, language_at_home: `Lang${i}` }),
    );
    const attr = buildAttributes(many).find((a) => a.key === "language_at_home")!;
    expect(attr.values).toContain("Other");
    expect(attr.values.length).toBeLessThanOrEqual(8); // top 7 + Other
    // a language outside the kept set maps to "Other"
    const rare = attr.values.includes("Lang19") ? "LangZZZ" : "Lang19";
    expect(attr.accessor(persona({ language_at_home: rare }))).toBe("Other");
  });

  test("'Other' gets a color distinct from the most common language", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      persona({ id: i, language_at_home: `Lang${i}` }),
    );
    const attr = buildAttributes(many).find((a) => a.key === "language_at_home")!;
    expect(attr.values).toContain("Other");
    expect(attr.values.length).toBeLessThanOrEqual(8);
    expect(attr.color("Other")).not.toEqual(attr.color(attr.values[0]));
  });

  test("color is stable for a repeated value", () => {
    const b = byKey("borough");
    expect(b.color("Queens")).toEqual(b.color("Queens"));
  });

  test("income_band 'Unknown' renders neutral gray, distinct from every real band", () => {
    const income = byKey("income_band");
    const unknownColor = income.color("Unknown");
    const realBands = ["<$30k", "$30–60k", "$60–100k", "$100–150k", "$150k+"];
    for (const band of realBands) {
      expect(unknownColor).not.toEqual(income.color(band));
    }
  });

  test("income_band '$150k+' is the ramp's bright terminus color (not orange)", () => {
    const income = byKey("income_band");
    // The ramp's terminus (t=1) is the brightest stop, [240, 249, 33] (yellow),
    // not the mid-ramp orange that "Unknown" occupying the last slot would produce.
    expect(income.color("$150k+")).toEqual([240, 249, 33]);
    expect(income.color("<$30k")).not.toEqual(income.color("$150k+"));
  });
});

describe("filterPredicate", () => {
  const attrs = buildAttributes([persona({})]);
  const housing = attrs.find((a) => a.key === "housing")!;

  test("empty values ⇒ everything passes", () => {
    const pred = filterPredicate(housing, []);
    expect(pred(persona({ housing: "owner" }))).toBe(true);
    expect(pred(persona({ housing: "renter" }))).toBe(true);
  });

  test("non-empty values ⇒ only matches pass", () => {
    const pred = filterPredicate(housing, ["renter"]);
    expect(pred(persona({ housing: "renter" }))).toBe(true);
    expect(pred(persona({ housing: "owner" }))).toBe(false);
  });
});

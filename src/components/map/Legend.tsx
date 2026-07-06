"use client";

import type { AttrDef, RGB } from "@/lib/map/attributes";
import { BIKE_CLASS_COLOR } from "@/lib/map/transit";
import type { TransitLayerKey } from "@/lib/map/transit";

// Ordinal values whose color is a fixed neutral gray rather than a ramp
// position (e.g. income_band's "Unknown"). Rendered as a separate swatch
// beneath the gradient, not as part of the ramp continuum.
const NEUTRAL_ORDINAL_VALUES = new Set(["Unknown"]);

const BIKE_CLASS_LABELS: { key: "p" | "l" | "s"; label: string }[] = [
  { key: "p", label: "Protected lane" },
  { key: "l", label: "Lanes (marked)" },
  { key: "s", label: "Shared route" },
];

export function Legend({
  attr,
  transitOn,
}: {
  attr: AttrDef;
  transitOn?: Record<TransitLayerKey, boolean>;
}) {
  if (attr.kind === "ordinal") {
    const rampValues = attr.values.filter((v) => !NEUTRAL_ORDINAL_VALUES.has(v));
    const neutralValues = attr.values.filter((v) => NEUTRAL_ORDINAL_VALUES.has(v));
    const toRgb = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;
    const stops = rampValues.map((v) => toRgb(attr.color(v)));
    return (
      <div className="absolute bottom-4 left-4 z-40 rounded-xl border border-white/15 bg-neutral-900/70 p-3 text-neutral-100 shadow-2xl backdrop-blur-md">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          {attr.label}
        </div>
        <div
          className="h-2 w-48 rounded-full"
          style={{ background: `linear-gradient(to right, ${stops.join(",")})` }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
          <span>{rampValues[0]}</span>
          <span>{rampValues[rampValues.length - 1]}</span>
        </div>
        {neutralValues.map((v) => (
          <div key={v} className="mt-1.5 flex items-center gap-2 text-[10px] text-neutral-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: toRgb(attr.color(v)) }} />
            {v}
          </div>
        ))}
        {transitOn?.bikeRoutes && <BikeSection />}
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 z-40 max-w-xs rounded-xl border border-white/15 bg-neutral-900/70 p-3 text-neutral-100 shadow-2xl backdrop-blur-md">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {attr.label}
      </div>
      <div className="flex flex-col gap-1">
        {attr.values.map((v) => {
          const [r, g, b] = attr.color(v);
          return (
            <div key={v} className="flex items-center gap-2 text-xs text-neutral-200">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: `rgb(${r},${g},${b})` }} />
              {v}
            </div>
          );
        })}
      </div>
      {transitOn?.bikeRoutes && <BikeSection />}
    </div>
  );
}

function BikeSection() {
  return (
    <div className="border-t border-white/10 mt-2 pt-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Bike routes
      </div>
      <div className="flex flex-col gap-1">
        {BIKE_CLASS_LABELS.map(({ key, label }) => {
          const [r, g, b] = BIKE_CLASS_COLOR[key];
          return (
            <div key={key} className="flex items-center gap-2 text-xs text-neutral-200">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: `rgb(${r},${g},${b})` }} />
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

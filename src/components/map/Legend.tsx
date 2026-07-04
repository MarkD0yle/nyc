"use client";

import type { AttrDef } from "@/lib/map/attributes";

export function Legend({ attr }: { attr: AttrDef }) {
  if (attr.kind === "ordinal") {
    const stops = attr.values.map((v) => {
      const [r, g, b] = attr.color(v);
      return `rgb(${r},${g},${b})`;
    });
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
          <span>{attr.values[0]}</span>
          <span>{attr.values[attr.values.length - 1]}</span>
        </div>
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
    </div>
  );
}

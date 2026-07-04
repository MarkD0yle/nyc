"use client";

import type { AttrDef } from "@/lib/map/attributes";
import { cn } from "@/lib/utils";

interface Props {
  attrs: AttrDef[];
  colorKey: string;
  onColorKey: (k: string) => void;
  filterValues: string[];
  onFilterValues: (v: string[]) => void;
  shown: number;
  total: number;
}

export function ControlPanel({
  attrs, colorKey, onColorKey, filterValues, onFilterValues, shown, total,
}: Props) {
  const active = attrs.find((a) => a.key === colorKey)!;

  function toggle(v: string) {
    onFilterValues(
      filterValues.includes(v) ? filterValues.filter((x) => x !== v) : [...filterValues, v],
    );
  }

  return (
    <div className="absolute left-4 top-4 z-40 w-64 rounded-xl border border-white/15 bg-neutral-900/70 p-4 text-neutral-100 shadow-2xl backdrop-blur-md">
      <h1 className="text-sm font-semibold tracking-tight">NYC persona cloud</h1>
      <p className="mt-0.5 text-[11px] text-neutral-400">
        3,000 synthetic New Yorkers · illustrative positions
      </p>

      <div className="mt-4 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Color by
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attrs.map((a) => (
          <button
            key={a.key}
            onClick={() => { onColorKey(a.key); onFilterValues([]); }}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              a.key === colorKey
                ? "bg-white text-neutral-900"
                : "bg-white/10 text-neutral-200 hover:bg-white/20",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Filter
        </span>
        {filterValues.length > 0 && (
          <button
            onClick={() => onFilterValues([])}
            className="text-[11px] text-neutral-400 underline hover:text-neutral-200"
          >
            clear
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {active.values.map((v) => {
          const on = filterValues.includes(v);
          const [r, g, b] = active.color(v);
          return (
            <button
              key={v}
              onClick={() => toggle(v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-colors",
                on ? "bg-white/20 text-white" : "bg-white/5 text-neutral-300 hover:bg-white/10",
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: `rgb(${r},${g},${b})` }}
              />
              {v}
            </button>
          );
        })}
      </div>

      <div className="mt-4 text-xs text-neutral-400">
        showing <span className="font-medium text-neutral-100">{shown.toLocaleString()}</span> of{" "}
        {total.toLocaleString()}
      </div>
    </div>
  );
}

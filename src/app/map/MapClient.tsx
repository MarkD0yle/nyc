"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { buildAttributes, filterPredicate } from "@/lib/map/attributes";
import type { GeoPersona } from "@/lib/map/persona";
import { ControlPanel } from "@/components/map/ControlPanel";
import { Legend } from "@/components/map/Legend";

const PersonaMap = dynamic(() => import("@/components/map/PersonaMap"), { ssr: false });

export function MapClient() {
  const [personas, setPersonas] = useState<GeoPersona[] | null>(null);
  const [pumas, setPumas] = useState<GeoJSON.FeatureCollection | null>(null);
  const [colorKey, setColorKey] = useState("borough");
  const [filterValues, setFilterValues] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/personas.geo.json").then((r) => r.json()),
      fetch("/nyc_pumas.geojson").then((r) => r.json()),
    ]).then(([p, g]) => {
      setPersonas(p);
      setPumas(g);
      requestAnimationFrame(() => setReady(true)); // triggers fade-in
    });
  }, []);

  const attrs = useMemo(() => (personas ? buildAttributes(personas) : []), [personas]);
  const colorAttr = attrs.find((a) => a.key === colorKey) ?? attrs[0];

  const shown = useMemo(() => {
    if (!personas || !colorAttr) return 0;
    return personas.filter(filterPredicate(colorAttr, filterValues)).length;
  }, [personas, colorAttr, filterValues]);

  const loaded = personas && pumas && colorAttr;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0a0e17]">
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">
          loading 3,000 New Yorkers…
        </div>
      )}
      {loaded && (
        <div
          className="h-full w-full transition-opacity duration-700"
          style={{ opacity: ready ? 1 : 0 }}
        >
          <PersonaMap
            personas={personas}
            pumas={pumas}
            colorAttr={colorAttr}
            filterValues={filterValues}
          />
          <ControlPanel
            attrs={attrs}
            colorKey={colorAttr.key}
            onColorKey={setColorKey}
            filterValues={filterValues}
            onFilterValues={setFilterValues}
            shown={shown}
            total={personas.length}
          />
          <Legend attr={colorAttr} />
        </div>
      )}
    </main>
  );
}

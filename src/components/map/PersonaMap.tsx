"use client";

import { useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { AttrDef } from "@/lib/map/attributes";
import { FADED_RGBA, filterPredicate } from "@/lib/map/attributes";
import type { GeoPersona } from "@/lib/map/persona";

const INITIAL_VIEW_STATE = {
  longitude: -73.94,
  latitude: 40.7,
  zoom: 9.4,
  pitch: 40,
  bearing: -18,
  minZoom: 8.5,
  maxZoom: 13,
};

const BOROUGH_OUTLINE: Record<string, [number, number, number]> = {
  Manhattan: [86, 180, 233], Brooklyn: [0, 158, 115], Queens: [230, 159, 0],
  Bronx: [213, 94, 0], "Staten Island": [204, 121, 167],
};

interface Props {
  personas: GeoPersona[];
  pumas: GeoJSON.FeatureCollection;
  colorAttr: AttrDef;
  filterValues: string[];
}

interface Hover { x: number; y: number; p: GeoPersona }

export default function PersonaMap({ personas, pumas, colorAttr, filterValues }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  const pass = useMemo(
    () => filterPredicate(colorAttr, filterValues),
    [colorAttr, filterValues],
  );
  const active = useMemo(() => personas.filter(pass), [personas, pass]);

  const layers = [
    new GeoJsonLayer({
      id: "pumas",
      data: pumas,
      stroked: true,
      filled: true,
      getFillColor: [255, 255, 255, 8],
      getLineColor: (f: GeoJSON.Feature) =>
        [...(BOROUGH_OUTLINE[(f.properties?.borough as string) ?? ""] ?? [120, 120, 130]), 160] as
          [number, number, number, number],
      getLineWidth: 40,
      lineWidthMinPixels: 1,
      pickable: false,
    }),
    // faint context layer: every persona, always drawn underneath
    new ScatterplotLayer({
      id: "context",
      data: personas,
      getPosition: (p: GeoPersona) => [p.lng, p.lat],
      getFillColor: FADED_RGBA,
      getRadius: 3,
      radiusMinPixels: 1.2,
      radiusMaxPixels: 4,
      pickable: false,
    }),
    // active layer: only rows passing the filter, colored by the attribute
    new ScatterplotLayer({
      id: "active",
      data: active,
      getPosition: (p: GeoPersona) => [p.lng, p.lat],
      getFillColor: (p: GeoPersona) => {
        const [r, g, b] = colorAttr.color(colorAttr.accessor(p));
        return [r, g, b, 220];
      },
      getRadius: 4,
      radiusMinPixels: 1.6,
      radiusMaxPixels: 6,
      stroked: false,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 255],
      transitions: { getFillColor: { duration: 400 } },
      updateTriggers: { getFillColor: [colorAttr.key] },
      onHover: (info) =>
        setHover(
          info.object ? { x: info.x, y: info.y, p: info.object as GeoPersona } : null,
        ),
    }),
  ];

  return (
    <>
      <DeckGL
        views={new MapView({ repeat: false })}
        initialViewState={INITIAL_VIEW_STATE}
        controller={{ dragRotate: true }}
        layers={layers}
        style={{ background: "transparent" }}
      />
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-white/15 bg-neutral-900/95 p-3 text-xs text-neutral-100 shadow-xl backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="font-medium text-neutral-200">
            {hover.p.neighborhood} · {hover.p.borough}
          </div>
          <div className="mt-1 text-neutral-400">
            {hover.p.age} · {hover.p.race_ethnicity} · {hover.p.housing}
          </div>
          <div className="text-neutral-400">
            HH income {hover.p.household_income == null ? "—" : `$${hover.p.household_income.toLocaleString()}`} · {hover.p.language_at_home}
          </div>
          {hover.p.context_notes && (
            <div className="mt-1 italic text-neutral-500">{hover.p.context_notes}</div>
          )}
        </div>
      )}
    </>
  );
}

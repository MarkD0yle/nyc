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

// Muted, dark, low-saturation land tints — one per borough. Kept far darker than
// any dot color so the persona points always read on top; the subtle hue shift is
// just enough to tell the boroughs apart as land regions.
const LAND_FILL: Record<string, [number, number, number]> = {
  Manhattan: [30, 46, 60], Brooklyn: [28, 54, 48], Queens: [54, 50, 34],
  Bronx: [58, 42, 38], "Staten Island": [48, 42, 56],
};
const LAND_DEFAULT: [number, number, number] = [38, 46, 54];
// Neutral shoreline — the dissolved borough edge against the water background.
const COASTLINE: [number, number, number, number] = [120, 165, 190, 210];

interface Props {
  personas: GeoPersona[];
  boroughs: GeoJSON.FeatureCollection;
  colorAttr: AttrDef;
  filterValues: string[];
}

interface Hover { x: number; y: number; p: GeoPersona }

export default function PersonaMap({ personas, boroughs, colorAttr, filterValues }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  const pass = useMemo(
    () => filterPredicate(colorAttr, filterValues),
    [colorAttr, filterValues],
  );
  const active = useMemo(() => personas.filter(pass), [personas, pass]);

  const layers = [
    // land silhouette: dissolved borough polygons filled as solid land, so the
    // water background carves out the recognizable NYC coastline. A crisp neutral
    // shoreline traces each borough edge.
    new GeoJsonLayer({
      id: "boroughs",
      data: boroughs,
      stroked: true,
      filled: true,
      getFillColor: (f: GeoJSON.Feature) =>
        [...(LAND_FILL[(f.properties?.borough as string) ?? ""] ?? LAND_DEFAULT), 236] as
          [number, number, number, number],
      getLineColor: COASTLINE,
      getLineWidth: 25,
      lineWidthMinPixels: 1.2,
      lineWidthMaxPixels: 2.5,
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

// The base map: OpenFreeMap's free, keyless "Positron" style (OpenStreetMap data), recolored to feel like
// Google Maps: light land, white streets, yellow highways, blue water, green parks. Positron is used as the
// base because it's clean (no shop icons competing with the traffic-light dots).

import type { Map as MapLibreMap } from "maplibre-gl";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const COLORS = {
  land: "#f4f3ef",
  residential: "#efeeea",
  park: "#cdeccc",
  wood: "#d9eed3",
  water: "#a7d3f2",
  building: "#e6e4df",
  buildingOutline: "#d9d6d0",
  street: "#ffffff",
  streetCasing: "#dcdad5",
  arterial: "#fff2b8", // US 206 and other main roads
  arterialCasing: "#ebcf6e",
  highway: "#fcd970",
  highwayCasing: "#e3b23c",
  label: "#5f6368",
  placeLabel: "#3c4043",
};

/** Paint changes keyed by Positron layer id. Layers missing from a future style version are skipped. */
const PAINT: Record<string, Record<string, unknown>> = {
  background: { "background-color": COLORS.land },
  landuse_residential: { "fill-color": COLORS.residential },
  park: { "fill-color": COLORS.park },
  landcover_wood: { "fill-color": COLORS.wood },
  water: { "fill-color": COLORS.water },
  waterway: { "line-color": COLORS.water },
  building: { "fill-color": COLORS.building, "fill-outline-color": COLORS.buildingOutline },
  highway_path: { "line-color": "#e9e7e1" },
  highway_minor: { "line-color": COLORS.street },
  highway_major_casing: {
    "line-color": ["match", ["get", "class"], ["trunk", "primary"], COLORS.arterialCasing, COLORS.streetCasing],
  },
  highway_major_inner: {
    "line-color": ["match", ["get", "class"], ["trunk", "primary"], COLORS.arterial, COLORS.street],
  },
  highway_major_subtle: { "line-color": COLORS.streetCasing },
  highway_motorway_casing: { "line-color": COLORS.highwayCasing },
  highway_motorway_inner: { "line-color": COLORS.highway },
  highway_motorway_subtle: { "line-color": COLORS.highwayCasing },
  highway_motorway_bridge_casing: { "line-color": COLORS.highwayCasing },
  highway_motorway_bridge_inner: { "line-color": COLORS.highway },
  "highway-name-minor": { "text-color": COLORS.label },
  "highway-name-major": { "text-color": COLORS.label },
  label_village: { "text-color": COLORS.placeLabel },
  label_town: { "text-color": COLORS.placeLabel },
  label_city: { "text-color": COLORS.placeLabel },
  label_other: { "text-color": COLORS.label },
  water_name_point_label: { "text-color": "#3b6fa8" },
  water_name_line_label: { "text-color": "#3b6fa8" },
};

type SetPaint = Parameters<MapLibreMap["setPaintProperty"]>;

export function applyMapColors(map: MapLibreMap) {
  for (const [layer, paint] of Object.entries(PAINT)) {
    if (!map.getLayer(layer)) continue;
    for (const [prop, value] of Object.entries(paint)) {
      try {
        map.setPaintProperty(layer, prop as SetPaint[1], value as SetPaint[2]);
      } catch {
        // A property this layer doesn't support; keep the original look for it.
      }
    }
  }
}

// Shape of a traffic signal as the app stores it, plus the step that turns raw OSM nodes into it.

import { distanceMeters, type LatLng } from "./geo";
import { intersectionName, ownerForRoads, type OwnerType, type Road } from "./jurisdiction";

export type Signal = {
  id: string; // "osm-<first node id>", stable across re-imports
  osmNodeIds: number[];
  lat: number;
  lng: number;
  name: string;
  roads: Road[];
  ownerType: OwnerType;
  viaRef: string | null;
  municipality: string;
  county: string;
};

export type RawSignalNode = LatLng & { osmNodeId: number; roads: Road[] };

/**
 * On divided highways OSM puts one signal node on each carriageway, ~15–35 m apart.
 * A driver thinks of that as one light, so merge nodes closer than `mergeMeters`
 * into a single signal at their average position.
 */
export const MERGE_RADIUS_M = 40;

export function buildSignals(
  nodes: readonly RawSignalNode[],
  place: { municipality: string; county: string },
  mergeMeters = MERGE_RADIUS_M,
): Signal[] {
  const groups: RawSignalNode[][] = [];
  for (const node of nodes) {
    const group = groups.find((g) => g.some((n) => distanceMeters(n, node) <= mergeMeters));
    if (group) group.push(node);
    else groups.push([node]);
  }

  return groups.map((group) => {
    const roads = dedupeRoads(group.flatMap((n) => n.roads));
    const ids = group.map((n) => n.osmNodeId).sort((a, b) => a - b);
    return {
      id: `osm-${ids[0]}`,
      osmNodeIds: ids,
      lat: round6(group.reduce((s, n) => s + n.lat, 0) / group.length),
      lng: round6(group.reduce((s, n) => s + n.lng, 0) / group.length),
      name: intersectionName(roads),
      roads,
      ...ownerForRoads(roads),
      ...place,
    };
  });
}

function dedupeRoads(roads: Road[]): Road[] {
  const seen = new Set<string>();
  return roads.filter((r) => {
    const key = `${r.name ?? ""}|${r.ref ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

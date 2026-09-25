// Geometry helpers for matching a phone's GPS fix to a traffic signal.

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b, 0–360° (0 = north, 90 = east). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Default snap radius: a car stopped at the stop bar is usually 10–40 m from the signal node. */
export const DEFAULT_SNAP_RADIUS_M = 60;

/**
 * Find the closest signal to `position` within `maxMeters`.
 * Returns null when nothing is close enough, so the UI can ask the user to pick on the map.
 */
export function snapToNearest<T extends LatLng>(
  position: LatLng,
  signals: readonly T[],
  maxMeters = DEFAULT_SNAP_RADIUS_M,
): { signal: T; distance: number } | null {
  let best: { signal: T; distance: number } | null = null;
  for (const signal of signals) {
    const distance = distanceMeters(position, signal);
    if (distance <= maxMeters && (!best || distance < best.distance)) {
      best = { signal, distance };
    }
  }
  return best;
}

export type Approach = "northbound" | "eastbound" | "southbound" | "westbound";

/**
 * Which way the driver is travelling as they approach the light.
 * Prefers the phone's heading; falls back to the direction from the driver to the signal.
 */
export function approachDirection(
  position: LatLng,
  signal: LatLng,
  headingDegrees?: number | null,
): Approach {
  const heading =
    headingDegrees != null && !Number.isNaN(headingDegrees)
      ? headingDegrees
      : bearingDegrees(position, signal);
  const sector = Math.round((((heading % 360) + 360) % 360) / 90) % 4;
  return (["northbound", "eastbound", "southbound", "westbound"] as const)[sector];
}

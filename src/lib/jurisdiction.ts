// Decide who owns (and therefore fixes) a traffic signal, from the roads that meet at it.
//
// In New Jersey the rule of thumb is:
//   - any Interstate, US or NJ route at the intersection  -> NJDOT
//   - otherwise any county route (CR 5xx/6xx)             -> that county's engineering dept
//   - otherwise                                           -> the municipality
// Real-world exceptions (maintenance agreements) are handled by per-signal overrides in the DB.

export type OwnerType = "state" | "county" | "municipal";

export type Road = { name?: string | null; ref?: string | null };

const STATE_REF = /^(I|US|NJ)\s*-?\s*\d+/i; // "I 287", "US 206", "US 206 BYP", "NJ 27"
const COUNTY_REF = /^(CR|C\.R\.)\s*-?\s*\d+/i; // "CR 514", "CR 533 Bypass"

/** Classify a single OSM `ref` value (may be a ";"-separated list, e.g. "US 206;CR 514"). */
export function classifyRef(ref: string | null | undefined): OwnerType | null {
  if (!ref) return null;
  const parts = ref.split(";").map((p) => p.trim());
  if (parts.some((p) => STATE_REF.test(p))) return "state";
  if (parts.some((p) => COUNTY_REF.test(p))) return "county";
  return null;
}

const RANK: Record<OwnerType, number> = { state: 3, county: 2, municipal: 1 };

/** Pick the owner of a signal given every road that passes through it. */
export function ownerForRoads(roads: readonly Road[]): { ownerType: OwnerType; viaRef: string | null } {
  let result: { ownerType: OwnerType; viaRef: string | null } = { ownerType: "municipal", viaRef: null };
  for (const road of roads) {
    const type = classifyRef(road.ref);
    if (type && RANK[type] > RANK[result.ownerType]) {
      result = { ownerType: type, viaRef: road.ref!.split(";")[0].trim() };
    }
  }
  return result;
}

/** Human-readable intersection name, e.g. "US 206 & Amwell Road". */
export function intersectionName(roads: readonly Road[]): string {
  const labels = [...new Set(roads.map((r) => r.name || r.ref?.split(";")[0]).filter(Boolean))] as string[];
  return labels.length ? labels.slice(0, 3).join(" & ") : "Unnamed intersection";
}

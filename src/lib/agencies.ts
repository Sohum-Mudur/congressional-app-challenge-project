import type { Signal } from "./signals";
import type { Agency } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** The directory id of the agency responsible for a signal. */
export function agencyIdFor(signal: Pick<Signal, "ownerType" | "county" | "municipality">): string {
  switch (signal.ownerType) {
    case "state":
      return "njdot";
    case "county":
      return `${slug(signal.county)}-county`;
    case "municipal":
      return slug(signal.municipality);
  }
}

export function agencyFor(signal: Pick<Signal, "ownerType" | "county" | "municipality">, agencies: readonly Agency[]) {
  const id = agencyIdFor(signal);
  return agencies.find((a) => a.id === id) ?? null;
}

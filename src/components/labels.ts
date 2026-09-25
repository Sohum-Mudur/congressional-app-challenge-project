import type { OwnerType } from "@/lib/jurisdiction";

export const OWNER_LABELS: Record<OwnerType, string> = {
  state: "NJDOT (state)",
  county: "County engineering",
  municipal: "Township public works",
};

export const OWNER_COLORS: Record<OwnerType, string> = {
  state: "#2563eb", // NJDOT
  county: "#d97706", // county engineering
  municipal: "#16a34a", // township DPW
};

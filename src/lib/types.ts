import type { Approach } from "./geo";
import type { OwnerType } from "./jurisdiction";

export type IssueType = "stuck_red" | "dark" | "flashing" | "ped_button" | "other";

export const ISSUE_LABELS: Record<IssueType, string> = {
  stuck_red: "Stays red with no cross traffic",
  dark: "Light is completely out",
  flashing: "Stuck flashing",
  ped_button: "Pedestrian button broken",
  other: "Something else",
};

export type SignalStatus = "ok" | "reported" | "sent" | "acknowledged" | "fixed";

export type Report = {
  id: string;
  signalId: string;
  issueType: IssueType;
  approach: Approach | null;
  waitSeconds: number | null;
  note: string | null;
  reporterId: string; // anonymous per-device id
  networkId: string | null; // salted hash of the IP address; null for reports made before it was recorded
  createdAt: string; // ISO timestamp
};

export type Agency = {
  id: string; // "njdot", "somerset-county", "hillsborough-township"
  name: string;
  type: OwnerType;
  county: string | null;
  municipality: string | null;
  email: string | null;
  formUrl: string | null;
  phone: string | null;
  sourceUrl: string;
  verified: boolean; // false until a human has confirmed the contact works
};

export type SignalState = {
  signalId: string;
  status: SignalStatus;
  changedAt: string;
};

/** Someone who asked for one email when a light is marked fixed. */
export type FixAlert = {
  id: string;
  signalId: string;
  email: string;
  reporterId: string;
  createdAt: string;
};

export type Digest = {
  id: string;
  agencyId: string;
  signalIds: string[];
  sentTo: string;
  testMode: boolean;
  sentAt: string;
};

import type { Signal } from "../signals";
import type { Agency, Digest, Report, SignalState, SignalStatus } from "../types";

/**
 * Everything the app reads and writes. Two implementations:
 *  - local.ts: a JSON file on disk, for development before Supabase is set up
 *  - supabase.ts: the real database (added once the project exists)
 */
export interface Store {
  listSignals(): Promise<Signal[]>;
  listAgencies(): Promise<Agency[]>;

  listReports(opts?: { signalId?: string; since?: Date }): Promise<Report[]>;
  addReport(report: Omit<Report, "id" | "createdAt">): Promise<Report>;

  listSignalStates(): Promise<SignalState[]>;
  setSignalStatus(signalIds: string[], status: SignalStatus): Promise<void>;

  /** Secret link token that lets an agency manage its signals without an account. */
  agencyForToken(token: string): Promise<Agency | null>;
  tokenForAgency(agencyId: string): Promise<string>;

  addDigest(digest: Omit<Digest, "id" | "sentAt">): Promise<Digest>;
  listDigests(): Promise<Digest[]>;
}

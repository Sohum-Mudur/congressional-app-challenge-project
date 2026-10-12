import type { Signal } from "../signals";
import type { Agency, Digest, FixAlert, Report, SignalState, SignalStatus } from "../types";

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

  /** "Notify me when fixed". Adding the same email twice for one light is a no-op. */
  addFixAlert(alert: Omit<FixAlert, "id" | "createdAt">): Promise<void>;
  countFixAlerts(opts: { reporterId: string; since: Date }): Promise<number>;
  /** Remove and return every alert for these signals, so each person is emailed once. */
  takeFixAlerts(signalIds: string[]): Promise<FixAlert[]>;

  addDigest(digest: Omit<Digest, "id" | "sentAt">): Promise<Digest>;
  listDigests(): Promise<Digest[]>;
}

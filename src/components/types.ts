import type { Signal } from "@/lib/signals";
import type { IssueType, SignalStatus } from "@/lib/types";

/** A signal as returned by GET /api/signals. */
export type MapSignal = Signal & {
  status: SignalStatus;
  statusChangedAt: string | null;
  recentReports: number;
  agency: { id: string; name: string; phone: string | null; formUrl: string | null } | null;
};

/** A one-tap "report later" capture, kept in localStorage until the user finishes it. */
export type PendingReport = { lat: number; lng: number; heading: number | null; at: string };

/** One of this device's own reports, as returned by GET /api/reports/mine. */
export type MyReport = { id: string; signalId: string; issueType: IssueType; createdAt: string };

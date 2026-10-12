// Turn many individual reports into one short, credible summary per agency.
// Agencies ignore floods of single complaints; they act on evidence that a problem is real and repeated.

import type { Approach } from "./geo";
import type { Signal } from "./signals";
import { ISSUE_LABELS, type Agency, type IssueType, type Report, type SignalState } from "./types";

export const DIGEST_RULE = {
  minReports: 3,
  minReporters: 2, // at least two different devices, so one person can't trigger a digest alone
  // ...and two different internet connections, so clearing cookies or using private tabs isn't enough.
  // runDigest lowers this to 1 in test mode, so one person on one Wi-Fi can try the whole flow.
  minNetworks: 2,
  windowDays: 7,
};

export type DigestRule = typeof DIGEST_RULE;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SignalSummary = {
  signal: Signal;
  reportCount: number;
  reporterCount: number;
  networkCount: number;
  firstReportAt: string;
  lastReportAt: string;
  topIssue: IssueType;
  approaches: Approach[]; // most-reported first
  medianWaitSeconds: number | null;
};

export function summarize(signal: Signal, reports: readonly Report[]): SignalSummary {
  const sorted = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    signal,
    reportCount: reports.length,
    reporterCount: new Set(reports.map((r) => r.reporterId)).size,
    // Older reports have no network recorded; count each of their devices as its own network.
    networkCount: new Set(reports.map((r) => r.networkId ?? `device:${r.reporterId}`)).size,
    firstReportAt: sorted[0]?.createdAt ?? "",
    lastReportAt: sorted.at(-1)?.createdAt ?? "",
    topIssue: mostCommon(reports.map((r) => r.issueType))[0] ?? "other",
    approaches: mostCommon(reports.map((r) => r.approach).filter((a): a is Approach => a != null)),
    medianWaitSeconds: median(reports.map((r) => r.waitSeconds).filter((w): w is number => w != null)),
  };
}

/**
 * Signals that should go in the next digest: enough recent reports from enough different people,
 * and not already sent / acknowledged (unless it was marked fixed and broke again).
 */
export function signalsDueForDigest(
  signals: readonly Signal[],
  reports: readonly Report[],
  states: readonly SignalState[],
  now: Date,
  rule: DigestRule = DIGEST_RULE,
): SignalSummary[] {
  const since = now.getTime() - rule.windowDays * DAY_MS;
  const stateById = new Map(states.map((s) => [s.signalId, s]));

  return signals.flatMap((signal) => {
    const state = stateById.get(signal.id);
    // Only count reports made after the last status change, so a "fixed" light starts fresh.
    const floor = Math.max(since, state ? Date.parse(state.changedAt) : 0);
    if (state && (state.status === "sent" || state.status === "acknowledged")) return [];

    const recent = reports.filter((r) => r.signalId === signal.id && Date.parse(r.createdAt) >= floor);
    const summary = summarize(signal, recent);
    const enough = summary.reportCount >= rule.minReports && summary.reporterCount >= rule.minReporters && summary.networkCount >= rule.minNetworks;
    return enough ? [summary] : [];
  });
}

export function groupByAgency<T extends { signal: Signal }>(
  items: readonly T[],
  agencyIdFor: (signal: Signal) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = agencyIdFor(item.signal);
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return groups;
}

export function formatWait(seconds: number | null): string {
  if (seconds == null) return "not recorded";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

/** Plain-text + HTML email for one agency. Kept short on purpose: a busy engineer should get it in 10 seconds. */
export function renderDigestEmail(agency: Agency, items: readonly SignalSummary[], links: { manageUrl: string; mapUrl: (s: Signal) => string }) {
  const n = items.length;
  const subject = `${n} traffic signal${n === 1 ? "" : "s"} reported as malfunctioning — ${agency.name}`;

  const lines = items.map((it, i) => {
    const dir = it.approaches.length ? ` (mostly ${it.approaches[0]})` : "";
    return [
      `${i + 1}. ${it.signal.name}`,
      `   Problem: ${ISSUE_LABELS[it.topIssue]}${dir}`,
      `   ${it.reportCount} reports from ${it.reporterCount} people, ${dayRange(it)}`,
      `   Typical wait: ${formatWait(it.medianWaitSeconds)}`,
      `   Map: ${links.mapUrl(it.signal)}`,
    ].join("\n");
  });

  const text = [
    `Hello ${agency.name},`,
    "",
    `Residents have reported the following traffic signal${n === 1 ? "" : "s"} under your jurisdiction as not working correctly. ` +
      `Each has at least ${DIGEST_RULE.minReports} reports from ${DIGEST_RULE.minReporters}+ different people in the last ${DIGEST_RULE.windowDays} days.`,
    "",
    ...lines.flatMap((l) => [l, ""]),
    `When a signal is repaired, you can mark it fixed here (no login needed): ${links.manageUrl}`,
    "The public map updates automatically.",
    "",
    "— Sent by a student-built community app (Congressional App Challenge project). Reply to this email with any questions.",
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
<p>Hello ${esc(agency.name)},</p>
<p>Residents have reported the following traffic signal${n === 1 ? "" : "s"} under your jurisdiction as not working correctly. Each has at least ${DIGEST_RULE.minReports} reports from ${DIGEST_RULE.minReporters}+ different people in the last ${DIGEST_RULE.windowDays} days.</p>
<ol>${items
    .map(
      (it) => `<li style="margin-bottom:12px"><strong>${esc(it.signal.name)}</strong><br/>
${esc(ISSUE_LABELS[it.topIssue])}${it.approaches.length ? ` (mostly ${it.approaches[0]})` : ""}<br/>
${it.reportCount} reports from ${it.reporterCount} people, ${dayRange(it)} · typical wait ${formatWait(it.medianWaitSeconds)}<br/>
<a href="${esc(links.mapUrl(it.signal))}">View on map</a></li>`,
    )
    .join("")}</ol>
<p><a href="${esc(links.manageUrl)}">Mark signals as fixed</a> (no login needed). The public map updates automatically.</p>
<p style="color:#666;font-size:12px">Sent by a student-built community app (Congressional App Challenge project). Reply with any questions.</p>
</div>`;

  return { subject, text, html };
}

function mostCommon<T>(values: readonly T[]): T[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "";

function dayRange(it: Pick<SignalSummary, "firstReportAt" | "lastReportAt">) {
  const [a, b] = [day(it.firstReportAt), day(it.lastReportAt)];
  return a === b ? `on ${a}` : `${a}–${b}`;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

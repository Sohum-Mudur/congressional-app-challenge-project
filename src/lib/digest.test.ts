import { describe, expect, it } from "vitest";
import { agencyIdFor } from "./agencies";
import { DIGEST_RULE, formatWait, groupByAgency, renderDigestEmail, signalsDueForDigest, summarize } from "./digest";
import type { Signal } from "./signals";
import { impactStats } from "./stats";
import type { Agency, Report } from "./types";

const base = { osmNodeIds: [1], lat: 40.5, lng: -74.64, roads: [], viaRef: null, municipality: "Hillsborough Township", county: "Somerset" };
const us206: Signal = { ...base, id: "osm-1", name: "US 206 & Amwell Road", ownerType: "state" };
const amwell: Signal = { ...base, id: "osm-2", name: "Amwell Road & Beekman Lane", ownerType: "county" };
const raider: Signal = { ...base, id: "osm-3", name: "Raider Boulevard & Homestead Road", ownerType: "municipal" };

const NOW = new Date("2026-10-10T12:00:00Z");
let n = 0;
function report(signalId: string, reporterId: string, daysAgo: number, extra: Partial<Report> = {}): Report {
  return {
    id: `r${++n}`,
    signalId,
    reporterId,
    issueType: "stuck_red",
    approach: "northbound",
    waitSeconds: 150,
    note: null,
    networkId: null,
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    ...extra,
  };
}

describe("agencyIdFor", () => {
  it("routes each owner type to its directory entry", () => {
    expect(agencyIdFor(us206)).toBe("njdot");
    expect(agencyIdFor(amwell)).toBe("somerset-county");
    expect(agencyIdFor(raider)).toBe("hillsborough-township");
  });
});

describe("signalsDueForDigest", () => {
  const signals = [us206, amwell, raider];

  it("needs 3+ recent reports from 2+ different people", () => {
    const reports = [
      // US 206: 3 reports, 2 people -> due
      report("osm-1", "alice", 1),
      report("osm-1", "bob", 2),
      report("osm-1", "alice", 3),
      // Amwell: 3 reports but all from one person -> not due
      report("osm-2", "carol", 1),
      report("osm-2", "carol", 2),
      report("osm-2", "carol", 3),
      // Raider: 3 reports, 3 people, but one is 10 days old -> not due
      report("osm-3", "a", 1),
      report("osm-3", "b", 2),
      report("osm-3", "c", 10),
    ];
    expect(signalsDueForDigest(signals, reports, [], NOW).map((s) => s.signal.id)).toEqual(["osm-1"]);
  });

  it("skips signals already sent, and ignores reports from before a 'fixed' mark", () => {
    const reports = [report("osm-1", "a", 1), report("osm-1", "b", 1), report("osm-1", "c", 1)];
    const sent = [{ signalId: "osm-1", status: "sent" as const, changedAt: NOW.toISOString() }];
    expect(signalsDueForDigest(signals, reports, sent, NOW)).toEqual([]);

    const fixedYesterday = [{ signalId: "osm-1", status: "fixed" as const, changedAt: new Date(NOW.getTime() - 0.5 * 86_400_000).toISOString() }];
    expect(signalsDueForDigest(signals, reports, fixedYesterday, NOW)).toEqual([]);
  });

  it("needs 2+ different networks, so one person clearing cookies can't trigger a digest", () => {
    const oneWifi = ["a", "b", "c"].map((who) => report("osm-1", who, 1, { networkId: "home" }));
    expect(signalsDueForDigest(signals, oneWifi, [], NOW)).toEqual([]);
    expect(signalsDueForDigest(signals, oneWifi, [], NOW, { ...DIGEST_RULE, minNetworks: 1 })).toHaveLength(1);

    const twoNetworks = [...oneWifi.slice(0, 2), report("osm-1", "d", 1, { networkId: "phone" })];
    expect(signalsDueForDigest(signals, twoNetworks, [], NOW)).toHaveLength(1);
  });
});

describe("summarize", () => {
  it("computes counts, top issue, approach and median wait", () => {
    const s = summarize(us206, [
      report("osm-1", "a", 1, { waitSeconds: 60, approach: "southbound" }),
      report("osm-1", "b", 2, { waitSeconds: 180 }),
      report("osm-1", "c", 3, { waitSeconds: 120, issueType: "dark" }),
      report("osm-1", "c", 3, { waitSeconds: null }),
    ]);
    expect(s).toMatchObject({ reportCount: 4, reporterCount: 3, topIssue: "stuck_red", approaches: ["northbound", "southbound"], medianWaitSeconds: 120 });
  });
});

describe("groupByAgency + renderDigestEmail", () => {
  it("builds one email per agency listing its signals", () => {
    const reports = ["a", "b", "c"].map((who, i) => report("osm-1", who, i + 1));
    const due = signalsDueForDigest([us206, amwell], reports, [], NOW);
    const groups = groupByAgency(due, agencyIdFor);
    expect([...groups.keys()]).toEqual(["njdot"]);

    const agency: Agency = { id: "njdot", name: "NJDOT", type: "state", county: null, municipality: null, email: "x@example.com", formUrl: null, phone: null, sourceUrl: "https://example.com", verified: false };
    const email = renderDigestEmail(agency, groups.get("njdot")!, { manageUrl: "https://app/agency/tok", mapUrl: (s) => `https://app/?signal=${s.id}` });
    expect(email.subject).toBe("1 traffic signal reported as malfunctioning — NJDOT");
    expect(email.text).toContain("US 206 & Amwell Road");
    expect(email.text).toContain("3 reports from 3 people, Oct 7–Oct 9");
    expect(email.text).toContain("Typical wait: 2m 30s");
    expect(email.html).toContain("https://app/agency/tok");
  });
});

describe("formatWait", () => {
  it.each([[null, "not recorded"], [45, "45s"], [150, "2m 30s"]])("%s -> %s", (s, out) => expect(formatWait(s)).toBe(out));
});

describe("impactStats", () => {
  it("adds up wait time and converts idle time to fuel and CO2", () => {
    const stats = impactStats([report("osm-1", "a", 1, { waitSeconds: 3600 }), report("osm-2", "b", 1, { waitSeconds: null })]);
    // 3600 + 60 (assumed) seconds = 61 min; 61/60 h * 0.25 gal/h = 0.254 gal; * 8.887 kg = 2.3 kg
    expect(stats).toEqual({ reports: 2, signals: 2, people: 2, waitMinutes: 61, gallons: 0.25, co2Kg: 2.3 });
  });
});

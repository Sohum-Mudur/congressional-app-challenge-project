// Development store: keeps reports, statuses and digests in .data/dev-db.json.
// Signals and agencies come from the committed JSON files in data/.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Signal } from "../signals";
import type { Agency, Digest, FixAlert, Report, SignalState } from "../types";
import type { Store } from "./types";

type DevDb = {
  reports: Report[];
  states: SignalState[];
  digests: Digest[];
  fixAlerts: FixAlert[];
  agencyTokens: Record<string, string>; // agencyId -> token
};

const EMPTY: DevDb = { reports: [], states: [], digests: [], fixAlerts: [], agencyTokens: {} };

export function createLocalStore(root = process.cwd()): Store {
  const dbPath = path.join(root, ".data", "dev-db.json");
  let queue = Promise.resolve(); // serialize writes so concurrent requests don't clobber the file

  async function read(): Promise<DevDb> {
    try {
      return { ...EMPTY, ...JSON.parse(await readFile(dbPath, "utf8")) };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  function update<T>(fn: (db: DevDb) => T): Promise<T> {
    const run = queue.then(async () => {
      const db = await read();
      const result = fn(db);
      await mkdir(path.dirname(dbPath), { recursive: true });
      await writeFile(dbPath, JSON.stringify(db, null, 2));
      return result;
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    async listSignals() {
      const dir = path.join(root, "data", "signals");
      const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      const lists = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as Signal[]));
      return lists.flat();
    },

    async listAgencies() {
      return JSON.parse(await readFile(path.join(root, "data", "agencies.json"), "utf8")) as Agency[];
    },

    async listReports(opts = {}) {
      const { reports } = await read();
      return reports.filter(
        (r) => (!opts.signalId || r.signalId === opts.signalId) && (!opts.since || Date.parse(r.createdAt) >= opts.since.getTime()),
      );
    },

    addReport(input) {
      return update((db) => {
        const report: Report = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
        db.reports.push(report);
        // A new report on a quiet or fixed light moves it back to "reported".
        const state = db.states.find((s) => s.signalId === input.signalId);
        if (!state) db.states.push({ signalId: input.signalId, status: "reported", changedAt: report.createdAt });
        else if (state.status === "ok" || state.status === "fixed") Object.assign(state, { status: "reported", changedAt: report.createdAt });
        return report;
      });
    },

    async listSignalStates() {
      return (await read()).states;
    },

    setSignalStatus(signalIds, status) {
      return update((db) => {
        const changedAt = new Date().toISOString();
        for (const signalId of signalIds) {
          const state = db.states.find((s) => s.signalId === signalId);
          if (state) Object.assign(state, { status, changedAt });
          else db.states.push({ signalId, status, changedAt });
        }
      });
    },

    async agencyForToken(token) {
      const { agencyTokens } = await read();
      const id = Object.entries(agencyTokens).find(([, t]) => t === token)?.[0];
      return id ? ((await this.listAgencies()).find((a) => a.id === id) ?? null) : null;
    },

    tokenForAgency(agencyId) {
      return update((db) => (db.agencyTokens[agencyId] ??= randomUUID()));
    },

    addFixAlert(input) {
      return update((db) => {
        if (db.fixAlerts.some((a) => a.signalId === input.signalId && a.email === input.email)) return;
        db.fixAlerts.push({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
      });
    },

    async countFixAlerts({ reporterId, since }) {
      return (await read()).fixAlerts.filter((a) => a.reporterId === reporterId && Date.parse(a.createdAt) >= since.getTime()).length;
    },

    takeFixAlerts(signalIds) {
      return update((db) => {
        const taken = db.fixAlerts.filter((a) => signalIds.includes(a.signalId));
        db.fixAlerts = db.fixAlerts.filter((a) => !signalIds.includes(a.signalId));
        return taken;
      });
    },

    addDigest(input) {
      return update((db) => {
        const digest: Digest = { ...input, id: randomUUID(), sentAt: new Date().toISOString() };
        db.digests.push(digest);
        return digest;
      });
    },

    async listDigests() {
      return (await read()).digests;
    },
  };
}

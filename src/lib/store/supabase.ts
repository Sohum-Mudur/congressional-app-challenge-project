// Production store: Supabase Postgres, accessed from the server with the secret key.
// Column names are snake_case in the database and camelCase in the app; the row mappers convert.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Signal } from "../signals";
import type { Agency, Digest, FixAlert, Report, SignalState, SignalStatus } from "../types";
import type { Store } from "./types";

type AgencyRow = {
  id: string;
  name: string;
  type: Agency["type"];
  county: string | null;
  municipality: string | null;
  email: string | null;
  form_url: string | null;
  phone: string | null;
  source_url: string;
  verified: boolean;
};

type SignalRow = {
  id: string;
  osm_node_ids: number[];
  lat: number;
  lng: number;
  name: string;
  roads: Signal["roads"];
  owner_type: Signal["ownerType"];
  via_ref: string | null;
  municipality: string;
  county: string;
  status: SignalStatus;
  status_changed_at: string;
};

type ReportRow = {
  id: string;
  signal_id: string;
  issue_type: Report["issueType"];
  approach: Report["approach"];
  wait_seconds: number | null;
  note: string | null;
  reporter_id: string;
  network_id: string | null;
  created_at: string;
};

type FixAlertRow = { id: string; signal_id: string; email: string; reporter_id: string; created_at: string };

type DigestRow = { id: string; agency_id: string; signal_ids: string[]; sent_to: string; test_mode: boolean; sent_at: string };

const AGENCY_COLUMNS = "id, name, type, county, municipality, email, form_url, phone, source_url, verified";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toAgency = (r: AgencyRow): Agency => ({
  id: r.id,
  name: r.name,
  type: r.type,
  county: r.county,
  municipality: r.municipality,
  email: r.email,
  formUrl: r.form_url,
  phone: r.phone,
  sourceUrl: r.source_url,
  verified: r.verified,
});

const toSignal = (r: SignalRow): Signal => ({
  id: r.id,
  osmNodeIds: r.osm_node_ids.map(Number),
  lat: r.lat,
  lng: r.lng,
  name: r.name,
  roads: r.roads,
  ownerType: r.owner_type,
  viaRef: r.via_ref,
  municipality: r.municipality,
  county: r.county,
});

const toReport = (r: ReportRow): Report => ({
  id: r.id,
  signalId: r.signal_id,
  issueType: r.issue_type,
  approach: r.approach,
  waitSeconds: r.wait_seconds,
  note: r.note,
  reporterId: r.reporter_id,
  networkId: r.network_id,
  createdAt: r.created_at,
});

const toFixAlert = (r: FixAlertRow): FixAlert => ({
  id: r.id,
  signalId: r.signal_id,
  email: r.email,
  reporterId: r.reporter_id,
  createdAt: r.created_at,
});

const toDigest = (r: DigestRow): Digest => ({
  id: r.id,
  agencyId: r.agency_id,
  signalIds: r.signal_ids,
  sentTo: r.sent_to,
  testMode: r.test_mode,
  sentAt: r.sent_at,
});

/** Throw on Supabase errors so API routes return 500 instead of silently using empty data. */
function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase: ${result.error.message}`);
  return result.data as T;
}

export function createSupabaseStore(url: string, secretKey: string): Store {
  const db: SupabaseClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async listSignals() {
      return check<SignalRow[]>(await db.from("signals").select("*").order("id")).map(toSignal);
    },

    async listAgencies() {
      return check<AgencyRow[]>(await db.from("agencies").select(AGENCY_COLUMNS)).map(toAgency);
    },

    async listReports(opts = {}) {
      let q = db.from("reports").select("*").order("created_at");
      if (opts.signalId) q = q.eq("signal_id", opts.signalId);
      if (opts.reporterId) q = q.eq("reporter_id", opts.reporterId);
      if (opts.since) q = q.gte("created_at", opts.since.toISOString());
      return check<ReportRow[]>(await q).map(toReport);
    },

    async addReport(input) {
      const row = check<ReportRow>(
        await db
          .from("reports")
          .insert({
            signal_id: input.signalId,
            issue_type: input.issueType,
            approach: input.approach,
            wait_seconds: input.waitSeconds,
            note: input.note,
            reporter_id: input.reporterId,
            network_id: input.networkId,
          })
          .select()
          .single(),
      );
      // A new report on a quiet or fixed light moves it back to "reported".
      check(
        await db
          .from("signals")
          .update({ status: "reported", status_changed_at: row.created_at })
          .eq("id", input.signalId)
          .in("status", ["ok", "fixed"]),
      );
      return toReport(row);
    },

    async deleteReport(id) {
      if (!UUID.test(id)) return;
      check(await db.from("reports").delete().eq("id", id));
    },

    async listSignalStates() {
      const rows = check<Pick<SignalRow, "id" | "status" | "status_changed_at">[]>(
        await db.from("signals").select("id, status, status_changed_at").neq("status", "ok"),
      );
      return rows.map((r): SignalState => ({ signalId: r.id, status: r.status, changedAt: r.status_changed_at }));
    },

    async setSignalStatus(signalIds, status) {
      check(await db.from("signals").update({ status, status_changed_at: new Date().toISOString() }).in("id", signalIds));
    },

    async agencyForToken(token) {
      if (!UUID.test(token)) return null; // the column is a uuid; anything else can't match
      const row = check<AgencyRow | null>(await db.from("agencies").select(AGENCY_COLUMNS).eq("manage_token", token).maybeSingle());
      return row ? toAgency(row) : null;
    },

    async tokenForAgency(agencyId) {
      return check<{ manage_token: string }>(await db.from("agencies").select("manage_token").eq("id", agencyId).single()).manage_token;
    },

    async addFixAlert(input) {
      check(
        await db
          .from("fix_alerts")
          .upsert({ signal_id: input.signalId, email: input.email, reporter_id: input.reporterId }, { onConflict: "signal_id,email", ignoreDuplicates: true }),
      );
    },

    async countFixAlerts({ reporterId, since }) {
      const { count, error } = await db
        .from("fix_alerts")
        .select("id", { count: "exact", head: true })
        .eq("reporter_id", reporterId)
        .gte("created_at", since.toISOString());
      if (error) throw new Error(`Supabase: ${error.message}`);
      return count ?? 0;
    },

    async takeFixAlerts(signalIds) {
      return check<FixAlertRow[]>(await db.from("fix_alerts").delete().in("signal_id", signalIds).select()).map(toFixAlert);
    },

    async deleteFixAlerts({ signalId, reporterId }) {
      check(await db.from("fix_alerts").delete().eq("signal_id", signalId).eq("reporter_id", reporterId));
    },

    async addDigest(input) {
      const row = check<DigestRow>(
        await db
          .from("digests")
          .insert({ agency_id: input.agencyId, signal_ids: input.signalIds, sent_to: input.sentTo, test_mode: input.testMode })
          .select()
          .single(),
      );
      return toDigest(row);
    },

    async listDigests() {
      return check<DigestRow[]>(await db.from("digests").select("*").order("sent_at")).map(toDigest);
    },
  };
}

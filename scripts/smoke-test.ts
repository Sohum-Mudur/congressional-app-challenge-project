// End-to-end check of the whole loop, run against a deployed site (or a local dev server):
//   3 reports from 3 "people" → digest email → "notify me" sign-up → agency marks fixed → fix email
// Then it deletes everything it created. Emails land in TEST_INBOX.
//
//   npm run smoke                                   # against SITE_URL from .env.local
//   SMOKE_URL=http://localhost:3000 npm run smoke   # against a local dev server
//
// Refuses to run unless the site reports TEST_MODE is on, so no real agency is ever emailed.

import postgres from "postgres";

const BASE = (process.env.SMOKE_URL ?? process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const { CRON_SECRET, DATABASE_URL, TEST_INBOX } = process.env;
if (!CRON_SECRET || !DATABASE_URL || !TEST_INBOX) throw new Error("CRON_SECRET, DATABASE_URL and TEST_INBOX must be set in .env.local");

const NOTE = "automated smoke test - safe to delete";
const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const startedAt = new Date();
let signalId: string | null = null;

function step(msg: string) {
  console.log(`✓ ${msg}`);
}
function expect(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(`FAILED: ${msg}`);
}

/** Each "person" is a separate cookie jar, like a separate phone. */
class Person {
  cookie = "";
  async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cookie && { cookie: this.cookie }), ...headers },
      body: JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie")?.match(/reporter_id=[^;]+/);
    if (set) this.cookie = set[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);
  const auth = { authorization: `Bearer ${CRON_SECRET}` };

  const check = await fetch(`${BASE}/api/digest?check=1`, { headers: auth }).then((r) => r.json());
  expect(check.testMode === true, `the site must be in test mode (got ${JSON.stringify(check)})`);
  step("site is in test mode");

  // Real lights close to the digest threshold would get swept into the test digest, so wait until they're handled.
  const busy = await sql`select signal_id from reports where created_at > now() - interval '7 days' group by signal_id having count(*) >= 3`;
  expect(busy.length === 0, `real lights have 3+ reports this week (${busy.map((b) => b.signal_id).join(", ")}); run this later so the digest only contains test data`);

  const signals: { id: string; name: string; ownerType: string; status: string }[] = await fetch(`${BASE}/api/signals`).then((r) => r.json());
  const signal = signals.find((s) => s.ownerType === "municipal" && s.status === "ok");
  expect(signal, "a township light with no reports");
  signalId = signal.id;
  step(`using ${signal.name} (${signal.id})`);

  const people = [new Person(), new Person(), new Person()];
  for (const [i, p] of people.entries()) {
    const r = await p.post("/api/reports", { signalId, issueType: "stuck_red", approach: "eastbound", waitSeconds: 150, note: NOTE });
    expect(r.status === 201, `report ${i + 1} returned ${r.status} ${JSON.stringify(r.body)}`);
  }
  step("3 reports from 3 different devices");

  const stranger = await new Person().post("/api/fix-alerts", { signalId, email: TEST_INBOX });
  expect(stranger.status === 403, `someone who didn't report must not sign up for alerts (got ${stranger.status})`);
  const alert = await people[0].post("/api/fix-alerts", { signalId, email: TEST_INBOX });
  expect(alert.status === 201, `fix alert sign-up returned ${alert.status} ${JSON.stringify(alert.body)}`);
  step("reporter signed up for a fix alert (and a non-reporter was refused)");

  const digest = await new Person().post("/api/digest", {}, auth);
  const result = digest.body.results?.find((r: { agencyId: string }) => r.agencyId === "hillsborough-township");
  expect(digest.body.testMode === true && result?.delivered, `digest should email the test inbox: ${JSON.stringify(digest.body)}`);
  step("digest emailed to the test inbox");

  const [{ manage_token }] = await sql`select manage_token from agencies where id = 'hillsborough-township'`;
  const fixed = await new Person().post(`/api/agency/${manage_token}`, { signalId, status: "fixed" });
  expect(fixed.status === 200 && fixed.body.notified === 1, `marking fixed should email 1 person: ${JSON.stringify(fixed.body)}`);
  step("agency marked it fixed and the reporter was emailed");

  const [left] = await sql`select count(*)::int as n from fix_alerts where signal_id = ${signalId}`;
  expect(left.n === 0, "the email address should be deleted after the alert is sent");
  const after: { id: string; status: string }[] = await fetch(`${BASE}/api/signals`, { cache: "no-store" }).then((r) => r.json());
  expect(after.find((s) => s.id === signalId)?.status === "fixed", "the public map should show the light as fixed");
  step("email address deleted, public map shows it fixed");

  console.log(`\nAll good. Check ${TEST_INBOX} for 2 emails (the digest, then the "Fixed" alert).`);
}

async function cleanup() {
  if (!signalId) return;
  await sql.begin(async (tx) => {
    await tx`delete from reports where note = ${NOTE}`;
    await tx`delete from fix_alerts where signal_id = ${signalId}`;
    await tx`delete from digests where test_mode and sent_at >= ${startedAt}`;
    await tx`update signals set status = 'ok', status_changed_at = now() where id = ${signalId}`;
  });
  console.log("(test data removed)");
}

main()
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => cleanup().finally(() => sql.end()));

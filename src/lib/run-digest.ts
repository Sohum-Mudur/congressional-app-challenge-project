import "server-only";
import { agencyIdFor } from "./agencies";
import { config, isLive } from "./config";
import { DIGEST_RULE, esc, groupByAgency, renderDigestEmail, signalsDueForDigest } from "./digest";
import { sendEmail } from "./email";
import { getStore } from "./store";

export type DigestResult = { agencyId: string; live: boolean; signals: number; sentTo: string | null; delivered: boolean; skipped?: string };

/** Find every signal that crossed the report threshold and send one email per responsible agency. */
export async function runDigest(now = new Date()): Promise<DigestResult[]> {
  const store = getStore();
  const [signals, reports, states, agencies] = await Promise.all([
    store.listSignals(),
    store.listReports({ since: new Date(now.getTime() - 30 * 86_400_000) }),
    store.listSignalStates(),
    store.listAgencies(),
  ]);

  const rule = config.testMode ? { ...DIGEST_RULE, minNetworks: 1 } : DIGEST_RULE;
  const due = signalsDueForDigest(signals, reports, states, now, rule);
  const results: DigestResult[] = [];

  for (const [agencyId, allItems] of groupByAgency(due, agencyIdFor)) {
    const live = isLive(agencyId);
    // Test mode relaxes the "2+ networks" rule so one person can try the flow; a live agency always gets the full rule.
    const items = live ? allItems.filter((it) => it.networkCount >= DIGEST_RULE.minNetworks) : allItems;
    if (!items.length) continue;
    const agency = agencies.find((a) => a.id === agencyId);
    if (!agency) {
      results.push({ agencyId, live, signals: items.length, sentTo: null, delivered: false, skipped: "agency not in directory" });
      continue;
    }

    // Where it goes: the test inbox unless this agency is live; then the agency, or our admin for form-only agencies.
    const realTo = agency.email ?? config.adminEmail;
    const to = live ? realTo : config.testInbox;
    if (!to) {
      results.push({ agencyId, live, signals: items.length, sentTo: null, delivered: false, skipped: "no recipient configured" });
      continue;
    }

    const token = await store.tokenForAgency(agency.id);
    const email = renderDigestEmail(agency, items, {
      manageUrl: `${config.siteUrl}/agency/${token}`,
      mapUrl: (s) => `${config.siteUrl}/?signal=${s.id}`,
    });

    let { subject, text, html } = email;
    if (!agency.email) {
      // Form-only agency: this copy goes to our admin, who submits it through the agency's own form.
      const how = agency.formUrl ?? agency.phone ?? "their official channel";
      subject = `[Submit via form] ${subject}`;
      text = `${agency.name} only accepts reports via ${how}. Please submit the signals below there.\n\n${text}`;
      html = `<p style="background:#fef3c7;padding:8px;border-radius:6px"><strong>Action needed:</strong> ${esc(agency.name)} only accepts reports via ${esc(how)}. Please submit the signals below there.</p>${html}`;
    }
    if (!live) subject = `[TEST → would go to ${realTo ?? "nobody"}] ${subject}`;

    let delivered: boolean;
    try {
      ({ delivered } = await sendEmail({ to, subject, text, html }));
    } catch (err) {
      // Nothing is recorded, so these lights are still due and tomorrow's run tries again.
      console.error(`Digest for ${agencyId} failed:`, (err as Error).message);
      results.push({ agencyId, live, signals: items.length, sentTo: to, delivered: false, skipped: `send failed: ${(err as Error).message}` });
      continue;
    }
    const signalIds = items.map((i) => i.signal.id);
    await store.addDigest({ agencyId, signalIds, sentTo: to, testMode: !live });
    // Test summaries leave statuses alone so the demo can be re-run; a real one marks the lights "sent to agency".
    if (live) await store.setSignalStatus(signalIds, "sent");

    results.push({ agencyId, live, signals: items.length, sentTo: to, delivered });
  }

  return results;
}

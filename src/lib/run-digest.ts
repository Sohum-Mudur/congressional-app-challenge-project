import "server-only";
import { agencyIdFor } from "./agencies";
import { config } from "./config";
import { esc, groupByAgency, renderDigestEmail, signalsDueForDigest } from "./digest";
import { sendEmail } from "./email";
import { getStore } from "./store";

export type DigestResult = { agencyId: string; signals: number; sentTo: string | null; delivered: boolean; skipped?: string };

/** Find every signal that crossed the report threshold and send one email per responsible agency. */
export async function runDigest(now = new Date()): Promise<DigestResult[]> {
  const store = getStore();
  const [signals, reports, states, agencies] = await Promise.all([
    store.listSignals(),
    store.listReports({ since: new Date(now.getTime() - 30 * 86_400_000) }),
    store.listSignalStates(),
    store.listAgencies(),
  ]);

  const due = signalsDueForDigest(signals, reports, states, now);
  const results: DigestResult[] = [];

  for (const [agencyId, items] of groupByAgency(due, agencyIdFor)) {
    const agency = agencies.find((a) => a.id === agencyId);
    if (!agency) {
      results.push({ agencyId, signals: items.length, sentTo: null, delivered: false, skipped: "agency not in directory" });
      continue;
    }

    // Where it goes: test inbox in test mode; otherwise the agency, or our admin for form-only agencies.
    const realTo = agency.email ?? config.adminEmail;
    const to = config.testMode ? config.testInbox : realTo;
    if (!to) {
      results.push({ agencyId, signals: items.length, sentTo: null, delivered: false, skipped: "no recipient configured" });
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
    if (config.testMode) subject = `[TEST → would go to ${realTo ?? "nobody"}] ${subject}`;

    const { delivered } = await sendEmail({ to, subject, text, html });
    const signalIds = items.map((i) => i.signal.id);
    await store.addDigest({ agencyId, signalIds, sentTo: to, testMode: config.testMode });
    // In test mode leave statuses alone so the demo can be re-run.
    if (!config.testMode) await store.setSignalStatus(signalIds, "sent");

    results.push({ agencyId, signals: items.length, sentTo: to, delivered });
  }

  return results;
}

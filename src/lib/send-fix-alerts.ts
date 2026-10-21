import "server-only";
import { config, isLive } from "./config";
import { sendEmail } from "./email";
import { renderFixedEmail } from "./fix-alerts";
import type { Signal } from "./signals";
import { getStore } from "./store";

/** Email everyone waiting on this light, then forget their addresses. Returns how many were emailed. */
export async function sendFixAlerts(signal: Signal, agency: { id: string; name: string }): Promise<number> {
  const alerts = await getStore().takeFixAlerts([signal.id]);
  const live = isLive(agency.id);
  const email = renderFixedEmail(signal, agency.name, { mapUrl: `${config.siteUrl}/?signal=${signal.id}` });

  let sent = 0;
  for (const alert of alerts) {
    // Same safety switch as the digest: unless this light's agency is live, the email goes to the test inbox instead.
    const to = live ? alert.email : config.testInbox;
    if (!to) continue;
    const subject = live ? email.subject : `[TEST → would go to ${alert.email}] ${email.subject}`;
    try {
      await sendEmail({ ...email, to, subject });
      sent++;
    } catch (err) {
      console.error(`Fix alert for ${signal.id} failed:`, (err as Error).message);
    }
  }
  return sent;
}

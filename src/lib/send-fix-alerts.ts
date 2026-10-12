import "server-only";
import { config } from "./config";
import { sendEmail } from "./email";
import { renderFixedEmail } from "./fix-alerts";
import type { Signal } from "./signals";
import { getStore } from "./store";

/** Email everyone waiting on this light, then forget their addresses. Returns how many were emailed. */
export async function sendFixAlerts(signal: Signal, agencyName: string): Promise<number> {
  const alerts = await getStore().takeFixAlerts([signal.id]);
  const email = renderFixedEmail(signal, agencyName, { mapUrl: `${config.siteUrl}/?signal=${signal.id}` });

  let sent = 0;
  for (const alert of alerts) {
    // Same safety switch as the digest: in test mode every email goes to the test inbox instead.
    const to = config.testMode ? config.testInbox : alert.email;
    if (!to) continue;
    const subject = config.testMode ? `[TEST → would go to ${alert.email}] ${email.subject}` : email.subject;
    try {
      await sendEmail({ ...email, to, subject });
      sent++;
    } catch (err) {
      console.error(`Fix alert for ${signal.id} failed:`, (err as Error).message);
    }
  }
  return sent;
}

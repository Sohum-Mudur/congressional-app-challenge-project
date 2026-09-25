import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { config } from "./config";

export type Email = { to: string; subject: string; text: string; html: string };

/**
 * Send an email with Resend, or — when no API key is set — save it to .data/outbox/
 * so it can be previewed at /dev/outbox. Never throws for the outbox path.
 */
export async function sendEmail(email: Email): Promise<{ delivered: boolean; id: string }> {
  if (!config.resendApiKey) {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
    const dir = path.join(process.cwd(), ".data", "outbox");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify(email, null, 2));
    return { delivered: false, id };
  }

  const resend = new Resend(config.resendApiKey);
  const { data, error } = await resend.emails.send({ from: config.emailFrom, ...email });
  if (error) throw new Error(`Resend: ${error.message}`);
  return { delivered: true, id: data!.id };
}

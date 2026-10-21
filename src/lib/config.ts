import "server-only";
import { APP_NAME } from "./brand";

/** Read an env var, treating blank values (e.g. `TEST_INBOX=` in .env.local) as unset. */
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

/** Server-side settings, all from environment variables (see .env.example). */
export const config = {
  siteUrl: env("SITE_URL") ?? "http://localhost:3000",

  /**
   * Safety switch: while true, no email ever goes to a real agency — everything goes to TEST_INBOX.
   * Only set TEST_MODE=false after the agency has agreed to receive reports.
   */
  testMode: env("TEST_MODE") !== "false",
  /**
   * Agencies that have agreed to get real emails even while TEST_MODE is on, e.g. "hillsborough-township".
   * Comma-separated agency ids from data/agencies.json. Everyone else stays in test mode.
   */
  liveAgencies: (env("LIVE_AGENCIES") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Without Resend, emails land in the local outbox anyway, so any placeholder address works.
  testInbox: env("TEST_INBOX") ?? (env("RESEND_API_KEY") ? null : "test-inbox@localhost"),

  /** Gets digests for agencies that only accept web forms, so a person can submit them. */
  adminEmail: env("ADMIN_EMAIL") ?? null,

  resendApiKey: env("RESEND_API_KEY") ?? null,
  /** Where replies to our emails go (a person on the team), since the sending address can't receive mail. */
  replyTo: env("REPLY_TO") ?? null,
  emailFrom: env("EMAIL_FROM") ?? `${APP_NAME} <onboarding@resend.dev>`,

  /** Secret mixed into IP-address hashes, so a stored hash can't be turned back into an address. */
  networkSalt: env("NETWORK_SALT") ?? (process.env.NODE_ENV === "production" ? null : "dev-only-salt"),

  /** Vercel Cron sends this as a Bearer token; protects the digest endpoint. */
  cronSecret: env("CRON_SECRET") ?? null,
};

/** Whether real emails go to this agency (and to residents waiting on its lights) instead of the test inbox. */
export const isLive = (agencyId: string) => !config.testMode || config.liveAgencies.includes(agencyId);

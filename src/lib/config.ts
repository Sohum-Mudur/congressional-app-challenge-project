import "server-only";

/** Server-side settings, all from environment variables (see .env.example). */
export const config = {
  siteUrl: process.env.SITE_URL ?? "http://localhost:3000",

  /**
   * Safety switch: while true, no email ever goes to a real agency — everything goes to TEST_INBOX.
   * Only set TEST_MODE=false after the agency has agreed to receive reports.
   */
  testMode: process.env.TEST_MODE !== "false",
  // Without Resend, emails land in the local outbox anyway, so any placeholder address works.
  testInbox: process.env.TEST_INBOX ?? (process.env.RESEND_API_KEY ? null : "test-inbox@localhost"),

  /** Gets digests for agencies that only accept web forms, so a person can submit them. */
  adminEmail: process.env.ADMIN_EMAIL ?? null,

  resendApiKey: process.env.RESEND_API_KEY ?? null,
  emailFrom: process.env.EMAIL_FROM ?? "Signal Report <onboarding@resend.dev>",

  /** Vercel Cron sends this as a Bearer token; protects the digest endpoint. */
  cronSecret: process.env.CRON_SECRET ?? null,
};

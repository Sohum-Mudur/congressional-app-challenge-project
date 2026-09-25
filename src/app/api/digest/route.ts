import { config } from "@/lib/config";
import { runDigest } from "@/lib/run-digest";

/**
 * Runs the daily digest. Called by Vercel Cron (GET with "Authorization: Bearer $CRON_SECRET"),
 * or by hand in development: curl -X POST localhost:3000/api/digest
 */
async function handle(request: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const authorized = config.cronSecret && request.headers.get("authorization") === `Bearer ${config.cronSecret}`;
  if (!isDev && !authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const results = await runDigest();
  return Response.json({ testMode: config.testMode, results });
}

export const GET = handle;
export const POST = handle;

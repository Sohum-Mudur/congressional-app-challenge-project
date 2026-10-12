import { z } from "zod";
import { getReporterId } from "@/lib/reporter";
import { getStore } from "@/lib/store";

const AlertInput = z.object({
  signalId: z.string().min(1).max(64),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
});

/** Only someone who just reported a light can ask to hear about it, so nobody can sign up strangers' addresses in bulk. */
const MUST_HAVE_REPORTED_WITHIN_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 10;

export async function POST(request: Request) {
  const parsed = AlertInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please enter a valid email address." }, { status: 400 });

  const store = getStore();
  const reporterId = await getReporterId();
  const since = new Date(Date.now() - MUST_HAVE_REPORTED_WITHIN_MS);
  const reported = (await store.listReports({ signalId: parsed.data.signalId, since })).some((r) => r.reporterId === reporterId);
  if (!reported) return Response.json({ error: "Report this light first, then you can ask to be notified." }, { status: 403 });
  if ((await store.countFixAlerts({ reporterId, since })) >= DAILY_LIMIT) {
    return Response.json({ error: "You've reached today's limit for alerts." }, { status: 429 });
  }

  await store.addFixAlert({ signalId: parsed.data.signalId, email: parsed.data.email, reporterId });
  return Response.json({ ok: true }, { status: 201 });
}

import { z } from "zod";
import { getReporterId } from "@/lib/reporter";
import { getStore } from "@/lib/store";

const ReportInput = z.object({
  signalId: z.string().min(1).max(64),
  issueType: z.enum(["stuck_red", "dark", "flashing", "ped_button", "other"]),
  approach: z.enum(["northbound", "eastbound", "southbound", "westbound"]).nullable().default(null),
  waitSeconds: z.number().int().min(0).max(3600).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

/** Same person, same light: one report per 30 minutes. Anyone: 20 reports per day. */
const SAME_SIGNAL_COOLDOWN_MS = 30 * 60 * 1000;
const DAILY_LIMIT = 20;

export async function POST(request: Request) {
  const parsed = ReportInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid report", details: z.flattenError(parsed.error) }, { status: 400 });
  }

  const store = getStore();
  const signals = await store.listSignals();
  if (!signals.some((s) => s.id === parsed.data.signalId)) {
    return Response.json({ error: "Unknown signal" }, { status: 404 });
  }

  const reporterId = await getReporterId();
  const mine = (await store.listReports({ since: new Date(Date.now() - 86_400_000) })).filter((r) => r.reporterId === reporterId);
  if (mine.length >= DAILY_LIMIT) {
    return Response.json({ error: "You've reached today's report limit. Thanks for helping!" }, { status: 429 });
  }
  const recentSame = mine.find((r) => r.signalId === parsed.data.signalId && Date.now() - Date.parse(r.createdAt) < SAME_SIGNAL_COOLDOWN_MS);
  if (recentSame) {
    return Response.json({ ok: true, duplicate: true, report: recentSame });
  }

  const report = await store.addReport({ ...parsed.data, reporterId });
  return Response.json({ ok: true, report }, { status: 201 });
}

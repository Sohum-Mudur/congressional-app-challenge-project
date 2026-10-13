import type { NextRequest } from "next/server";
import { getReporterId } from "@/lib/reporter";
import { getStore } from "@/lib/store";

/** Take back a report. Only the device that made it can, and any "notify me" sign-up for that light goes with it. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/reports/[id]">) {
  const { id } = await ctx.params;
  const store = getStore();
  const reporterId = await getReporterId();
  const report = (await store.listReports({ reporterId })).find((r) => r.id === id);
  if (!report) return Response.json({ error: "That report wasn't found." }, { status: 404 });

  await store.deleteReport(report.id);
  await store.deleteFixAlerts({ signalId: report.signalId, reporterId });

  // If that was the only report on a light nobody has been told about yet, the light goes back to normal.
  const state = (await store.listSignalStates()).find((s) => s.signalId === report.signalId);
  const othersLeft = (await store.listReports({ signalId: report.signalId, since: new Date(Date.now() - 30 * 86_400_000) })).length;
  if (state?.status === "reported" && othersLeft === 0) await store.setSignalStatus([report.signalId], "ok");

  // Once a digest has gone out, the agency already has the summary; say so rather than pretend it's undone.
  const alreadySent = state?.status === "sent" || state?.status === "acknowledged";
  return Response.json({ ok: true, alreadySent });
}

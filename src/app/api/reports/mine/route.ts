import { getReporterId } from "@/lib/reporter";
import { getStore } from "@/lib/store";

/** This device's reports from the last 30 days, newest first, so people can review or take them back. */
export async function GET() {
  const reporterId = await getReporterId();
  const reports = await getStore().listReports({ reporterId, since: new Date(Date.now() - 30 * 86_400_000) });
  return Response.json(
    reports.reverse().map(({ id, signalId, issueType, createdAt }) => ({ id, signalId, issueType, createdAt })),
    { headers: { "Cache-Control": "no-store" } },
  );
}

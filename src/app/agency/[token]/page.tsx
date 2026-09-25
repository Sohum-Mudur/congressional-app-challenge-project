import { notFound } from "next/navigation";
import { agencyIdFor } from "@/lib/agencies";
import { formatWait, summarize } from "@/lib/digest";
import { getStore } from "@/lib/store";
import { ISSUE_LABELS } from "@/lib/types";
import StatusButtons from "./StatusButtons";

export const metadata = { robots: { index: false } };

/** Private page for agency staff, reached from the link in the digest email. No account needed. */
export default async function AgencyPage(props: PageProps<"/agency/[token]">) {
  const { token } = await props.params;
  const store = getStore();
  const agency = await store.agencyForToken(token);
  if (!agency) notFound();

  const [signals, reports, states] = await Promise.all([store.listSignals(), store.listReports(), store.listSignalStates()]);
  const stateById = new Map(states.map((s) => [s.signalId, s]));

  const rows = signals
    .filter((s) => agencyIdFor(s) === agency.id)
    .map((s) => {
      const state = stateById.get(s.id);
      const mine = reports.filter((r) => r.signalId === s.id && (state?.status !== "fixed" || r.createdAt > state.changedAt));
      return { signal: s, status: state?.status ?? "ok", summary: summarize(s, mine) };
    })
    .filter((r) => r.summary.reportCount > 0 || r.status === "fixed")
    .sort((a, b) => b.summary.reportCount - a.summary.reportCount);

  return (
    <main className="mx-auto w-full max-w-2xl p-4">
      <h1 className="text-2xl font-bold">{agency.name}</h1>
      <p className="mt-1 text-neutral-600">
        Traffic signals residents have reported in your jurisdiction. Mark them as acknowledged or fixed, and the public map updates right away.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl bg-white p-6 text-center text-neutral-600 ring-1 ring-black/5">No open reports right now.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map(({ signal, status, summary }) => (
            <li key={signal.id} className="rounded-xl bg-white p-4 ring-1 ring-black/5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{signal.name}</p>
                  {summary.reportCount > 0 && (
                    <p className="text-sm text-neutral-600">
                      {ISSUE_LABELS[summary.topIssue]}
                      {summary.approaches[0] ? ` · mostly ${summary.approaches[0]}` : ""} · {summary.reportCount} reports from {summary.reporterCount} people · typical wait{" "}
                      {formatWait(summary.medianWaitSeconds)}
                    </p>
                  )}
                  <a className="text-sm font-medium text-sky-700" href={`/?signal=${signal.id}`}>
                    View on map
                  </a>
                </div>
                <StatusButtons token={token} signalId={signal.id} status={status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

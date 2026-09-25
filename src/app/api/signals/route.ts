import { agencyFor } from "@/lib/agencies";
import { getStore } from "@/lib/store";

/** Every signal with its current status, recent report count and responsible agency, for the map. */
export async function GET() {
  const store = getStore();
  const [signals, states, reports, agencies] = await Promise.all([
    store.listSignals(),
    store.listSignalStates(),
    store.listReports({ since: new Date(Date.now() - 30 * 86_400_000) }),
    store.listAgencies(),
  ]);
  const stateById = new Map(states.map((s) => [s.signalId, s]));

  return Response.json(
    signals.map((s) => {
      const state = stateById.get(s.id);
      const agency = agencyFor(s, agencies);
      return {
        ...s,
        status: state?.status ?? "ok",
        statusChangedAt: state?.changedAt ?? null,
        // Once a light is marked fixed, only reports made after the fix count.
        recentReports: reports.filter((r) => r.signalId === s.id && (state?.status !== "fixed" || r.createdAt > state.changedAt)).length,
        agency: agency && { id: agency.id, name: agency.name, phone: agency.phone, formUrl: agency.formUrl },
      };
    }),
  );
}

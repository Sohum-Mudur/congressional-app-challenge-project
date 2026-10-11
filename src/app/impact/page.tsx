import Link from "next/link";
import { OWNER_COLORS } from "@/components/labels";
import { agencyFor } from "@/lib/agencies";
import { getStore } from "@/lib/store";
import { impactStats } from "@/lib/stats";

export const metadata = { title: "Impact · Signal Report" };
export const dynamic = "force-dynamic";

export default async function ImpactPage() {
  const store = getStore();
  const [signals, reports, states, agencies] = await Promise.all([store.listSignals(), store.listReports(), store.listSignalStates(), store.listAgencies()]);
  const stats = impactStats(reports);
  const fixed = states.filter((s) => s.status === "fixed").length;
  const open = states.filter((s) => s.status !== "fixed" && s.status !== "ok").length;

  const byOwner = (["state", "county", "municipal"] as const).map((type) => ({
    type,
    label: { state: "NJDOT", county: "County", municipal: "Township" }[type],
    total: signals.filter((s) => s.ownerType === type).length,
  }));

  const top = [...new Set(reports.map((r) => r.signalId))]
    .map((id) => ({ signal: signals.find((s) => s.id === id)!, count: reports.filter((r) => r.signalId === id).length, status: states.find((s) => s.signalId === id)?.status ?? "reported" }))
    .filter((x) => x.signal)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <main className="mx-auto w-full max-w-2xl p-4">
      <h1 className="text-2xl font-bold">Impact in Hillsborough</h1>
      <p className="mt-1 text-neutral-600">Every report is one person stuck at a light that should have turned green.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat value={stats.reports} label="reports" />
        <Stat value={stats.people} label="people reporting" />
        <Stat value={`${stats.waitMinutes} min`} label="spent waiting" />
        <Stat value={`${stats.co2Kg} kg`} label="CO₂ if all gas cars (est.)" />
        <Stat value={open} label="lights open" />
        <Stat value={fixed} label="lights fixed" />
      </div>

      <h2 className="mt-8 text-lg font-bold">Who owns Hillsborough&apos;s {signals.length} traffic lights</h2>
      <p className="text-sm text-neutral-600">Most people don&apos;t know that the state, the county and the township each own different lights. This app works it out for you.</p>
      <div className="mt-3 flex h-8 overflow-hidden rounded-lg text-xs font-semibold text-white">
        {byOwner.map((o) => (
          <div
            key={o.type}
            className="flex items-center justify-center"
            style={{ width: `${(o.total / signals.length) * 100}%`, background: OWNER_COLORS[o.type] }}
          >
            {o.label} {o.total}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold">Most-reported lights</h2>
      {top.length === 0 ? (
        <p className="mt-2 text-neutral-600">
          No reports yet. <Link className="font-medium text-red-700" href="/">Be the first →</Link>
        </p>
      ) : (
        <ol className="mt-2 divide-y divide-neutral-200 rounded-xl bg-white ring-1 ring-black/5">
          {top.map(({ signal, count, status }) => (
            <li key={signal.id} className="flex items-center justify-between gap-3 p-3">
              <div>
                <Link href={`/?signal=${signal.id}`} className="font-medium">
                  {signal.name}
                </Link>
                <p className="text-xs text-neutral-500">{agencyFor(signal, agencies)?.name}</p>
              </div>
              <span className="text-sm text-neutral-700">
                {count} · {status === "fixed" ? "fixed ✓" : status}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-8 text-xs text-neutral-500">
        Estimates: reports without a wait time count as 60 seconds. Idling uses about 0.25 gallons/hour (US DOE, low end) and each gallon emits about 8,887 g of CO₂ (US
        EPA). This assumes gas cars. Electric cars like Teslas don&apos;t idle an engine; while stopped they use only a little electricity for climate and
        screens, so for them the real cost is time. Only reported waits are counted, so the real total is higher.
      </p>
    </main>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-sm text-neutral-600">{label}</p>
    </div>
  );
}

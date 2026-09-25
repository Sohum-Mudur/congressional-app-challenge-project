"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { approachDirection, snapToNearest, type Approach, type LatLng } from "@/lib/geo";
import { ISSUE_LABELS, type IssueType } from "@/lib/types";
import { OWNER_COLORS, OWNER_LABELS } from "./labels";
import type { MapSignal, PendingReport } from "./types";

// MapLibre touches `window`, so only load it in the browser.
const SignalMap = dynamic(() => import("./SignalMap"), { ssr: false });

const PENDING_KEY = "pendingReports";
const SAFETY_KEY = "safetyAcknowledged";

const WAIT_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "Under 1 min", seconds: 45 },
  { label: "1–2 min", seconds: 90 },
  { label: "2–3 min", seconds: 150 },
  { label: "3+ min", seconds: 210 },
  { label: "Not sure", seconds: null },
];

type Step =
  | { name: "idle" }
  | { name: "safety" }
  | { name: "locating" }
  | { name: "form"; signalId: string; approach: Approach | null; pending?: PendingReport }
  | { name: "sent"; signalId: string; duplicate: boolean };

// --- small localStorage helpers (storage can be unavailable in private mode) ---
function loadPending(): PendingReport[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function savePending(list: PendingReport[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {}
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device can't share its location."));
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Location permission was denied.")), {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 5_000,
    });
  });
}

export default function ReportApp({ initialSignalId }: { initialSignalId: string | null }) {
  const [signals, setSignals] = useState<MapSignal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSignalId);
  const [userPosition, setUserPosition] = useState<LatLng | null>(null);
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [pending, setPending] = useState<PendingReport[]>(loadPending);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/signals", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MapSignal[] | null) => data && setSignals(data));
  }, []);

  useEffect(refresh, [refresh]);

  const selected = useMemo(() => signals.find((s) => s.id === selectedId) ?? null, [signals, selectedId]);

  // --- actions ---

  function startReport() {
    setMessage(null);
    let acknowledged = false;
    try {
      acknowledged = sessionStorage.getItem(SAFETY_KEY) === "1";
    } catch {}
    if (acknowledged) locateAndSnap();
    else setStep({ name: "safety" });
  }

  async function locateAndSnap() {
    try {
      sessionStorage.setItem(SAFETY_KEY, "1");
    } catch {}
    setStep({ name: "locating" });
    try {
      const pos = await getPosition();
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserPosition(here);
      const hit = snapToNearest(here, signals);
      if (!hit) {
        setStep({ name: "idle" });
        setMessage("No traffic light within 60 m of you. Tap the light on the map instead.");
        return;
      }
      setSelectedId(hit.signal.id);
      setStep({ name: "form", signalId: hit.signal.id, approach: approachDirection(here, hit.signal, pos.coords.heading) });
    } catch (err) {
      setStep({ name: "idle" });
      setMessage(`${(err as Error).message} You can tap the light on the map instead.`);
    }
  }

  /** Driver-safe path: one tap saves where you are; finish the report once parked. */
  async function saveForLater() {
    setStep({ name: "locating" });
    try {
      const pos = await getPosition();
      const item: PendingReport = { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading, at: new Date().toISOString() };
      const next = [...loadPending(), item];
      savePending(next);
      setPending(next);
      setStep({ name: "idle" });
      setMessage("Saved. Finish the report once you're parked.");
    } catch (err) {
      setStep({ name: "idle" });
      setMessage((err as Error).message);
    }
  }

  function finishPending(item: PendingReport) {
    setMessage(null);
    const hit = snapToNearest(item, signals);
    if (!hit) {
      dropPending(item);
      setMessage("That saved spot wasn't near a known traffic light, so it was removed.");
      return;
    }
    setSelectedId(hit.signal.id);
    setStep({ name: "form", signalId: hit.signal.id, approach: approachDirection(item, hit.signal, item.heading), pending: item });
  }

  function dropPending(item: PendingReport) {
    const next = loadPending().filter((p) => p.at !== item.at);
    savePending(next);
    setPending(next);
  }

  function selectFromMap(id: string) {
    setSelectedId(id);
    setMessage(null);
    if (step.name === "form") setStep({ ...step, signalId: id, approach: null });
    else if (step.name !== "safety" && step.name !== "locating") setStep({ name: "idle" });
  }

  async function submit(input: { issueType: IssueType; waitSeconds: number | null; approach: Approach | null; note: string }) {
    if (step.name !== "form") return;
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signalId: step.signalId, ...input, note: input.note.trim() || null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error ?? "Something went wrong. Please try again.");
      return;
    }
    if (step.pending) dropPending(step.pending);
    setStep({ name: "sent", signalId: step.signalId, duplicate: Boolean(body.duplicate) });
    refresh();
  }

  // --- render ---

  const formSignal = step.name === "form" || step.name === "sent" ? signals.find((s) => s.id === step.signalId) : null;

  return (
    <div className="relative flex-1">
      <SignalMap signals={signals} selectedId={selectedId} userPosition={userPosition} onSelect={selectFromMap} />
      <Legend />

      <div className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-md px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-h-[78dvh] overflow-y-auto rounded-2xl bg-white p-4 text-neutral-900 shadow-xl ring-1 ring-black/5">
          {step.name === "safety" && <SafetyGate onContinue={locateAndSnap} onLater={saveForLater} onCancel={() => setStep({ name: "idle" })} />}

          {step.name === "locating" && <p className="py-6 text-center text-neutral-600">Finding your location…</p>}

          {step.name === "form" && formSignal && (
            <ReportForm
              key={formSignal.id}
              signal={formSignal}
              initialApproach={step.approach}
              onSubmit={submit}
              onCancel={() => setStep({ name: "idle" })}
            />
          )}

          {step.name === "sent" && formSignal && <SentCard signal={formSignal} duplicate={step.duplicate} onDone={() => setStep({ name: "idle" })} />}

          {step.name === "idle" && (
            <>
              {selected && <SignalCard signal={selected} onReport={() => setStep({ name: "form", signalId: selected.id, approach: null })} />}
              {message && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
              {pending.length > 0 && (
                <div className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                  <p className="font-medium">
                    You saved {pending.length} light{pending.length > 1 ? "s" : ""} to report.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pending.map((p) => (
                      <button key={p.at} onClick={() => finishPending(p)} className="rounded-full bg-sky-600 px-3 py-1.5 font-medium text-white">
                        Finish ({new Date(p.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={startReport} className="w-full rounded-xl bg-red-600 py-4 text-lg font-bold text-white shadow active:bg-red-700">
                Report the light I&apos;m at
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- pieces ---

function Legend() {
  return (
    <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/95 p-2.5 text-xs text-neutral-800 shadow ring-1 ring-black/5">
      <p className="mb-1 font-semibold">Who fixes it</p>
      {(Object.keys(OWNER_LABELS) as (keyof typeof OWNER_LABELS)[]).map((t) => (
        <div key={t} className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: OWNER_COLORS[t] }} />
          {OWNER_LABELS[t]}
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full bg-red-600/30" /> Reported
      </div>
    </div>
  );
}

function SafetyGate({ onContinue, onLater, onCancel }: { onContinue: () => void; onLater: () => void; onCancel: () => void }) {
  return (
    <div>
      <p className="text-lg font-bold">Are you driving?</p>
      <p className="mt-1 text-sm text-neutral-600">New Jersey law bans handheld phone use while driving. Only fill in a report as a passenger or once you&apos;re parked.</p>
      <div className="mt-4 grid gap-2">
        <button onClick={onContinue} className="rounded-xl bg-neutral-900 py-3.5 font-semibold text-white">
          I&apos;m a passenger or parked
        </button>
        <button onClick={onLater} className="rounded-xl bg-sky-600 py-3.5 font-semibold text-white">
          I&apos;m driving: save this spot for later
        </button>
        <button onClick={onCancel} className="py-2 text-sm text-neutral-500">
          Cancel
        </button>
      </div>
    </div>
  );
}

function SignalCard({ signal, onReport }: { signal: MapSignal; onReport: () => void }) {
  return (
    <div className="mb-3 border-b border-neutral-100 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{signal.name}</p>
          <p className="text-sm text-neutral-600">
            Fixed by {signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}
            {signal.viaRef ? ` (${signal.viaRef})` : ""}
          </p>
        </div>
        <StatusBadge signal={signal} />
      </div>
      <button onClick={onReport} className="mt-2 text-sm font-semibold text-red-700">
        Report this light →
      </button>
    </div>
  );
}

export function StatusBadge({ signal }: { signal: Pick<MapSignal, "status" | "recentReports"> }) {
  const styles: Record<string, string> = {
    ok: "bg-neutral-100 text-neutral-600",
    reported: "bg-red-100 text-red-800",
    sent: "bg-amber-100 text-amber-900",
    acknowledged: "bg-sky-100 text-sky-900",
    fixed: "bg-green-100 text-green-800",
  };
  const label = {
    ok: "No reports",
    reported: `${signal.recentReports} report${signal.recentReports === 1 ? "" : "s"}`,
    sent: "Sent to agency",
    acknowledged: "Agency on it",
    fixed: "Fixed ✓",
  }[signal.status];
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${styles[signal.status]}`}>{label}</span>;
}

function ReportForm({
  signal,
  initialApproach,
  onSubmit,
  onCancel,
}: {
  signal: MapSignal;
  initialApproach: Approach | null;
  onSubmit: (input: { issueType: IssueType; waitSeconds: number | null; approach: Approach | null; note: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [issueType, setIssueType] = useState<IssueType>("stuck_red");
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  const [approach, setApproach] = useState<Approach | null>(initialApproach);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSubmit({ issueType, waitSeconds, approach, note });
        setBusy(false);
      }}
    >
      <p className="text-sm text-neutral-500">Reporting</p>
      <p className="text-lg font-bold leading-tight">{signal.name}</p>
      <p className="text-sm text-neutral-600">Goes to {signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}</p>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-sm font-semibold">What&apos;s wrong?</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ISSUE_LABELS) as IssueType[]).map((t) => (
            <Chip key={t} active={issueType === t} onClick={() => setIssueType(t)}>
              {ISSUE_LABELS[t]}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-sm font-semibold">How long did you wait?</legend>
        <div className="flex flex-wrap gap-2">
          {WAIT_CHOICES.map((w) => (
            <Chip key={w.label} active={waitSeconds === w.seconds} onClick={() => setWaitSeconds(w.seconds)}>
              {w.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-sm font-semibold">Which way were you going?</legend>
        <div className="flex flex-wrap gap-2">
          {(["northbound", "eastbound", "southbound", "westbound"] as const).map((a) => (
            <Chip key={a} active={approach === a} onClick={() => setApproach(approach === a ? null : a)}>
              {a[0].toUpperCase() + a.slice(1)}
            </Chip>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-semibold">Anything else? (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="e.g. left-turn arrow never comes on"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
        />
      </label>

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-3.5 font-semibold text-neutral-600">
          Cancel
        </button>
        <button disabled={busy} className="flex-1 rounded-xl bg-red-600 py-3.5 text-lg font-bold text-white disabled:opacity-60">
          {busy ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}

function SentCard({ signal, duplicate, onDone }: { signal: MapSignal; duplicate: boolean; onDone: () => void }) {
  return (
    <div className="text-center">
      <p className="text-3xl">✅</p>
      <p className="mt-1 text-lg font-bold">{duplicate ? "Already got it, thanks!" : "Report received"}</p>
      <p className="mt-1 text-sm text-neutral-600">
        {signal.name} now has <strong>{signal.recentReports}</strong> report{signal.recentReports === 1 ? "" : "s"}. Once 3 people report it, we send one
        summary to <strong>{signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}</strong>.
      </p>
      <button onClick={onDone} className="mt-4 w-full rounded-xl bg-neutral-900 py-3.5 font-semibold text-white">
        Done
      </button>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-2 text-sm font-medium ring-1 transition ${active ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-neutral-300"}`}
    >
      {children}
    </button>
  );
}

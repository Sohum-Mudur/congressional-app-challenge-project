"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { approachDirection, snapToNearest, type Approach, type LatLng } from "@/lib/geo";
import { ISSUE_LABELS, type IssueType } from "@/lib/types";
import { useIsInstalled } from "./install";
import { OWNER_COLORS, OWNER_LABELS } from "./labels";
import type { MapSignal, MyReport, PendingReport } from "./types";
import { useLiveLocation } from "./useLiveLocation";

// MapLibre touches `window`, so only load it in the browser.
const SignalMap = dynamic(() => import("./SignalMap"), { ssr: false });

const PENDING_KEY = "pendingReports";
const SAFETY_KEY = "safetyAcknowledged";
const EMAIL_KEY = "fixAlertEmail";
const INSTALL_HINT_KEY = "installHintDismissed";

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
  | { name: "none-nearby"; nearest: { signal: MapSignal; distance: number } | null }
  | { name: "form"; signalId: string; approach: Approach | null; pending?: PendingReport }
  | { name: "sent"; signalId: string; reportId: string; duplicate: boolean }
  | { name: "saved"; item: PendingReport; nearName: string | null }
  | { name: "mine" };

type Notice = { tone: "ok" | "warn"; text: string };

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
  const live = useLiveLocation();
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [pending, setPending] = useState<PendingReport[]>(loadPending);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mine, setMine] = useState<MyReport[]>([]);
  const setMessage = (text: string | null) => setNotice(text ? { tone: "warn", text } : null);

  /** Reload the map data and this device's reports. Resolves once both are in. */
  const refresh = useCallback(() => {
    const load = <T,>(url: string): Promise<T | null> =>
      fetch(url, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    return Promise.all([
      load<MapSignal[]>("/api/signals").then((data) => data && setSignals(data)),
      load<MyReport[]>("/api/reports/mine").then((data) => data && setMine(data)),
    ]).then(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  /** Where you are now: the live position if it's fresh, otherwise a one-off GPS fix. */
  async function currentFix(): Promise<LatLng & { heading: number | null }> {
    live.start();
    const p = live.position;
    if (p && Date.now() - p.at < 15_000) return { lat: p.lat, lng: p.lng, heading: live.travelHeading() };
    const pos = await getPosition();
    const moving = (pos.coords.speed ?? 0) >= 2.5;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: live.travelHeading() ?? (moving ? pos.coords.heading : null) };
  }

  async function locateAndSnap() {
    try {
      sessionStorage.setItem(SAFETY_KEY, "1");
    } catch {}
    setStep({ name: "locating" });
    try {
      const here = await currentFix();
      const hit = snapToNearest(here, signals);
      if (!hit) {
        setStep({ name: "none-nearby", nearest: snapToNearest(here, signals, Infinity) });
        return;
      }
      setSelectedId(hit.signal.id);
      // The direction you were driving just before stopping is the best guess for which way you're facing.
      setStep({ name: "form", signalId: hit.signal.id, approach: approachDirection(here, hit.signal, here.heading) });
    } catch (err) {
      setStep({ name: "idle" });
      setMessage(`${(err as Error).message} You can tap the light on the map instead.`);
    }
  }

  /** Driver-safe path: one tap saves where you are; finish the report once parked. */
  async function saveForLater() {
    setStep({ name: "locating" });
    try {
      const here = await currentFix();
      const item: PendingReport = { lat: here.lat, lng: here.lng, heading: here.heading, at: new Date().toISOString() };
      const next = [...loadPending(), item];
      savePending(next);
      setPending(next);
      setStep({ name: "saved", item, nearName: snapToNearest(item, signals)?.signal.name ?? null });
    } catch (err) {
      setStep({ name: "idle" });
      setMessage((err as Error).message);
    }
  }

  async function takeBack(reportId: string): Promise<boolean> {
    const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error ?? "Couldn't take that report back. Please try again.");
      return false;
    }
    setNotice({
      tone: "ok",
      text: body.alreadySent
        ? "Report taken back. The agency had already been sent a summary that included it."
        : "Report taken back. It won't be sent to anyone.",
    });
    await refresh();
    return true;
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
    await refresh(); // so the confirmation shows the new report count
    setStep({ name: "sent", signalId: step.signalId, reportId: body.report.id, duplicate: Boolean(body.duplicate) });
  }

  // --- render ---

  const formSignal = step.name === "form" || step.name === "sent" ? signals.find((s) => s.id === step.signalId) : null;

  return (
    <div className="relative flex-1">
      <SignalMap
        signals={signals}
        selectedId={selectedId}
        userPosition={live.position}
        heading={live.heading}
        onSelect={selectFromMap}
        onLocate={live.start}
      />
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

          {step.name === "sent" && formSignal && (
            <SentCard
              signal={formSignal}
              duplicate={step.duplicate}
              onDone={() => setStep({ name: "idle" })}
              onUndo={async () => {
                if (await takeBack(step.reportId)) setStep({ name: "idle" });
              }}
            />
          )}

          {step.name === "saved" && (
            <SavedCard
              nearName={step.nearName}
              onDone={() => setStep({ name: "idle" })}
              onUndo={() => {
                dropPending(step.item);
                setStep({ name: "idle" });
                setNotice({ tone: "ok", text: "Saved spot removed." });
              }}
            />
          )}

          {step.name === "none-nearby" && (
            <NoneNearbyCard
              nearest={step.nearest}
              onPick={(id) => {
                setSelectedId(id);
                setStep({ name: "form", signalId: id, approach: null });
              }}
              onDone={() => setStep({ name: "idle" })}
            />
          )}

          {step.name === "mine" && (
            <MyReportsList
              reports={mine}
              signals={signals}
              onTakeBack={takeBack}
              onShow={(id) => {
                setSelectedId(id);
                setStep({ name: "idle" });
              }}
              onDone={() => setStep({ name: "idle" })}
            />
          )}

          {step.name === "idle" && (
            <>
              {selected && <SignalCard signal={selected} onReport={() => setStep({ name: "form", signalId: selected.id, approach: null })} />}
              {live.error && !notice && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{live.error}</p>}
              {notice && (
                <p className={`mb-3 rounded-lg p-3 text-sm ${notice.tone === "ok" ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>{notice.text}</p>
              )}
              {pending.length > 0 && (
                <div className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                  <p className="font-medium">
                    You saved {pending.length} light{pending.length > 1 ? "s" : ""} to report.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pending.map((p) => (
                      <span key={p.at} className="inline-flex overflow-hidden rounded-full bg-sky-600 font-medium text-white">
                        <button onClick={() => finishPending(p)} className="py-1.5 pl-3 pr-2">
                          Finish ({new Date(p.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})
                        </button>
                        <button onClick={() => dropPending(p)} aria-label="Delete this saved spot" className="border-l border-white/30 px-2.5">
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={startReport} className="w-full rounded-xl bg-red-600 py-4 text-lg font-bold text-white shadow active:bg-red-700">
                Report the light I&apos;m at
              </button>
              {mine.length > 0 && (
                <button onClick={() => setStep({ name: "mine" })} className="mt-2 w-full py-1.5 text-sm font-medium text-neutral-600">
                  Your reports ({mine.length})
                </button>
              )}
              <InstallHint />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- pieces ---

/** A one-line nudge to add the app to the home screen, hidden once installed or dismissed. */
function InstallHint() {
  const installed = useIsInstalled();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_HINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (installed || dismissed) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
      <Link href="/install" className="font-medium text-sky-700">
        📲 Add this app to your home screen
      </Link>
      <button
        aria-label="Hide"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(INSTALL_HINT_KEY, "1");
          } catch {}
        }}
        className="px-2 text-neutral-400"
      >
        ✕
      </button>
    </div>
  );
}

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

function SentCard({ signal, duplicate, onDone, onUndo }: { signal: MapSignal; duplicate: boolean; onDone: () => void; onUndo: () => Promise<void> }) {
  const [undoing, setUndoing] = useState(false);
  return (
    <div className="text-center">
      <p className="text-3xl">✅</p>
      <p className="mt-1 text-lg font-bold">{duplicate ? "Already got it, thanks!" : "Report received"}</p>
      <p className="mt-1 text-sm text-neutral-600">
        {signal.name} now has <strong>{signal.recentReports}</strong> report{signal.recentReports === 1 ? "" : "s"}. Once 3 people report it, we send one
        summary to <strong>{signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}</strong>.
      </p>
      <FixAlertForm signalId={signal.id} />
      <button onClick={onDone} className="mt-4 w-full rounded-xl bg-neutral-900 py-3.5 font-semibold text-white">
        Done
      </button>
      <button
        disabled={undoing}
        onClick={async () => {
          setUndoing(true);
          await onUndo();
          setUndoing(false);
        }}
        className="mt-1 w-full py-2.5 text-sm font-medium text-neutral-500 disabled:opacity-50"
      >
        {undoing ? "Taking it back…" : "Made a mistake? Undo this report"}
      </button>
    </div>
  );
}

function SavedCard({ nearName, onDone, onUndo }: { nearName: string | null; onDone: () => void; onUndo: () => void }) {
  return (
    <div className="text-center">
      <p className="text-3xl">📍</p>
      <p className="mt-1 text-lg font-bold">Spot saved</p>
      <p className="mt-1 text-sm text-neutral-600">
        {nearName ? (
          <>
            Near <strong>{nearName}</strong>.
          </>
        ) : (
          "There's no traffic light within 60 m of this spot, so you'll pick the light on the map when you finish."
        )}{" "}
        Nothing has been sent yet. Once you&apos;re parked, open the app and tap <strong>Finish</strong>.
      </p>
      <button onClick={onDone} className="mt-4 w-full rounded-xl bg-neutral-900 py-3.5 font-semibold text-white">
        OK
      </button>
      <button onClick={onUndo} className="mt-1 w-full py-2.5 text-sm font-medium text-neutral-500">
        Undo
      </button>
    </div>
  );
}

function NoneNearbyCard({
  nearest,
  onPick,
  onDone,
}: {
  nearest: { signal: MapSignal; distance: number } | null;
  onPick: (signalId: string) => void;
  onDone: () => void;
}) {
  const miles = nearest ? nearest.distance / 1609.34 : 0;
  return (
    <div>
      <p className="text-lg font-bold">No traffic light right here</p>
      <p className="mt-1 text-sm text-neutral-600">
        We only cover Hillsborough&apos;s traffic lights, and none is within 60 m (200 ft) of you. If you already drove away from the light, find it on the map and tap it.
      </p>
      {nearest && miles < 2 && (
        <button
          onClick={() => onPick(nearest.signal.id)}
          className="mt-3 w-full rounded-xl bg-neutral-100 p-3 text-left ring-1 ring-black/5"
        >
          <span className="block text-xs text-neutral-500">Closest light ({miles < 0.1 ? `${Math.round(nearest.distance * 3.28)} ft` : `${miles.toFixed(1)} mi`} away)</span>
          <span className="block font-semibold">{nearest.signal.name}</span>
          <span className="text-sm font-semibold text-red-700">Report this light →</span>
        </button>
      )}
      <button onClick={onDone} className="mt-3 w-full rounded-xl bg-neutral-900 py-3.5 font-semibold text-white">
        Pick on the map
      </button>
    </div>
  );
}

function MyReportsList({
  reports,
  signals,
  onTakeBack,
  onShow,
  onDone,
}: {
  reports: MyReport[];
  signals: MapSignal[];
  onTakeBack: (id: string) => Promise<boolean>;
  onShow: (signalId: string) => void;
  onDone: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const name = (id: string) => signals.find((s) => s.id === id)?.name ?? "Unknown light";
  return (
    <div>
      <p className="text-lg font-bold">Your reports</p>
      <p className="text-sm text-neutral-600">From this phone, in the last 30 days.</p>
      {reports.length === 0 && <p className="mt-3 text-sm text-neutral-600">None right now.</p>}
      <ul className="mt-2 divide-y divide-neutral-100">
        {reports.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
            <button onClick={() => onShow(r.signalId)} className="min-w-0 text-left">
              <span className="block truncate font-medium">{name(r.signalId)}</span>
              <span className="block text-xs text-neutral-500">
                {ISSUE_LABELS[r.issueType]} ·{" "}
                {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            </button>
            <button
              disabled={busyId === r.id}
              onClick={async () => {
                if (!window.confirm(`Take back your report for ${name(r.signalId)}?`)) return;
                setBusyId(r.id);
                await onTakeBack(r.id);
                setBusyId(null);
              }}
              className="shrink-0 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
            >
              {busyId === r.id ? "…" : "Take back"}
            </button>
          </li>
        ))}
      </ul>
      <button onClick={onDone} className="mt-3 w-full rounded-xl bg-neutral-900 py-3.5 font-semibold text-white">
        Done
      </button>
    </div>
  );
}

/** Optional: one email when the agency marks this light fixed. The address is remembered on this device only, to save retyping. */
function FixAlertForm({ signalId }: { signalId: string }) {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(EMAIL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-900">We&apos;ll email you once when it&apos;s fixed, then delete your address.</p>;
  }

  return (
    <form
      className="mt-4 rounded-xl bg-neutral-50 p-3 text-left"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        setError(null);
        const res = await fetch("/api/fix-alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signalId, email: email.trim() }),
        });
        if (!res.ok) {
          setError((await res.json().catch(() => ({}))).error ?? "Couldn't save that. Please try again.");
          setState("idle");
          return;
        }
        try {
          localStorage.setItem(EMAIL_KEY, email.trim());
        } catch {}
        setState("done");
      }}
    >
      <label htmlFor="fix-alert-email" className="text-sm font-semibold">
        Email me when it&apos;s fixed <span className="font-normal text-neutral-500">(optional)</span>
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="fix-alert-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base"
        />
        <button disabled={state === "busy"} className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
          {state === "busy" ? "…" : "Notify me"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
      <p className="mt-1.5 text-xs text-neutral-500">One email, only about this light. We delete your address after sending it.</p>
    </form>
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

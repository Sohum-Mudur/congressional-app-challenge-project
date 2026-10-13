"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { approachDirection, snapToNearest, type Approach, type LatLng } from "@/lib/geo";
import { searchSignals } from "@/lib/search";
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
  | { name: "pick" } // "choose a light on the map": the next light tapped opens its report form
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
  const [frame, setFrame] = useState<LatLng[] | null>(null);
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
        const nearest = snapToNearest(here, signals, Infinity);
        setStep({ name: "none-nearby", nearest });
        setFrame(nearest ? [here, nearest.signal] : [here]); // show where you are relative to the closest light
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


  /** A light was tapped on the map, or empty map (null), which closes the light's card like Google Maps does. */
  function selectFromMap(id: string | null) {
    if (id === null) {
      if (step.name === "idle") {
        setSelectedId(null);
        setNotice(null);
      }
      return;
    }
    setSelectedId(id);
    setMessage(null);
    if (step.name === "form" || step.name === "pick") setStep({ name: "form", signalId: id, approach: null });
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
      // Back to the main card so the reason is visible (it used to be hidden behind the open form).
      setStep({ name: "idle" });
      setMessage(body.error ?? "Something went wrong. Please try again.");
      return;
    }
    if (step.pending) dropPending(step.pending);
    await refresh(); // so the confirmation shows the new report count
    setStep({ name: "sent", signalId: step.signalId, reportId: body.report.id, duplicate: Boolean(body.duplicate) });
  }

  // --- render ---

  const formSignal = step.name === "form" || step.name === "sent" ? signals.find((s) => s.id === step.signalId) : null;
  const close = () => setStep({ name: "idle" });

  /** Go straight to the report form for a light picked from search, the map, or a list. */
  function reportLight(id: string) {
    setSelectedId(id);
    setNotice(null);
    setStep({ name: "form", signalId: id, approach: null });
  }

  function startPicking() {
    setSelectedId(null);
    setNotice(null);
    setStep({ name: "pick" });
    setFrame(signals.map((s) => ({ lat: s.lat, lng: s.lng }))); // zoom out so every light is in view
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <SignalMap
        signals={signals}
        selectedId={selectedId}
        userPosition={live.position}
        heading={live.heading}
        onSelect={selectFromMap}
        onLocate={live.start}
        frame={frame}
      />
      <SearchBar signals={signals} onChoose={reportLight} />
      <Legend />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md sm:px-3 sm:pb-3">
        <div className="pointer-events-auto flex max-h-[82dvh] flex-col rounded-t-[28px] bg-white text-neutral-900 shadow-[0_-6px_28px_rgb(0_0_0/0.14)] sm:rounded-[28px]">
          <div className="flex shrink-0 justify-center pb-1 pt-2.5" aria-hidden>
            <span className="h-1.5 w-10 rounded-full bg-neutral-300" />
          </div>
          <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">
            {step.name === "safety" && <SafetyGate onContinue={locateAndSnap} onLater={saveForLater} onCancel={close} />}

            {step.name === "locating" && (
              <div className="flex items-center justify-center gap-3 py-8 text-neutral-600">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-sky-600" aria-hidden />
                Finding your location…
              </div>
            )}

            {step.name === "form" && formSignal && (
              <ReportForm key={formSignal.id} signal={formSignal} initialApproach={step.approach} onSubmit={submit} onCancel={close} />
            )}

            {step.name === "sent" && formSignal && (
              <SentCard
                signal={formSignal}
                duplicate={step.duplicate}
                onDone={close}
                onUndo={async () => {
                  if (await takeBack(step.reportId)) close();
                }}
              />
            )}

            {step.name === "saved" && (
              <SavedCard
                nearName={step.nearName}
                onDone={close}
                onUndo={() => {
                  dropPending(step.item);
                  close();
                  setNotice({ tone: "ok", text: "Saved spot removed." });
                }}
              />
            )}

            {step.name === "pick" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xl font-bold">Tap the light you want to report</p>
                  <CloseButton onClick={close} label="Cancel" />
                </div>
                <p className="mt-1 text-[15px] text-neutral-600">
                  Each colored dot on the map is a traffic light. Pinch to zoom in, or search for a street at the top.
                </p>
              </div>
            )}

            {step.name === "none-nearby" && (
              <NoneNearbyCard
                nearest={step.nearest}
                onPick={(id) => {
                  setSelectedId(id);
                  setStep({ name: "form", signalId: id, approach: null });
                }}
                onDone={close}
              />
            )}

            {step.name === "mine" && (
              <MyReportsList
                reports={mine}
                signals={signals}
                onTakeBack={takeBack}
                onShow={(id) => {
                  setSelectedId(id);
                  close();
                }}
                onDone={close}
              />
            )}

            {step.name === "idle" && (
              <>
                {live.error && !notice && <Banner tone="warn">{live.error}</Banner>}
                {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
                {pending.length > 0 && (
                  <div className="mb-3 rounded-2xl bg-sky-50 p-3.5 text-sm text-sky-950">
                    <p className="font-semibold">
                      You saved {pending.length} spot{pending.length > 1 ? "s" : ""} to report
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pending.map((p) => (
                        <span key={p.at} className="inline-flex overflow-hidden rounded-full bg-sky-600 font-medium text-white shadow-sm">
                          <button onClick={() => finishPending(p)} className="py-2 pl-3.5 pr-2">
                            Finish · {new Date(p.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </button>
                          <button onClick={() => dropPending(p)} aria-label="Delete this saved spot" className="border-l border-white/25 px-3">
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selected ? (
                  // A light is picked: one clear action for it, nothing competing.
                  <SignalCard signal={selected} onReport={() => reportLight(selected.id)} onClose={() => setSelectedId(null)} />
                ) : (
                  <>
                    <p className="text-xl font-bold">Report a broken traffic light</p>
                    <div className="mt-3 grid gap-2.5">
                      <button onClick={startReport} className="btn-primary flex w-full items-center justify-center gap-2.5">
                        <PinIcon /> I&apos;m at the light now
                      </button>
                      <button onClick={startPicking} className="btn-secondary flex w-full items-center justify-center gap-2.5">
                        <MapIcon /> Choose a light on the map
                      </button>
                    </div>
                    <p className="mt-2 text-center text-xs text-neutral-500">Already home? Choose it on the map, or search for the street above.</p>
                  </>
                )}

                {!selected && mine.length > 0 && (
                  <button onClick={() => setStep({ name: "mine" })} className="mt-2 w-full py-2 text-sm font-medium text-neutral-600">
                    Your reports ({mine.length})
                  </button>
                )}
                {!selected && <InstallHint />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- pieces ---

function XIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4zM9 4v13M15 6.5v13" />
    </svg>
  );
}

/** Search box floating over the top of the map, like Google Maps'. Results drop down below it, away from the phone's keyboard. */
function SearchBar({ signals, onChoose }: { signals: MapSignal[]; onChoose: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchSignals(signals, query), [signals, query]);
  const showList = open && query.trim().length > 0;

  return (
    <div className="absolute left-3 right-[4.25rem] top-3 z-20">
      <div className="flex h-[46px] items-center gap-2 rounded-full bg-white pl-4 pr-2 shadow-[0_1px_3px_rgb(60_64_67/0.3),0_4px_8px_3px_rgb(60_64_67/0.15)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} // let a tap on a result land first
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              onChoose(results[0].id);
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search a street, e.g. Triangle Rd"
          aria-label="Search for a traffic light by street"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500">
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      {showList && (
        <ul className="mt-2 max-h-[50dvh] overflow-y-auto rounded-3xl bg-white py-2 shadow-[0_1px_3px_rgb(60_64_67/0.3),0_4px_8px_3px_rgb(60_64_67/0.15)]">
          {results.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">No Hillsborough traffic light on a street like that.</li>}
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // keep the input focused until the choice is made
                onClick={() => {
                  onChoose(s.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-neutral-100"
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: OWNER_COLORS[s.ownerType] }} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block text-xs text-neutral-500">Fixed by {s.agency?.name ?? OWNER_LABELS[s.ownerType]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CloseButton({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 active:bg-neutral-200"
    >
      <XIcon />
    </button>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  return <p className={`mb-3 rounded-2xl p-3.5 text-sm ${tone === "ok" ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>{children}</p>;
}

/** Big round icon at the top of confirmation screens. */
function ResultIcon({ tone }: { tone: "ok" | "pin" }) {
  return (
    <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tone === "ok" ? "bg-green-100 text-green-700" : "bg-sky-100 text-sky-700"}`}>
      {tone === "ok" ? (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
          <path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
        </svg>
      )}
    </div>
  );
}

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
    <div className="mt-1 flex items-center justify-between gap-2 text-sm">
      <Link href="/install" className="py-2 font-medium text-sky-700">
        Add this app to your home screen →
      </Link>
      <button
        aria-label="Hide"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(INSTALL_HINT_KEY, "1");
          } catch {}
        }}
        className="p-2 text-neutral-400"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** "Who fixes it" key. Folded into a small pill so it doesn't cover the map; tap to open. */
function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="absolute left-3 top-[4.25rem] z-10 rounded-[20px] bg-white px-3.5 py-2.5 text-left text-xs text-neutral-800 shadow-[0_1px_3px_rgb(60_64_67/0.3),0_4px_8px_3px_rgb(60_64_67/0.15)]"
    >
      <span className="flex items-center gap-2 font-semibold">
        <span className="flex -space-x-1" aria-hidden>
          {(Object.keys(OWNER_COLORS) as (keyof typeof OWNER_COLORS)[]).map((t) => (
            <span key={t} className="inline-block h-3 w-3 rounded-full ring-2 ring-white" style={{ background: OWNER_COLORS[t] }} />
          ))}
        </span>
        Who fixes it
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
      {open && (
        <span className="mt-2 block space-y-1">
          {(Object.keys(OWNER_LABELS) as (keyof typeof OWNER_LABELS)[]).map((t) => (
            <span key={t} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: OWNER_COLORS[t] }} />
              {OWNER_LABELS[t]}
            </span>
          ))}
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-600/30" /> Has reports
          </span>
        </span>
      )}
    </button>
  );
}

function SafetyGate({ onContinue, onLater, onCancel }: { onContinue: () => void; onLater: () => void; onCancel: () => void }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xl font-bold">Are you driving?</p>
        <CloseButton onClick={onCancel} label="Cancel" />
      </div>
      <p className="mt-1 text-[15px] text-neutral-600">
        New Jersey law bans handheld phone use while driving. Only fill in a report as a passenger or once you&apos;re parked.
      </p>
      <div className="mt-4 grid gap-2.5">
        <button onClick={onContinue} className="btn-dark">
          I&apos;m a passenger or parked
        </button>
        <button onClick={onLater} className="rounded-[1.125rem] bg-sky-600 py-3.5 font-semibold text-white shadow-lg shadow-sky-600/20 active:scale-[0.99]">
          I&apos;m driving: save this spot for later
        </button>
      </div>
    </div>
  );
}

function SignalCard({ signal, onReport, onClose }: { signal: MapSignal; onReport: () => void; onClose: () => void }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-snug">{signal.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-600">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: OWNER_COLORS[signal.ownerType] }} />
            <span>
              Fixed by {signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}
              {signal.viaRef ? ` (${signal.viaRef})` : ""}
            </span>
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="mt-2.5">
        <StatusBadge signal={signal} />
      </div>
      <button onClick={onReport} className="btn-primary mt-4 w-full">
        Report this light
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
  return <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${styles[signal.status]}`}>{label}</span>;
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
      {/* Pinned to the top while the questions scroll, so the light's name and ✕ are always visible. */}
      <div className="sticky top-0 z-10 -mx-5 flex items-start justify-between gap-3 bg-white px-5 pb-3 pt-1 shadow-[0_10px_12px_-12px_rgb(0_0_0/0.25)]">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Reporting</p>
          <p className="text-xl font-bold leading-snug">{signal.name}</p>
          <p className="mt-0.5 text-sm text-neutral-600">Goes to {signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}</p>
        </div>
        <CloseButton onClick={onCancel} label="Cancel report" />
      </div>

      <Question label="What's wrong?" first>
        {(Object.keys(ISSUE_LABELS) as IssueType[]).map((t) => (
          <Chip key={t} active={issueType === t} onClick={() => setIssueType(t)}>
            {ISSUE_LABELS[t]}
          </Chip>
        ))}
      </Question>

      <Question label="How long did you wait?">
        {WAIT_CHOICES.map((w) => (
          <Chip key={w.label} active={waitSeconds === w.seconds} onClick={() => setWaitSeconds(w.seconds)}>
            {w.label}
          </Chip>
        ))}
      </Question>

      <Question label="Which way were you going?">
        {(["northbound", "eastbound", "southbound", "westbound"] as const).map((a) => (
          <Chip key={a} active={approach === a} onClick={() => setApproach(approach === a ? null : a)}>
            {a[0].toUpperCase() + a.slice(1)}
          </Chip>
        ))}
      </Question>

      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-semibold">
          Anything else? <span className="font-normal text-neutral-500">(optional)</span>
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="e.g. left-turn arrow never comes on"
          className="w-full rounded-2xl border-0 bg-neutral-100 px-4 py-3 text-base outline-none ring-sky-500 placeholder:text-neutral-400 focus:bg-white focus:ring-2"
        />
      </label>

      {/* Stays at the bottom of the sheet while the questions scroll, so Send is always in reach. */}
      <div className="sticky bottom-0 -mx-5 mt-4 bg-gradient-to-t from-white from-70% to-white/0 px-5 pb-1 pt-4">
        <button disabled={busy} className="btn-primary w-full disabled:opacity-60">
          {busy ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}

function Question({ label, first, children }: { label: string; first?: boolean; children: React.ReactNode }) {
  return (
    <fieldset className={first ? "mt-3" : "mt-5"}>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function SentCard({ signal, duplicate, onDone, onUndo }: { signal: MapSignal; duplicate: boolean; onDone: () => void; onUndo: () => Promise<void> }) {
  const [undoing, setUndoing] = useState(false);
  return (
    <div className="text-center">
      <ResultIcon tone="ok" />
      <p className="mt-3 text-xl font-bold">{duplicate ? "Already got it, thanks!" : "Report sent"}</p>
      <p className="mt-1 text-[15px] text-neutral-600">
        {signal.name} now has <strong>{signal.recentReports}</strong> report{signal.recentReports === 1 ? "" : "s"}. Once 3 people report it, we send one
        summary to <strong>{signal.agency?.name ?? OWNER_LABELS[signal.ownerType]}</strong>.
      </p>
      <FixAlertForm signalId={signal.id} />
      <button onClick={onDone} className="btn-dark mt-4 w-full">
        Done
      </button>
      <button
        disabled={undoing}
        onClick={async () => {
          setUndoing(true);
          await onUndo();
          setUndoing(false);
        }}
        className="mt-1 w-full py-3 text-sm font-medium text-neutral-500 disabled:opacity-50"
      >
        {undoing ? "Taking it back…" : "Made a mistake? Undo this report"}
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
    return <p className="mt-4 rounded-2xl bg-green-50 p-3.5 text-sm text-green-900">We&apos;ll email you once when it&apos;s fixed, then delete your address.</p>;
  }

  return (
    <form
      className="mt-4 rounded-2xl bg-neutral-50 p-4 text-left ring-1 ring-black/5"
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
      <div className="mt-2 flex gap-2">
        <input
          id="fix-alert-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-xl border-0 bg-white px-3.5 py-2.5 text-base outline-none ring-1 ring-neutral-200 focus:ring-2 focus:ring-sky-500"
        />
        <button disabled={state === "busy"} className="rounded-xl bg-sky-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60">
          {state === "busy" ? "…" : "Notify me"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-neutral-500">One email, only about this light. We delete your address after sending it.</p>
    </form>
  );
}

function SavedCard({ nearName, onDone, onUndo }: { nearName: string | null; onDone: () => void; onUndo: () => void }) {
  return (
    <div className="text-center">
      <ResultIcon tone="pin" />
      <p className="mt-3 text-xl font-bold">Spot saved</p>
      <p className="mt-1 text-[15px] text-neutral-600">
        {nearName ? (
          <>
            Near <strong>{nearName}</strong>.
          </>
        ) : (
          "There's no traffic light within 60 m of this spot, so you'll pick the light on the map when you finish."
        )}{" "}
        Nothing has been sent yet. Once you&apos;re parked, open the app and tap <strong>Finish</strong>.
      </p>
      <button onClick={onDone} className="btn-dark mt-4 w-full">
        OK
      </button>
      <button onClick={onUndo} className="mt-1 w-full py-3 text-sm font-medium text-neutral-500">
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
      <div className="flex items-start justify-between gap-3">
        <p className="text-xl font-bold">No traffic light right here</p>
        <CloseButton onClick={onDone} />
      </div>
      <p className="mt-1 text-[15px] text-neutral-600">
        We only cover Hillsborough&apos;s traffic lights, and none is within 60 m (200 ft) of you. If you already drove away from the light, find it on the map and tap it.
      </p>
      {nearest && miles < 2 && (
        <button onClick={() => onPick(nearest.signal.id)} className="mt-3 w-full rounded-2xl bg-neutral-50 p-4 text-left ring-1 ring-black/5 active:bg-neutral-100">
          <span className="block text-xs text-neutral-500">
            Closest light · {miles < 0.1 ? `${Math.round(nearest.distance * 3.28)} ft` : `${miles.toFixed(1)} mi`} away
          </span>
          <span className="mt-0.5 block font-semibold">{nearest.signal.name}</span>
          <span className="mt-1 block text-sm font-semibold text-red-700">Report this light →</span>
        </button>
      )}
      <button onClick={onDone} className="btn-dark mt-3 w-full">
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold">Your reports</p>
          <p className="text-sm text-neutral-600">From this phone, in the last 30 days</p>
        </div>
        <CloseButton onClick={onDone} />
      </div>
      {reports.length === 0 && <p className="mt-4 text-sm text-neutral-600">None right now.</p>}
      <ul className="mt-3 divide-y divide-neutral-100">
        {reports.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-3">
            <button onClick={() => onShow(r.signalId)} className="min-w-0 text-left">
              <span className="block truncate font-medium">{name(r.signalId)}</span>
              <span className="block text-xs text-neutral-500">
                {ISSUE_LABELS[r.issueType]} · {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
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
              className="shrink-0 rounded-full bg-neutral-100 px-3.5 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
            >
              {busyId === r.id ? "…" : "Take back"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2.5 text-sm font-medium transition active:scale-[0.97] ${active ? "bg-neutral-900 text-white shadow-sm" : "bg-neutral-100 text-neutral-800"}`}
    >
      {children}
    </button>
  );
}

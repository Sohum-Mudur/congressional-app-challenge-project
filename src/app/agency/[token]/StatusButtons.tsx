"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SignalStatus } from "@/lib/types";

export default function StatusButtons({ token, signalId, status }: { token: string; signalId: string; status: SignalStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: "acknowledged" | "fixed") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agency/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signalId, status: next }),
    });
    setBusy(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't update.");
    else router.refresh();
  }

  if (status === "fixed") return <span className="rounded-full bg-green-100 px-3 py-1.5 text-sm font-semibold text-green-800">Fixed ✓</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {status !== "acknowledged" && (
          <button disabled={busy} onClick={() => set("acknowledged")} className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50">
            We&apos;re on it
          </button>
        )}
        <button disabled={busy} onClick={() => set("fixed")} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Mark fixed
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

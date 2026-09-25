"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RunDigestButton() {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    const res = await fetch("/api/digest", { method: "POST" });
    const body = await res.json();
    setResult(body.results?.length ? `${body.results.length} digest(s) created` : "No signals have reached the threshold yet");
    router.refresh();
  }

  return (
    <div className="text-right">
      <button onClick={run} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white">
        Run digest now
      </button>
      {result && <p className="mt-1 text-xs text-neutral-600">{result}</p>}
    </div>
  );
}

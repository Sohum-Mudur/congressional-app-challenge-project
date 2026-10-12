"use client";

import { useEffect, useState } from "react";
import { useIsInstalled } from "@/components/install";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Android/Chrome can install with one tap. iPhones can't, so they get the written steps instead. */
export default function InstallButton() {
  const installed = useIsInstalled();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed || accepted) {
    return <p className="mt-4 rounded-xl bg-green-50 p-3 font-medium text-green-900">✅ The app is installed on this device.</p>;
  }
  if (!prompt) return null;

  return (
    <button
      onClick={async () => {
        await prompt.prompt();
        if ((await prompt.userChoice).outcome === "accepted") setAccepted(true);
        setPrompt(null);
      }}
      className="mt-4 w-full rounded-xl bg-red-600 py-4 text-lg font-bold text-white shadow"
    >
      Install the app
    </button>
  );
}

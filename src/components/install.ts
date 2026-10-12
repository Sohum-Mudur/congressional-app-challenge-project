"use client";

import { useSyncExternalStore } from "react";

/** True when the app was opened from the home screen icon rather than in a browser tab. */
export function useIsInstalled(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
    () => true, // on the server, assume installed so no install hint flashes before the page loads
  );
}

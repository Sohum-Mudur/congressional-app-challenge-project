// Find traffic lights by street name, the way people actually type them: "triangle rd", "rt 206", "amwell and 206".

import type { Signal } from "./signals";

/** Common abbreviations, so "rd" finds "Road". */
const ABBREVIATIONS: Record<string, string> = {
  rd: "road",
  ave: "avenue",
  av: "avenue",
  st: "street",
  ln: "lane",
  blvd: "boulevard",
  dr: "drive",
  ct: "court",
  pkwy: "parkway",
  hwy: "highway",
  mt: "mount",
};

/** Words that don't help find a light. "Route 206" should match "US 206". */
const IGNORED = new Set(["and", "&", "at", "the", "route", "rt", "rte", "us", "nj", "cr", "county", "of", "light", "intersection"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function searchText(signal: Pick<Signal, "name" | "roads">): string[] {
  return words([signal.name, ...signal.roads.flatMap((r) => [r.name ?? "", r.ref ?? ""])].join(" "));
}

/** Lights whose name or route numbers contain every word typed, best matches first. Empty query: nothing. */
export function searchSignals<T extends Pick<Signal, "name" | "roads">>(signals: readonly T[], query: string, limit = 8): T[] {
  const terms = words(query)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .filter((w) => !IGNORED.has(w));
  if (!terms.length) return [];

  return signals
    .map((signal) => {
      const text = searchText(signal);
      // Every term must start some word ("tri" finds "Triangle"); exact word matches rank higher.
      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 2;
        else if (text.some((w) => w.startsWith(term))) score += 1;
        else return null;
      }
      return { signal, score };
    })
    .filter((x): x is { signal: T; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.signal.name.localeCompare(b.signal.name))
    .slice(0, limit)
    .map((x) => x.signal);
}

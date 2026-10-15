// Some lights sit on just one road (shopping-center entrances, crosswalks, highway ramps), so their name is only
// "US 22", and one town can have five of them. This gives each a landmark: "US 22 near Somerset Street", using the
// nearest other named road in OpenStreetMap. Only names change; ids and owners stay the same.
//
//   npm run name:lights        (after npm run import:signals)

import { readdir, readFile, writeFile } from "node:fs/promises";
import { distanceMeters, type LatLng } from "../src/lib/geo";
import type { Signal } from "../src/lib/signals";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_M = 150;

type Way = { type: "way"; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };

/** Distance from a point to a polyline, in meters (good enough at street scale). */
function distanceToLine(p: LatLng, line: LatLng[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    best = Math.min(best, distanceMeters(p, line[i]));
    if (i === 0) continue;
    // Project onto the segment in a local flat approximation.
    const [a, b] = [line[i - 1], line[i]];
    const k = Math.cos((p.lat * Math.PI) / 180);
    const [ax, ay, bx, by, px, py] = [a.lng * k, a.lat, b.lng * k, b.lat, p.lng * k, p.lat];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
    best = Math.min(best, distanceMeters(p, { lat: (ay + t * (by - ay)), lng: (ax + t * (bx - ax)) / k }));
  }
  return best;
}

/** "north", "east", ... for where a light sits relative to the middle of its group. */
function sideOf(center: LatLng, p: LatLng): string {
  const dLat = p.lat - center.lat;
  const dLng = (p.lng - center.lng) * Math.cos((center.lat * Math.PI) / 180);
  return Math.abs(dLat) >= Math.abs(dLng) ? (dLat >= 0 ? "north" : "south") : dLng >= 0 ? "east" : "west";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Rename each one-road light after the nearest other named street. */
async function nameLonely(lonely: Signal[]) {
  const query = `[out:json][timeout:120];(${lonely.map((s) => `way(around:${SEARCH_RADIUS_M},${s.lat},${s.lng})["highway"]["name"];`).join("")});out tags geom;`;
  let ways: Way[] = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "traffix-student-project/0.1 (Congressional App Challenge)" },
      body: new URLSearchParams({ data: query }),
    });
    if (res.ok) {
      ways = ((await res.json()) as { elements: Way[] }).elements.filter((e) => e.type === "way" && e.geometry);
      break;
    }
    console.warn(`Overpass returned HTTP ${res.status}, retrying (${attempt}/4)…`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }

  let renamed = 0;
  for (const s of lonely) {
    const own = new Set(s.roads.flatMap((r) => [r.name, r.ref]).filter(Boolean).map((x) => norm(x!)));
    const nearest = ways
      .filter((w) => !own.has(norm(w.tags!.name)) && !(w.tags!.ref && own.has(norm(w.tags!.ref))))
      .map((w) => ({ name: w.tags!.name, d: distanceToLine(s, w.geometry!.map((g) => ({ lat: g.lat, lng: g.lon }))) }))
      .filter((x) => x.d <= SEARCH_RADIUS_M)
      .sort((a, b) => a.d - b.d)[0];
    if (nearest) {
      s.name = `${s.name} near ${nearest.name}`;
      renamed++;
    }
  }
  console.log(`Named ${renamed} of ${lonely.length} single-road lights after a nearby street.`);
}

async function main() {
  const files = (await readdir("data/signals")).filter((f) => f.endsWith(".json"));
  const byFile = new Map<string, Signal[]>();
  for (const f of files) byFile.set(f, JSON.parse(await readFile(`data/signals/${f}`, "utf8")));
  const lonely = [...byFile.values()].flat().filter((s) => s.roads.filter((r) => r.name || r.ref).length <= 1 && !s.name.includes(" near "));
  if (lonely.length) await nameLonely(lonely);

  // Lights that still share a name in the same town (often the two sides of a divided highway): add which side.
  // Once told apart, names are unique, so running this again changes nothing.
  const all = [...byFile.values()].flat();
  const groups = new Map<string, Signal[]>();
  for (const s of all) groups.set(`${s.municipality}|${s.name}`, [...(groups.get(`${s.municipality}|${s.name}`) ?? []), s]);
  let sided = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const center = { lat: group.reduce((t, s) => t + s.lat, 0) / group.length, lng: group.reduce((t, s) => t + s.lng, 0) / group.length };
    const sides = group.map((s) => sideOf(center, s));
    group.forEach((s, i) => {
      // If two lights land on the same side, number them instead.
      s.name += sides.filter((x) => x === sides[i]).length === 1 ? ` (${sides[i]} side)` : ` (${i + 1} of ${group.length})`;
      sided++;
    });
  }

  for (const [f, signals] of byFile) await writeFile(`data/signals/${f}`, JSON.stringify(signals, null, 2) + "\n");
  console.log(`Told apart ${sided} lights that shared a name in the same town.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

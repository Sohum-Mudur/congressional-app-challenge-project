// Pull every traffic signal in a municipality from OpenStreetMap, work out who owns each one,
// and write the result to data/signals/<slug>.json.
//
//   npm run import:signals -- "Hillsborough Township" "Somerset"
//
// Later this same data gets upserted into Supabase; the JSON file keeps the app usable offline
// and makes the import easy to review in a pull request.

import { mkdir, writeFile } from "node:fs/promises";
import { buildSignals, type RawSignalNode } from "../src/lib/signals";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type OsmNode = { type: "node"; id: number; lat: number; lon: number };
type OsmWay = { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> };

async function fetchOsm(municipality: string) {
  // `out body` on ways includes their node lists, so we can tell which roads touch which signal.
  const query = `[out:json][timeout:90];
    area["name"="${municipality}"]["boundary"="administrative"]["admin_level"="8"]->.town;
    node(area.town)["highway"="traffic_signals"]->.signals;
    .signals out;
    way(bn.signals)["highway"]["highway"!~"service|footway|cycleway|path"];
    out body;`;

  // The public Overpass server rate-limits (HTTP 429/504), so retry with a growing delay.
  let res: Response | undefined;
  for (let attempt = 1; attempt <= 4; attempt++) {
    res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "signal-app-student-project/0.1 (Congressional App Challenge)",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
    });
    if (res.ok) break;
    console.warn(`Overpass returned HTTP ${res.status}, retrying (${attempt}/4)…`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
  if (!res?.ok) throw new Error(`Overpass returned HTTP ${res?.status}`);
  const json = (await res.json()) as { elements: (OsmNode | OsmWay)[] };
  return {
    nodes: json.elements.filter((e): e is OsmNode => e.type === "node"),
    ways: json.elements.filter((e): e is OsmWay => e.type === "way"),
  };
}

async function main() {
  const [municipality = "Hillsborough Township", county = "Somerset"] = process.argv.slice(2);
  console.log(`Fetching signals for ${municipality}, ${county} County…`);
  const { nodes, ways } = await fetchOsm(municipality);

  const raw: RawSignalNode[] = nodes.map((node) => ({
    osmNodeId: node.id,
    lat: node.lat,
    lng: node.lon,
    roads: ways
      .filter((w) => w.nodes.includes(node.id))
      .map((w) => ({ name: w.tags?.name ?? null, ref: w.tags?.ref ?? null })),
  }));
  const signals = buildSignals(raw, { municipality, county });

  const counts = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.ownerType] = (acc[s.ownerType] ?? 0) + 1;
    return acc;
  }, {});

  const slug = municipality.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await mkdir("data/signals", { recursive: true });
  await writeFile(`data/signals/${slug}.json`, JSON.stringify(signals, null, 2) + "\n");
  console.log(`${nodes.length} OSM nodes -> ${signals.length} signals in data/signals/${slug}.json`, counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

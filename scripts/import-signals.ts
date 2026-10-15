// Pull every traffic signal in a municipality from OpenStreetMap, work out who owns each one,
// and write the result to data/signals/<slug>.json.
//
//   npm run import:signals -- "Hillsborough Township" "Somerset"   # one town
//   npm run import:signals -- --somerset                           # all 21 towns in Somerset County, NJ
//
// Later this same data gets upserted into Supabase; the JSON file keeps the app usable offline
// and makes the import easy to review in a pull request.

import { mkdir, writeFile } from "node:fs/promises";
import { buildSignals, type RawSignalNode, type Signal } from "../src/lib/signals";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type OsmNode = { type: "node"; id: number; lat: number; lon: number };
type OsmWay = { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> };

/**
 * Somerset County, NJ's 21 municipalities, with their OpenStreetMap boundary ids. Ids, not names, because names
 * repeat across states and counties (there are several Franklin Townships in New Jersey alone).
 */
const SOMERSET_TOWNS: [name: string, osmRelationId: number][] = [
  ["Bedminster Township", 963375],
  ["Bernards Township", 963377],
  ["Bernardsville", 170463],
  ["Bound Brook", 170466],
  ["Branchburg Township", 963382],
  ["Bridgewater Township", 963381],
  ["Far Hills", 170464],
  ["Franklin Township", 961160],
  ["Green Brook Township", 963380],
  ["Hillsborough Township", 963383],
  ["Manville", 170926],
  ["Millstone", 170927],
  ["Montgomery Township", 963379],
  ["North Plainfield", 170468],
  ["Peapack-Gladstone", 170461],
  ["Raritan", 170844],
  ["Rocky Hill", 170928],
  ["Somerville", 170843],
  ["South Bound Brook", 170465],
  ["Warren Township", 963376],
  ["Watchung", 170469],
];

/** Overpass "area" ids are relation ids plus 3,600,000,000. */
const areaFor = (municipality: string, relationId?: number) =>
  relationId
    ? `area(${3_600_000_000 + relationId})->.town;`
    : `area["name"="${municipality}"]["boundary"="administrative"]["admin_level"="8"]->.town;`;

async function fetchOsm(municipality: string, relationId?: number) {
  // `out body` on ways includes their node lists, so we can tell which roads touch which signal.
  const query = `[out:json][timeout:90];
    ${areaFor(municipality, relationId)}
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

async function importTown(municipality: string, county: string, relationId?: number) {
  const { nodes, ways } = await fetchOsm(municipality, relationId);
  const raw: RawSignalNode[] = nodes.map((node) => ({
    osmNodeId: node.id,
    lat: node.lat,
    lng: node.lon,
    roads: ways
      .filter((w) => w.nodes.includes(node.id))
      .map((w) => ({ name: w.tags?.name ?? null, ref: w.tags?.ref ?? null })),
  }));
  return { signals: buildSignals(raw, { municipality, county }), nodeCount: nodes.length };
}

async function save(municipality: string, signals: Signal[]) {
  const slug = municipality.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await mkdir("data/signals", { recursive: true });
  await writeFile(`data/signals/${slug}.json`, JSON.stringify(signals, null, 2) + "\n");
  return `data/signals/${slug}.json`;
}

const countByOwner = (signals: Signal[]) =>
  signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.ownerType] = (acc[s.ownerType] ?? 0) + 1;
    return acc;
  }, {});

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--somerset") {
    // A light on a town line can be inside both towns' boundaries; keep it once, in the first town.
    const seen = new Set<number>();
    let total = 0;
    for (const [town, relationId] of SOMERSET_TOWNS) {
      const { signals } = await importTown(town, "Somerset", relationId);
      const fresh = signals.filter((s) => !s.osmNodeIds.some((id) => seen.has(id)));
      fresh.forEach((s) => s.osmNodeIds.forEach((id) => seen.add(id)));
      const file = await save(town, fresh);
      total += fresh.length;
      console.log(`${town.padEnd(22)} ${String(fresh.length).padStart(3)} lights -> ${file}`, countByOwner(fresh));
      await new Promise((r) => setTimeout(r, 2000)); // be polite to the free Overpass server
    }
    console.log(`Somerset County: ${total} lights in ${SOMERSET_TOWNS.length} towns`);
    return;
  }

  const [municipality = "Hillsborough Township", county = "Somerset"] = args;
  console.log(`Fetching signals for ${municipality}, ${county} County…`);
  const { signals, nodeCount } = await importTown(municipality, county);
  const file = await save(municipality, signals);
  console.log(`${nodeCount} OSM nodes -> ${signals.length} signals in ${file}`, countByOwner(signals));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

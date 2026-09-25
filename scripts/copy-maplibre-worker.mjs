// MapLibre runs map parsing in a Web Worker that loads `maplibre-gl-shared.mjs` from next to itself.
// Bundlers can't follow that, so copy both files to public/ and point MapLibre at them (see SignalMap.tsx).
import { copyFile, mkdir } from "node:fs/promises";

const from = "node_modules/maplibre-gl/dist";
const to = "public/maplibre";
await mkdir(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(`${from}/${file}`, `${to}/${file}`);
}
console.log(`Copied MapLibre worker to ${to}/`);

// Load signals (data/signals/*.json) and agencies (data/agencies.json) into the database.
//
//   npm run db:seed
//
// Upserts, so it's safe to re-run after `npm run import:signals`. Existing statuses, reports
// and agency manage tokens are kept.

import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";
import type { Signal } from "../src/lib/signals";
import type { Agency } from "../src/lib/types";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

const sql = postgres(url, { onnotice: () => {} });

async function main() {
  const agencies = JSON.parse(await readFile("data/agencies.json", "utf8")) as Agency[];
  for (const a of agencies) {
    await sql`
      insert into agencies (id, name, type, county, municipality, email, form_url, phone, source_url, verified)
      values (${a.id}, ${a.name}, ${a.type}, ${a.county}, ${a.municipality}, ${a.email}, ${a.formUrl}, ${a.phone}, ${a.sourceUrl}, ${a.verified})
      on conflict (id) do update set
        name = excluded.name, type = excluded.type, county = excluded.county, municipality = excluded.municipality,
        email = excluded.email, form_url = excluded.form_url, phone = excluded.phone,
        source_url = excluded.source_url, verified = excluded.verified`;
  }
  console.log(`agencies: ${agencies.length}`);

  const files = (await readdir("data/signals")).filter((f) => f.endsWith(".json"));
  let count = 0;
  for (const file of files) {
    const signals = JSON.parse(await readFile(`data/signals/${file}`, "utf8")) as Signal[];
    for (const s of signals) {
      await sql`
        insert into signals (id, osm_node_ids, lat, lng, name, roads, owner_type, via_ref, municipality, county)
        values (${s.id}, ${s.osmNodeIds}, ${s.lat}, ${s.lng}, ${s.name}, ${sql.json(s.roads)}, ${s.ownerType}, ${s.viaRef}, ${s.municipality}, ${s.county})
        on conflict (id) do update set
          osm_node_ids = excluded.osm_node_ids, lat = excluded.lat, lng = excluded.lng, name = excluded.name,
          roads = excluded.roads, owner_type = excluded.owner_type, via_ref = excluded.via_ref,
          municipality = excluded.municipality, county = excluded.county`;
      count++;
    }
  }
  console.log(`signals: ${count}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());

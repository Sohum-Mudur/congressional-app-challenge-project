// Apply any SQL files in supabase/migrations that haven't been applied yet, in filename order.
//
//   npm run db:migrate
//
// Needs DATABASE_URL in .env.local. Each file runs in a transaction and is recorded in
// public._migrations, so running this twice is safe.

import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

const sql = postgres(url, { onnotice: () => {} });

async function main() {
  await sql`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table public._migrations enable row level security`;
  const done = new Set((await sql<{ name: string }[]>`select name from public._migrations`).map((r) => r.name));

  const files = (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(`supabase/migrations/${file}`, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public._migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log("database is up to date");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());

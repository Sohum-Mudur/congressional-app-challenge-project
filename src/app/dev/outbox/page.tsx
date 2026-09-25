import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Email } from "@/lib/email";
import RunDigestButton from "./RunDigestButton";

export const dynamic = "force-dynamic";

/** Development only: preview digest emails that would have been sent (saved when no Resend key is set). */
export default async function OutboxPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const dir = path.join(process.cwd(), ".data", "outbox");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort().reverse();
  const emails = await Promise.all(files.map(async (f) => ({ id: f, ...(JSON.parse(await readFile(path.join(dir, f), "utf8")) as Email) })));

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dev outbox</h1>
        <RunDigestButton />
      </div>
      <p className="mt-1 text-sm text-neutral-600">Emails saved locally because no RESEND_API_KEY is set. Newest first.</p>
      {emails.length === 0 && <p className="mt-6 text-neutral-600">Nothing yet.</p>}
      {emails.map((e) => (
        <article key={e.id} className="mt-4 rounded-xl bg-white p-4 ring-1 ring-black/5">
          <p className="text-xs text-neutral-500">To: {e.to}</p>
          <p className="font-semibold">{e.subject}</p>
          <div className="mt-3 border-t border-neutral-100 pt-3" dangerouslySetInnerHTML={{ __html: e.html }} />
        </article>
      ))}
    </main>
  );
}

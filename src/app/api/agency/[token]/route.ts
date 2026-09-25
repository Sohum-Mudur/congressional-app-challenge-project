import type { NextRequest } from "next/server";
import { z } from "zod";
import { agencyIdFor } from "@/lib/agencies";
import { getStore } from "@/lib/store";

const StatusInput = z.object({
  signalId: z.string().min(1),
  status: z.enum(["acknowledged", "fixed"]),
});

/** Agency staff mark one of their signals acknowledged or fixed, using the secret link from the digest email. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/agency/[token]">) {
  const { token } = await ctx.params;
  const store = getStore();
  const agency = await store.agencyForToken(token);
  if (!agency) return Response.json({ error: "This link is not valid." }, { status: 404 });

  const parsed = StatusInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const signal = (await store.listSignals()).find((s) => s.id === parsed.data.signalId);
  if (!signal || agencyIdFor(signal) !== agency.id) {
    return Response.json({ error: "That signal isn't managed by your agency." }, { status: 403 });
  }

  await store.setSignalStatus([signal.id], parsed.data.status);
  // TODO(supabase): when accounts exist, email reporters who opted in that the light was fixed.
  return Response.json({ ok: true });
}

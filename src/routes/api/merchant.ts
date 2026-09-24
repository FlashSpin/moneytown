import { createFileRoute } from "@tanstack/react-router";

/**
 * The Merchant guild. GET (public): the paper ISA, the guild's book and the
 * latest lab verdict. POST (behind CRON_SECRET): the merchant workflow
 * (scripts/merchant-lab.ts) hands in recent daily prices and the lab's run;
 * the paper ISA steps through every new trading day.
 */
async function read(): Promise<Response> {
  const { loadMerchant } = await import("@/lib/merchant.server");
  const s = await loadMerchant();
  return Response.json({ isa: s.isa ?? null, book: s.book, lastRun: s.lastRun ?? null });
}

async function write(request: Request): Promise<Response> {
  const { bearerOk } = await import("@/lib/seal.server");
  if (!bearerOk(request)) return new Response("Unauthorized", { status: 401 });
  const text = await request.text();
  if (text.length > 3_000_000) return Response.json({ ok: false, error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "not JSON" }, { status: 400 });
  }
  const { takeMerchantPost } = await import("@/lib/merchant.server");
  const { recordRun } = await import("@/lib/jobs.server");
  const { requestIdOf } = await import("@/lib/log.server");
  try {
    const r = await recordRun("merchant", { requestId: requestIdOf(request), source: "cron" }, async () => {
      const out = await takeMerchantPost(body);
      return { outcome: "ok", summary: out, result: out };
    });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 422 });
  }
}

export const Route = createFileRoute("/api/merchant")({
  server: {
    handlers: {
      GET: () => read(),
      POST: ({ request }) => write(request),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

/**
 * The trading tick (src/lib/trade-run.server.ts): every villager's strategy
 * scans the live prices and trades by its rules, the trading desk lets them
 * place their own trades with the AI when they asked to look again, every
 * purse is reconciled against the ledger first, and risk limits gate every
 * new trade. Called by schedulers with `Authorization: Bearer <CRON_SECRET>`
 * (.github/workflows/trading.yml, or an external cron). Open pages also keep
 * it running through /api/heartbeat. `?force=1` (still behind the secret)
 * skips the too-soon guard and asks the trading desk now.
 */
const MIN_GAP_MS = 3 * 60_000;

async function trade(request: Request): Promise<Response> {
  const { bearerOk } = await import("@/lib/seal.server");
  if (!bearerOk(request)) return new Response("Unauthorized", { status: 401 });
  const { requestIdOf } = await import("@/lib/log.server");
  const { runTradeOnce } = await import("@/lib/trade-run.server");
  const requestId = requestIdOf(request);
  const forced = new URL(request.url).searchParams.get("force") === "1";
  const r = await runTradeOnce({ forced, minGapMs: MIN_GAP_MS, requestId, source: request.headers.get("x-source") ?? "cron" });
  return Response.json({ ...r.body, requestId }, { status: r.status, headers: { "x-request-id": requestId } });
}

export const Route = createFileRoute("/api/trade")({
  server: {
    handlers: {
      GET: ({ request }) => trade(request),
      POST: ({ request }) => trade(request),
    },
  },
});

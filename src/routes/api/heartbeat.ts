import { createFileRoute } from "@tanstack/react-router";

/**
 * The self-healing schedule. Open pages call this (POST) when the last
 * trading tick is overdue — GitHub's 5-minute schedule is often late or
 * skipped entirely — and it runs one tick only if none has run for
 * HEARTBEAT_GAP_MS, so however many pages call, the parish still trades at
 * most once per gap (the tick itself re-checks the gap before saving). No
 * secret, no parameters, nothing else it can do.
 */
const HEARTBEAT_GAP_MS = 5.5 * 60_000;
/** Per server instance: ignore calls closer together than this. */
const INSTANCE_THROTTLE_MS = 20_000;
let lastCall = 0;

async function beat(request: Request): Promise<Response> {
  const now = Date.now();
  if (now - lastCall < INSTANCE_THROTTLE_MS) return Response.json({ ok: true, ran: false, throttled: true });
  lastCall = now;
  const { requestIdOf } = await import("@/lib/log.server");
  const { runTradeOnce } = await import("@/lib/trade-run.server");
  const requestId = requestIdOf(request);
  const r = await runTradeOnce({ forced: false, minGapMs: HEARTBEAT_GAP_MS, requestId, source: "heartbeat" });
  return Response.json(
    { ok: r.body.ok !== false, ran: !r.body.skipped && r.body.ok !== false, requestId },
    { status: r.status === 200 ? 200 : 202, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/heartbeat")({
  server: {
    handlers: {
      POST: ({ request }) => beat(request),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron-only endpoint — advances the shared world by one day. Vercel Cron
 * (see vercel.json / the nitro config in vite.config.ts) calls this once
 * daily with a **GET** and automatically sends
 * `Authorization: Bearer <CRON_SECRET>` when that env var is set on the
 * project; POST is accepted too for manual runs. A `beforeLoad` redirect does
 * NOT protect a plain API route, so auth has to happen here, in the handler.
 */
async function tick(request: Request): Promise<Response> {
  const { bearerOk } = await import("@/lib/seal.server");
  if (!bearerOk(request)) return new Response("Unauthorized", { status: 401 });

  const { loadGuildWorld, saveNewDay } = await import("@/lib/world.server");
  const { runDailyTick } = await import("@/game/tick.server");
  const { recordRun } = await import("@/lib/jobs.server");
  const { log, requestIdOf } = await import("@/lib/log.server");
  const requestId = requestIdOf(request);
  const forced = new URL(request.url).searchParams.get("force") === "1";

  const result = await recordRun<{ status: number; body: Record<string, unknown> }>("dawn", { requestId, source: "cron" }, async () => {
    let row = await loadGuildWorld();
    const fromDay = row.day;
    const hoursSinceUpdate = (Date.now() - new Date(row.updated_at).getTime()) / 3_600_000;
    if (hoursSinceUpdate < 20 && !forced) {
      // Guards against a double-invocation (retry, duplicate cron registration,
      // accidental manual call) advancing the world twice inside one real day.
      // `?force=1` (still behind the same secret) bypasses this for testing.
      return { outcome: "skipped", result: { status: 200, body: { ok: true, skipped: true, day: row.day } } };
    }
    // The new day saves only if the row is unchanged and still on `fromDay`, so
    // two overlapping calls can't both advance it. A market day or petition
    // landing meanwhile just means dawn is re-run on the fresh row.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        row = await loadGuildWorld();
        if (row.day !== fromDay) return { outcome: "skipped", result: { status: 200, body: { ok: true, skipped: true, day: row.day } } };
      }
      const next = await runDailyTick(row.state);
      if (await saveNewDay(next, row.rev)) {
        // Once a day, drop job runs past their retention.
        const { pruneJobRuns } = await import("@/lib/jobs.server");
        await pruneJobRuns().catch((e: unknown) =>
          log("warn", "dawn.prune_failed", { requestId, error: e instanceof Error ? e.message : String(e) }),
        );
        const living = next.subjects.filter((s) => s.state !== "condemned" && s.state !== "hanging").length;
        return { outcome: "ok", summary: { day: next.day, living, attempts: attempt + 1 }, result: { status: 200, body: { ok: true, day: next.day } } };
      }
    }
    throw new Error("world kept changing; try again");
  }).catch((e: unknown) => ({ status: 409, body: { ok: false, error: e instanceof Error ? e.message : "failed" } }));
  return Response.json({ ...result.body, requestId }, { status: result.status, headers: { "x-request-id": requestId } });
}

export const Route = createFileRoute("/api/tick")({
  server: {
    handlers: {
      GET: ({ request }) => tick(request),
      POST: ({ request }) => tick(request),
    },
  },
});

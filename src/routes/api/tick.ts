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
  const { env } = await import("@/lib/env.server");
  const secret = env("CRON_SECRET");
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { loadWorldRow, saveNewDay } = await import("@/lib/world.server");
  const { runDailyTick } = await import("@/game/tick.server");

  let row = await loadWorldRow();
  const fromDay = row.day;
  const hoursSinceUpdate = (Date.now() - new Date(row.updated_at).getTime()) / 3_600_000;
  const forced = new URL(request.url).searchParams.get("force") === "1";
  if (hoursSinceUpdate < 20 && !forced) {
    // Guards against a double-invocation (retry, duplicate cron registration,
    // accidental manual call) advancing the world twice inside one real day.
    // `?force=1` (still behind the same secret) bypasses this for testing.
    return Response.json({ ok: true, skipped: true, day: row.day });
  }

  // The new day saves only if the row is unchanged and still on `fromDay`, so
  // two overlapping calls can't both advance it. A trade tick or petition
  // landing meanwhile just means dawn is re-run on the fresh row.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      row = await loadWorldRow();
      if (row.day !== fromDay) return Response.json({ ok: true, skipped: true, day: row.day });
    }
    const next = await runDailyTick(row.state);
    if (await saveNewDay(next, row.rev)) return Response.json({ ok: true, day: next.day });
  }
  return Response.json({ ok: false, error: "world kept changing; try again" }, { status: 409 });
}

export const Route = createFileRoute("/api/tick")({
  server: {
    handlers: {
      GET: ({ request }) => tick(request),
      POST: ({ request }) => tick(request),
    },
  },
});

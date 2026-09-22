import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron-only endpoint — advances the shared world by one day. Vercel Cron
 * (see vercel.json) calls this once daily and automatically sends
 * `Authorization: Bearer <CRON_SECRET>` when that env var is set on the
 * project; a `beforeLoad` redirect does NOT protect a plain API route, so
 * auth has to happen here, in the handler itself.
 */
export const Route = createFileRoute("/api/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { env } = await import("@/lib/env.server");
        const secret = env("CRON_SECRET");
        const auth = request.headers.get("authorization");
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { loadWorldRow, saveWorld } = await import("@/lib/world.server");
        const { runDailyTick } = await import("@/game/tick.server");

        const row = await loadWorldRow();
        const hoursSinceUpdate = (Date.now() - new Date(row.updated_at).getTime()) / 3_600_000;
        const forced = new URL(request.url).searchParams.get("force") === "1";
        if (hoursSinceUpdate < 20 && !forced) {
          // Guards against a double-invocation (retry, accidental manual call)
          // advancing the world twice inside one real day. `?force=1` (still
          // behind the same secret) bypasses this for manual testing.
          return Response.json({ ok: true, skipped: true, day: row.day });
        }

        const next = await runDailyTick(row.state);
        await saveWorld(next);
        return Response.json({ ok: true, day: next.day });
      },
    },
  },
});

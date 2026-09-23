import { createFileRoute } from "@tanstack/react-router";

/**
 * The trading tick: every villager's strategy scans the live prices and
 * trades by its rules, and when the villagers asked to look again, the
 * trading desk lets them place their own trades with the AI. Called every 5 minutes by the GitHub Actions schedule
 * in .github/workflows/trading.yml with `Authorization: Bearer <CRON_SECRET>`.
 * `?force=1` (still behind the secret) skips the too-soon guard.
 */
const MIN_GAP_MS = 3 * 60_000;

async function trade(request: Request): Promise<Response> {
  const { env } = await import("@/lib/env.server");
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { loadWorldRow, saveWorldIfUnchanged } = await import("@/lib/world.server");
  const { runTradeTick } = await import("@/game/trade.server");

  let row = await loadWorldRow();
  const forced = new URL(request.url).searchParams.get("force") === "1";
  if (Date.now() - (row.state.lastTickAt ?? 0) < MIN_GAP_MS && !forced) {
    return Response.json({ ok: true, skipped: true });
  }
  // A petition or review may land at the same moment; re-read and retry rather than overwrite it.
  // The prices and the trading desk's answer are kept across retries, so the AI is asked once.
  const memo = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) row = await loadWorldRow();
    const before = row.state.trades?.[0]?.t ?? 0;
    const next = await runTradeTick(row.state, memo);
    if (await saveWorldIfUnchanged(next, row.rev)) {
      const fills = (next.trades ?? []).filter((t) => t.t > before).length;
      const open = next.subjects.filter((s) => s.position).length;
      const desk = next.desk && next.desk.at === next.lastTickAt ? { orders: next.desk.orders, mind: next.desk.brain?.label ?? "none answered" } : null;
      return Response.json({ ok: true, fills, openTrades: open, prices: next.tape.source, desk });
    }
  }
  return Response.json({ ok: false, error: "world kept changing; try again" }, { status: 409 });
}

export const Route = createFileRoute("/api/trade")({
  server: {
    handlers: {
      GET: ({ request }) => trade(request),
      POST: ({ request }) => trade(request),
    },
  },
});

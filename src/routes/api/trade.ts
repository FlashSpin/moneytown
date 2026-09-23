import { createFileRoute } from "@tanstack/react-router";

/**
 * The trading tick: every villager's strategy scans the live prices and
 * trades by its rules, and when the villagers asked to look again, the
 * trading desk lets them place their own trades with the AI. Before
 * trading, every purse is reconciled against the ledger; a mismatch halts
 * new trades (src/game/ledger.ts), and risk limits gate every new trade
 * (src/game/limits.ts). Called every 5 minutes by the GitHub Actions schedule
 * in .github/workflows/trading.yml with `Authorization: Bearer <CRON_SECRET>`.
 * `?force=1` (still behind the secret) skips the too-soon guard and asks the
 * trading desk now; the response says why the desk's AI didn't answer, if not.
 */
const MIN_GAP_MS = 3 * 60_000;

async function trade(request: Request): Promise<Response> {
  const { env } = await import("@/lib/env.server");
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { loadWorldAndLedger, saveWorldIfUnchanged } = await import("@/lib/world.server");
  const { runTradeTick } = await import("@/game/trade.server");
  const { withBookCheck } = await import("@/game/ledger");

  let row = await loadWorldAndLedger();
  const forced = new URL(request.url).searchParams.get("force") === "1";
  if (Date.now() - (row.state.lastTickAt ?? 0) < MIN_GAP_MS && !forced) {
    return Response.json({ ok: true, skipped: true });
  }
  // A petition or review may land at the same moment; re-read and retry rather than overwrite it.
  // The prices and the trading desk's answer are kept across retries, so the AI is asked once.
  const memo = { force: forced };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) row = await loadWorldAndLedger();
    const before = row.state.trades?.[0]?.t ?? 0;
    // Every purse is checked against the ledger first; a mismatch halts new trading.
    const next = await runTradeTick(withBookCheck(row.state, row.ledger, Date.now()), memo);
    if (await saveWorldIfUnchanged(next, row.rev)) {
      const fills = (next.trades ?? []).filter((t) => t.t > before).length;
      const open = next.subjects.filter((s) => s.position).length;
      const desk = next.desk && next.desk.at === next.lastTickAt ? {
              orders: next.desk.orders,
              skipped: next.desk.skipped ?? 0,
              mind: next.desk.brain?.label ?? "none answered",
              ...(next.desk.error ? { why: next.desk.error } : {}),
            } : null;
      // Keep the accepted prices for backtesting; a failure here never fails the tick.
      const { acceptedPrices, recordPrices } = await import("@/lib/history.server");
      await recordPrices(next.lastTickAt ?? Date.now(), acceptedPrices(next.ticks, next.lastTickAt ?? 0)).catch((e: unknown) =>
        console.warn("[trade] price history not recorded:", e),
      );
      const check = next.ledger?.check;
      return Response.json({
        ok: true,
        fills,
        openTrades: open,
        prices: next.tape.source,
        desk,
        books: check ? (check.ok ? "balanced" : { mismatched: check.diffs.length, total: check.total }) : "opening",
        halted: next.halt?.reason ?? null,
        blocked: next.risk?.blocked ?? {},
      });
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

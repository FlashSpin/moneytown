import { createFileRoute } from "@tanstack/react-router";

/**
 * Backtests. POST (behind CRON_SECRET, like the trading tick) runs one:
 * backfills Kraken's recent 5-minute candles for the market's coins, replays
 * the stored history through every strategy with hold-out and walk-forward
 * validation, and saves the run. `?days=` (default 30), `?coins=` (how many
 * of the market's coins, default 20), `?backfill=0` to skip the backfill.
 * GET returns the latest run (or `?id=`), or `?list=1` for every run.
 * Called by .github/workflows/backtest.yml.
 */
async function run(request: Request): Promise<Response> {
  const { env } = await import("@/lib/env.server");
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const count = Math.min(50, Math.max(1, Number(url.searchParams.get("coins")) || 20));
  const { loadWorldRow } = await import("@/lib/world.server");
  const { scanCoins } = await import("@/game/dawn");
  const { stakeSats } = await import("@/game/wallets");
  const { runAndSaveBacktest } = await import("@/lib/backtest.server");
  const row = await loadWorldRow();
  const coins = scanCoins(row.state.tape).slice(0, count);
  const stake = stakeSats(row.state.tape);
  try {
    const saved = await runAndSaveBacktest({
      days,
      coins,
      balance: stake,
      stakeSats: stake,
      backfill: url.searchParams.get("backfill") !== "0",
    });
    return Response.json({
      ok: true,
      id: saved.id,
      version: saved.version,
      bars: saved.data.bars,
      days: saved.results.days,
      backfill: saved.config.backfill,
      verdicts: Object.fromEntries(saved.results.kinds.map((k) => [k.kind, k.verdict])),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 422 });
  }
}

async function read(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { loadBacktestRun, listBacktestRuns } = await import("@/lib/backtest.server");
  if (url.searchParams.get("list") === "1") return Response.json({ runs: await listBacktestRuns() });
  const id = Number(url.searchParams.get("id")) || undefined;
  const found = await loadBacktestRun(id);
  return found ? Response.json(found) : Response.json({ error: "no backtest yet" }, { status: 404 });
}

export const Route = createFileRoute("/api/backtest")({
  server: {
    handlers: {
      GET: ({ request }) => read(request),
      POST: ({ request }) => run(request),
    },
  },
});

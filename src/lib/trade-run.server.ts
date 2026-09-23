/**
 * One trading tick, end to end — server-only. Shared by the cron route
 * (/api/trade, behind CRON_SECRET) and the page heartbeat (/api/heartbeat,
 * public but rate-limited by `minGapMs`):
 *   1. read the world and the ledger in one snapshot, skip if a tick ran
 *      within `minGapMs` (unless forced),
 *   2. check every purse against the ledger, run the tick, save the world
 *      and its postings atomically — on a lost race re-read, re-check the
 *      gap (so two callers can't both tick) and retry,
 *   3. keep the accepted prices for backtesting.
 * Every run is timed, logged and recorded (./jobs.server.ts).
 */
import { withBookCheck } from "@/game/ledger";
import { runTradeTick } from "@/game/trade.server";
import { acceptedPrices, recordPrices } from "./history.server";
import { recordRun } from "./jobs.server";
import { log } from "./log.server";
import { loadWorldAndLedger, saveWorldIfUnchanged } from "./world.server";

export type TradeRunResult = { status: number; body: Record<string, unknown> };

export async function runTradeOnce(opts: { forced: boolean; minGapMs: number; requestId: string; source: string }): Promise<TradeRunResult> {
  return recordRun<TradeRunResult>("trade", opts, async () => {
    let row = await loadWorldAndLedger();
    const tooSoon = () => !opts.forced && Date.now() - (row.state.lastTickAt ?? 0) < opts.minGapMs;
    if (tooSoon()) {
      return { outcome: "skipped", result: { status: 200, body: { ok: true, skipped: true, lastTickAt: row.state.lastTickAt ?? null } } };
    }
    // The prices and the trading desk's answer are kept across retries, so the AI is asked once.
    const memo = { force: opts.forced };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        row = await loadWorldAndLedger();
        // Someone else ticked while we worked: theirs stands.
        if (tooSoon()) return { outcome: "skipped", result: { status: 200, body: { ok: true, skipped: true, lastTickAt: row.state.lastTickAt ?? null } } };
      }
      const before = row.state.trades?.[0]?.t ?? 0;
      const next = await runTradeTick(withBookCheck(row.state, row.ledger, Date.now()), memo);
      if (!(await saveWorldIfUnchanged(next, row.rev))) continue;

      const fills = (next.trades ?? []).filter((t) => t.t > before).length;
      const open = next.subjects.filter((s) => s.position).length;
      const desk =
        next.desk && next.desk.at === next.lastTickAt
          ? {
              orders: next.desk.orders,
              skipped: next.desk.skipped ?? 0,
              mind: next.desk.brain?.label ?? "none answered",
              ...(next.desk.error ? { why: next.desk.error } : {}),
            }
          : null;
      // Keep the accepted prices for backtesting; a failure here never fails the tick.
      await recordPrices(next.lastTickAt ?? Date.now(), acceptedPrices(next.ticks, next.lastTickAt ?? 0)).catch((e: unknown) =>
        log("warn", "trade.history_not_recorded", { requestId: opts.requestId, error: e instanceof Error ? e.message : String(e) }),
      );
      const check = next.ledger?.check;
      const books = check ? (check.ok ? "balanced" : { mismatched: check.diffs.length, total: check.total }) : "opening";
      const blocked = next.risk?.blocked ?? {};
      return {
        outcome: "ok",
        summary: { fills, openTrades: open, prices: next.tape.source, books: typeof books === "string" ? books : "mismatched", halted: Boolean(next.halt), attempts: attempt + 1 },
        result: {
          status: 200,
          body: { ok: true, fills, openTrades: open, prices: next.tape.source, desk, books, halted: next.halt?.reason ?? null, blocked },
        },
      };
    }
    throw new Error("world kept changing; try again");
  }).catch((e: unknown) => ({ status: 409, body: { ok: false, error: e instanceof Error ? e.message : "failed" } }));
}

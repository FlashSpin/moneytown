/**
 * The paper-trading report — server-only. Reads the recorded orders and
 * strategy changes, measures them per approach, compares them with the
 * latest backtest, and runs the gates before real money
 * (src/game/paper.ts). Also fills in each order's next-tick price.
 */
import { MIN_COMPARE_TRADES, compareWithBacktest, paperStats, readinessGates, type PaperOrder, type StrategyChange } from "@/game/paper";
import { loadBacktestRun } from "./backtest.server";
import { getSql } from "./db";
import { loadWorldRow } from "./world.server";
import { tapeGbp } from "@/game/wallets";

/** Drop paper orders older than a year. */
export async function prunePaperOrders(): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from paper_orders where at < now() - interval '365 days'`);
}

/** Record the price one tick after each open that doesn't have one yet (for signal quality). */
export async function fillNextPrices(at: number, prices: Record<string, number>): Promise<void> {
  const rows = Object.entries(prices).map(([coin, price]) => ({ coin, price }));
  if (!rows.length) return;
  const sql = await getSql();
  await sql.query(
    `update paper_orders o set next_price = p.price
     from jsonb_to_recordset($1::jsonb) as p(coin text, price double precision)
     where o.coin = p.coin and o.next_price is null and o.status = 'filled' and o.action = 'open'
       and o.at > to_timestamp($2 / 1000.0) - interval '12 minutes' and o.at < to_timestamp($2 / 1000.0) - interval '1 minute'`,
    [JSON.stringify(rows), at],
  );
}

type OrderRow = {
  at: number;
  day: number;
  villager_id: string;
  name: string;
  approach: string;
  coin: string;
  side: "long" | "short";
  action: "open" | "close";
  status: "filled" | "rejected";
  stake: number;
  expected_price: number | null;
  fill_price: number | null;
  cost_sats: number | null;
  fee_sats: number | null;
  pnl_sats: number | null;
  reason: string | null;
  next_price: number | null;
};

export async function loadPaperOrders(days = 30, limit = 20_000): Promise<PaperOrder[]> {
  const sql = await getSql();
  const rows = await sql.query<OrderRow>(
    `select (extract(epoch from at) * 1000)::bigint as at, day, villager_id, name, approach, coin, side, action, status, stake,
            expected_price, fill_price, cost_sats, fee_sats, pnl_sats, reason, next_price
     from paper_orders where at > now() - ($1 || ' days')::interval order by at desc limit $2`,
    [String(days), limit],
  );
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.reverse().map((r) => ({
    at: Number(r.at),
    day: Number(r.day),
    villagerId: r.villager_id,
    name: r.name,
    approach: r.approach as PaperOrder["approach"],
    coin: r.coin,
    side: r.side,
    action: r.action,
    status: r.status,
    stake: Number(r.stake),
    expectedPrice: n(r.expected_price),
    fillPrice: n(r.fill_price),
    costSats: n(r.cost_sats),
    feeSats: n(r.fee_sats),
    pnlSats: n(r.pnl_sats),
    reason: r.reason ?? "",
    nextPrice: n(r.next_price),
  }));
}

export async function loadStrategyChanges(limit = 40): Promise<StrategyChange[]> {
  const sql = await getSql();
  const rows = await sql.query<{ at: number; day: number; villager_id: string; name: string; by: string; before: unknown; after: unknown }>(
    `select (extract(epoch from at) * 1000)::bigint as at, day, villager_id, name, by, before, after
     from strategy_changes order by id desc limit $1`,
    [limit],
  );
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  return rows.map((r) => ({
    at: Number(r.at),
    day: Number(r.day),
    villagerId: r.villager_id,
    name: r.name,
    by: r.by,
    before: parse(r.before) ?? null,
    after: parse(r.after),
  }));
}

async function jobEvidence(): Promise<{ completion7d: number | null; ledgerMismatches30d: number }> {
  const sql = await getSql();
  const rows = await sql.query<{ ticks: number; first: number | null; mismatches: number }>(
    `select
       (select count(*)::int from job_runs where kind = 'trade' and outcome = 'ok' and started_at > now() - interval '7 days') as ticks,
       (select (extract(epoch from min(started_at)) * 1000)::bigint from job_runs where kind = 'trade') as first,
       (select count(*)::int from job_runs where kind = 'trade' and summary->>'books' = 'mismatched' and started_at > now() - interval '30 days') as mismatches`,
  );
  const r = rows[0];
  const ticks = Number(r?.ticks ?? 0);
  // Judge only the time since records began, up to 7 days.
  const since = r?.first ? Math.min(7 * 86_400_000, Date.now() - Number(r.first)) : 0;
  const expected = since / 300_000;
  return { completion7d: expected >= 12 ? Math.min(1, ticks / expected) : null, ledgerMismatches30d: Number(r?.mismatches ?? 0) };
}

export async function paperReport() {
  const [orders, changes, backtest, evidence, row] = await Promise.all([
    loadPaperOrders(),
    loadStrategyChanges(),
    loadBacktestRun().catch(() => null),
    jobEvidence(),
    loadWorldRow(),
  ]);
  const approaches = [...new Set(orders.map((o) => o.approach))].sort();
  const all = paperStats(orders, "all");
  const byApproach = approaches.map((a) => paperStats(orders, a));
  const kinds = new Map((backtest?.results.kinds ?? []).map((k) => [k.kind as string, k]));
  const discrepancies = byApproach.flatMap((p) => compareWithBacktest(p, kinds.get(p.approach)?.full ?? null));
  const backtestPassing = (backtest?.results.kinds ?? [])
    .filter((k) => k.holdout.validation.totalReturn > 0 && k.walkForward.oosReturn > 0 && k.holdout.validation.trades >= MIN_COMPARE_TRADES)
    .map((k) => k.label);
  const readiness = readinessGates({
    ...evidence,
    backtestPassing,
    paper: all,
    capital: row.state.exchequer,
    discrepancies: discrepancies.length,
    money: (sats) => `£${((sats * tapeGbp(row.state.tape)) / 100_000_000).toFixed(2)}`,
    signoffs: {
      security: process.env.READINESS_SECURITY_REVIEW?.trim() || undefined,
      monitoring: process.env.READINESS_MONITORING?.trim() || undefined,
      legal: process.env.READINESS_LEGAL?.trim() || undefined,
    },
  });
  return {
    generatedAt: Date.now(),
    /** Pounds per sat at today's Bitcoin price, for showing sats as money. */
    gbpPerSat: tapeGbp(row.state.tape) / 100_000_000,
    since: orders[0]?.at ?? null,
    all,
    byApproach,
    backtest: backtest ? { id: backtest.id, createdAt: backtest.createdAt, days: backtest.results.days } : null,
    discrepancies,
    readiness,
    recentOrders: orders.slice(-60).reverse(),
    strategyChanges: changes,
  };
}

export type PaperReport = Awaited<ReturnType<typeof paperReport>>;

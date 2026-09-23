/**
 * Backtest runs — server-only. Loads the stored price history (optionally
 * backfilling Kraken's recent candles first), runs the full report
 * (src/game/validation.ts), and keeps every run with its strategy version,
 * settings and a fingerprint of the data it saw.
 */
import { toGrid } from "@/game/backtest";
import { dataSnapshot, fullReport, strategyVersion, type BacktestReport } from "@/game/validation";
import { getSql } from "./db";
import { backfillKraken, loadHistory } from "./history.server";

export type BacktestRun = {
  id: number;
  createdAt: string;
  version: string;
  config: { days: number; coins: string[]; balance: number; stakeSats: number; backfill: { added: number; failed: string[] } | null };
  data: ReturnType<typeof dataSnapshot>;
  results: BacktestReport;
};

export async function runAndSaveBacktest(opts: {
  days: number;
  coins: string[];
  balance: number;
  stakeSats: number;
  backfill: boolean;
}): Promise<BacktestRun> {
  const filled = opts.backfill ? await backfillKraken(opts.coins) : null;
  const history = await loadHistory(Date.now() - opts.days * 86_400_000, opts.coins);
  const grid = toGrid(history);
  if (grid.t.length < 100) throw new Error(`not enough price history yet (${grid.t.length} bars)`);
  const results = fullReport(grid, { balance: opts.balance, stakeSats: opts.stakeSats });
  const version = strategyVersion();
  const config = { days: opts.days, coins: opts.coins, balance: opts.balance, stakeSats: opts.stakeSats, backfill: filled };
  const data = dataSnapshot(grid);
  const sql = await getSql();
  const rows = await sql.query<{ id: number; created_at: string }>(
    `insert into backtest_runs (version, config, data, results) values ($1, $2::jsonb, $3::jsonb, $4::jsonb) returning id, created_at`,
    [version, JSON.stringify(config), JSON.stringify(data), JSON.stringify(results)],
  );
  return { id: Number(rows[0]!.id), createdAt: new Date(rows[0]!.created_at).toISOString(), version, config, data, results };
}

/** The latest run, or run `id`. */
export async function loadBacktestRun(id?: number): Promise<BacktestRun | null> {
  const sql = await getSql();
  const rows = await sql.query<{ id: number; created_at: string; version: string; config: unknown; data: unknown; results: unknown }>(
    id
      ? `select id, created_at, version, config, data, results from backtest_runs where id = $1`
      : `select id, created_at, version, config, data, results from backtest_runs order by id desc limit 1`,
    id ? [id] : [],
  );
  const r = rows[0];
  if (!r) return null;
  const parse = <T,>(v: unknown) => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
  return {
    id: Number(r.id),
    createdAt: new Date(r.created_at).toISOString(),
    version: r.version,
    config: parse(r.config),
    data: parse(r.data),
    results: parse(r.results),
  };
}

/** Every run's headline, newest first. */
export async function listBacktestRuns(limit = 20): Promise<{ id: number; createdAt: string; version: string; days: number; bars: number }[]> {
  const sql = await getSql();
  const rows = await sql.query<{ id: number; created_at: string; version: string; days: number; bars: number }>(
    `select id, created_at, version, (config->>'days')::int as days, (data->>'bars')::int as bars
     from backtest_runs order by id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), createdAt: new Date(r.created_at).toISOString(), version: r.version, days: Number(r.days), bars: Number(r.bars) }));
}

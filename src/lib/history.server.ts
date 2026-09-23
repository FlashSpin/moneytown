/**
 * Price history for backtesting — server-only. Every trading tick records
 * the prices it accepted (after validation, src/game/indicators.ts); a
 * backtest also backfills Kraken's 5-minute candles for the last ~2.5 days.
 * Kept for HISTORY_DAYS.
 */
import type { Ticks } from "@/game/indicators";
import { getSql } from "./db";
import { parseKrakenOhlc } from "./market";
import { krakenPairs } from "./tape.server";

export const HISTORY_DAYS = 90;

/** The prices a tick accepted: coins whose last real price is from `at`. */
export function acceptedPrices(ticks: Ticks | undefined, at: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [coin, seen] of Object.entries(ticks?.seen ?? {})) {
    const px = ticks?.px[coin];
    const last = px?.[px.length - 1];
    if (seen === at && last && last > 0) out[coin] = last;
  }
  return out;
}

export async function recordPrices(at: number, prices: Record<string, number>, source = "tick"): Promise<number> {
  const rows = Object.entries(prices)
    .filter(([, p]) => p > 0 && Number.isFinite(p))
    .map(([coin, price]) => ({ coin, t: at, price }));
  return insertRows(rows, source);
}

async function insertRows(rows: { coin: string; t: number; price: number }[], source: string): Promise<number> {
  if (!rows.length) return 0;
  const sql = await getSql();
  const out = await sql.query<{ n: number }>(
    `with ins as (
       insert into price_history (coin, t, price, source)
       select r.coin, to_timestamp(r.t / 1000.0), r.price, $2
       from jsonb_to_recordset($1::jsonb) as r(coin text, t bigint, price double precision)
       on conflict (coin, t) do nothing
       returning 1
     ) select count(*)::int as n from ins`,
    [JSON.stringify(rows), source],
  );
  return Number(out[0]?.n ?? 0);
}

/** Drop history older than HISTORY_DAYS. */
export async function pruneHistory(): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from price_history where t < now() - ($1 || ' days')::interval`, [String(HISTORY_DAYS)]);
}

/** Backfill Kraken's closed 5-minute candles (about 60 hours) for `coins`. Returns rows added. */
export async function backfillKraken(coins: string[]): Promise<{ added: number; failed: string[] }> {
  const pairs = await krakenPairs();
  let added = 0;
  const failed: string[] = [];
  for (const coin of coins) {
    const key = pairs?.usd.get(coin)?.key;
    if (!key) {
      failed.push(coin);
      continue;
    }
    try {
      const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${key}&interval=5`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const candles = parseKrakenOhlc(await res.json());
      added += await insertRows(candles.map((c) => ({ coin, t: c.t, price: c.close })), "kraken-ohlc");
    } catch {
      failed.push(coin);
    }
    // Kraken's public API allows about one call a second.
    await new Promise((r) => setTimeout(r, 1100));
  }
  return { added, failed };
}

/** Every stored price since `from` (ms), per coin, oldest first. */
export async function loadHistory(from: number, coins?: string[]): Promise<Record<string, { t: number; price: number }[]>> {
  const sql = await getSql();
  const rows = await sql.query<{ coin: string; t: number; price: number }>(
    `select coin, (extract(epoch from t) * 1000)::bigint as t, price from price_history
     where t >= to_timestamp($1 / 1000.0) and ($2::text[] is null or coin = any($2::text[]))
     order by coin, t`,
    [from, coins ?? null],
  );
  const out: Record<string, { t: number; price: number }[]> = {};
  for (const r of rows) (out[r.coin] ??= []).push({ t: Number(r.t), price: Number(r.price) });
  return out;
}

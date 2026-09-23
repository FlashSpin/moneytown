/**
 * Price indicators over a series of closes (oldest first, one per trading
 * tick — every 5 minutes). Pure, so they are easy to test.
 */

/** % change from `n` samples ago to the last, or null without enough data. */
export function change(series: number[], n: number): number | null {
  if (series.length <= n) return null;
  const then = series[series.length - 1 - n]!;
  const now = series[series.length - 1]!;
  return then > 0 ? ((now - then) / then) * 100 : null;
}

export function sma(series: number[], n: number, offset = 0): number | null {
  const end = series.length - offset;
  if (end < n || n <= 0) return null;
  let sum = 0;
  for (let i = end - n; i < end; i++) sum += series[i]!;
  return sum / n;
}

/** Wilder's RSI over `n` periods (0-100), or null without n+1 samples. */
export function rsi(series: number[], n = 14): number | null {
  if (series.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = series.length - n; i < series.length; i++) {
    const d = series[i]! - series[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (gain + loss === 0) return 50;
  if (loss === 0) return 100;
  const rs = gain / n / (loss / n);
  return 100 - 100 / (1 + rs);
}

/** Highest and lowest of the `n` samples BEFORE the last one (the range the last one might break). */
export function priorRange(series: number[], n: number): { high: number; low: number } | null {
  if (series.length < n + 1) return null;
  const window = series.slice(series.length - 1 - n, series.length - 1);
  return { high: Math.max(...window), low: Math.min(...window) };
}

/** Standard deviation of per-sample % returns over the last `n` samples. */
export function volatility(series: number[], n = 12): number | null {
  if (series.length < n + 1) return null;
  const rets: number[] = [];
  for (let i = series.length - n; i < series.length; i++) rets.push(((series[i]! - series[i - 1]!) / series[i - 1]!) * 100);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
}

// ── The tick history: a rolling window of prices for every coin ─────────────

/** One price per coin per trading tick, oldest first; `t` holds the tick times. */
export type Ticks = {
  t: number[];
  px: Record<string, number[]>;
  /** When each coin last had a real price (a missing price repeats the last one in `px`). */
  seen?: Record<string, number>;
};

/** Samples further apart than this are a gap (the ticks stopped), not one step. */
export const MAX_GAP_MS = 12 * 60_000;

/** Samples kept: 24 hours at one per 5 minutes. */
export const TICKS_KEPT = 288;

/**
 * Add a tick. Coins new to the window are back-filled with nothing (their
 * series simply starts now); coins missing a price this tick repeat their last.
 */
export function appendTick(ticks: Ticks | undefined, t: number, prices: Record<string, number>, keep = TICKS_KEPT): Ticks {
  const prev = ticks ?? { t: [], px: {} };
  const out: Ticks = { t: [...prev.t, t].slice(-keep), px: {}, seen: { ...(prev.seen ?? {}) } };
  for (const [coin, p] of Object.entries(prices)) if (p > 0) out.seen![coin] = t;
  const coins = new Set([...Object.keys(prev.px), ...Object.keys(prices)]);
  for (const coin of coins) {
    const old = prev.px[coin] ?? [];
    const p = prices[coin];
    const next = p && p > 0 ? p : old[old.length - 1];
    if (next === undefined) continue;
    out.px[coin] = [...old, next].slice(-keep);
  }
  return out;
}

export function seriesOf(ticks: Ticks | undefined, coin: string): number[] {
  return ticks?.px[coin] ?? [];
}

/**
 * The series a strategy may trade on at `now`: only the unbroken run of
 * samples since the last gap (so an hour-long outage isn't read as a
 * 5-minute move), and nothing at all when the coin's price is stale — no
 * real price within `maxGap`, or no sample that recent.
 */
export function tradingSeries(ticks: Ticks | undefined, coin: string, now: number, maxGap = MAX_GAP_MS): number[] {
  const px = ticks?.px[coin];
  if (!ticks || !px?.length) return [];
  const t = ticks.t;
  const seen = ticks.seen?.[coin];
  if (seen !== undefined && now - seen > maxGap) return [];
  if (!t.length || now - t[t.length - 1]! > maxGap) return [];
  let run = 1;
  while (run < t.length && t[t.length - run]! - t[t.length - run - 1]! <= maxGap) run++;
  return px.slice(-Math.min(run, px.length));
}

/** Whether `coin` has a real price within `maxGap` of `now`. */
export function priceFresh(ticks: Ticks | undefined, coin: string, now: number, maxGap = MAX_GAP_MS): boolean {
  const seen = ticks?.seen?.[coin];
  return seen !== undefined ? now - seen <= maxGap : false;
}

/** A compact read of one coin for the King and the villagers' council. */
export function coinStats(series: number[]): {
  ch1h: number | null;
  ch4h: number | null;
  rsi: number | null;
  vol: number | null;
} {
  return { ch1h: change(series, 12), ch4h: change(series, 48), rsi: rsi(series, 14), vol: volatility(series, 12) };
}

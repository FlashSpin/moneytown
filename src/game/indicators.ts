/**
 * Price indicators over a series of closes (oldest first, one per trading
 * tick — every 5 minutes). Pure, so they are easy to test.
 */

/**
 * A price series, oldest first. Any array-like works — the backtests pass
 * zero-copy views of typed arrays so they never copy prices.
 */
export type Series = ArrayLike<number>;

/** % change from `n` samples ago to the last, or null without enough data. */
export function change(series: Series, n: number): number | null {
  if (series.length <= n) return null;
  const then = series[series.length - 1 - n]!;
  const now = series[series.length - 1]!;
  return then > 0 ? ((now - then) / then) * 100 : null;
}

export function sma(series: Series, n: number, offset = 0): number | null {
  const end = series.length - offset;
  if (end < n || n <= 0) return null;
  let sum = 0;
  for (let i = end - n; i < end; i++) sum += series[i]!;
  return sum / n;
}

/** Wilder's RSI over `n` periods (0-100), or null without n+1 samples. */
export function rsi(series: Series, n = 14): number | null {
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
export function priorRange(series: Series, n: number): { high: number; low: number } | null {
  if (series.length < n + 1) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let i = series.length - 1 - n; i < series.length - 1; i++) {
    const v = series[i]!;
    if (v > high) high = v;
    if (v < low) low = v;
  }
  return { high, low };
}

/**
 * Standard deviation of per-sample % returns over `n` samples, ending
 * `offset` samples before the last (0 = up to the last).
 */
export function volatility(series: Series, n = 12, offset = 0): number | null {
  const end = series.length - offset;
  if (end < n + 1) return null;
  let sum = 0;
  let sq = 0;
  for (let i = end - n; i < end; i++) {
    const r = ((series[i]! - series[i - 1]!) / series[i - 1]!) * 100;
    sum += r;
    sq += r * r;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

// ── The tick history: a rolling window of prices for every coin ─────────────

/** One price per coin per trading tick, oldest first; `t` holds the tick times. */
export type Ticks = {
  t: number[];
  px: Record<string, number[]>;
  /** When each coin last had a real price (a missing price repeats the last one in `px`). */
  seen?: Record<string, number>;
  /** A price that jumped too far to trust yet, per coin — accepted if the next tick confirms it. */
  suspect?: Record<string, number>;
  /** Hourly closes per coin, for strategies on longer bars (`appendHourly`). */
  h?: Record<string, Hourly>;
  /** When each coin's hourly history was last filled from exchange candles. */
  hSeeded?: Record<string, number>;
};

/** One close per hour, oldest first: px[k] closes the hour starting t0 + k hours; the last may still be forming. */
export type Hourly = { t0: number; px: number[] };

/** A move bigger than this between two ticks is held back until the next tick confirms it. */
export const MAX_JUMP = 0.25;

/**
 * Check a tick's prices before they are recorded: a price that jumped more
 * than MAX_JUMP from the coin's last sample is held back (recorded as
 * missing) unless the previous tick saw the same new level, so one bad print
 * can't trigger trades. Returns the prices to record, the coins held back,
 * and what to remember as suspect.
 */
export function validatePrices(
  ticks: Ticks | undefined,
  prices: Record<string, number>,
): { accepted: Record<string, number>; held: string[]; suspect: Record<string, number> } {
  const accepted: Record<string, number> = {};
  const held: string[] = [];
  const suspect: Record<string, number> = {};
  for (const [coin, p] of Object.entries(prices)) {
    if (!(p > 0) || !Number.isFinite(p)) continue;
    const series = ticks?.px[coin];
    const last = series?.[series.length - 1];
    if (!last || Math.abs(p / last - 1) <= MAX_JUMP) {
      accepted[coin] = p;
      continue;
    }
    const before = ticks?.suspect?.[coin];
    if (before && Math.abs(p / before - 1) <= 0.05) {
      accepted[coin] = p; // two ticks agree: it's a real move
      continue;
    }
    held.push(coin);
    suspect[coin] = p;
  }
  return { accepted, held, suspect };
}

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

// ── Longer bars: 15-minute, hourly and 4-hour closes ───────────────────────

export const HOUR_MS = 3_600_000;
/** Hourly closes kept per coin: 10 days (60 four-hour bars). */
export const HOURS_KEPT = 240;
/** Up to this many missing hours are filled with the last close; a longer gap starts the series again. */
const HOUR_GAP_FILL = 3;

function trimHourly(e: Hourly, keep: number): Hourly {
  const drop = e.px.length - keep;
  return drop > 0 ? { t0: e.t0 + drop * HOUR_MS, px: e.px.slice(drop) } : e;
}

/** Put one price into a coin's hourly closes at time `t`: the forming hour takes the latest price. */
export function hourlyWith(e: Hourly | undefined, t: number, p: number, keep = HOURS_KEPT): Hourly {
  const hour = Math.floor(t / HOUR_MS) * HOUR_MS;
  if (!e || !e.px.length) return { t0: hour, px: [p] };
  const last = e.t0 + (e.px.length - 1) * HOUR_MS;
  if (hour < last) return e;
  if (hour === last) return { t0: e.t0, px: [...e.px.slice(0, -1), p] };
  const gap = (hour - last) / HOUR_MS;
  if (gap > HOUR_GAP_FILL + 1) return { t0: hour, px: [p] };
  const fill = Array<number>(gap - 1).fill(e.px[e.px.length - 1]!);
  return trimHourly({ t0: e.t0, px: [...e.px, ...fill, p] }, keep);
}

/** Record a tick's prices into the hourly closes; coins unpriced for two days are dropped. */
export function appendHourly(h: Ticks["h"], t: number, prices: Record<string, number>, keep = HOURS_KEPT): NonNullable<Ticks["h"]> {
  const out: NonNullable<Ticks["h"]> = {};
  for (const [coin, e] of Object.entries(h ?? {})) if (e.t0 + e.px.length * HOUR_MS > t - 48 * HOUR_MS) out[coin] = e;
  for (const [coin, p] of Object.entries(prices)) if (p > 0 && Number.isFinite(p)) out[coin] = hourlyWith(out[coin], t, p, keep);
  return out;
}

/** Fill a coin's hourly closes from exchange candles (closed hours), keeping any later hours already recorded. */
export function seedHourly(e: Hourly | undefined, candles: { t: number; close: number }[], keep = HOURS_KEPT): Hourly | undefined {
  let out: Hourly | undefined;
  for (const c of [...candles].sort((a, b) => a.t - b.t)) if (c.close > 0) out = hourlyWith(out, c.t, c.close, keep);
  if (!out) return e;
  if (e) {
    const seededLast = out.t0 + (out.px.length - 1) * HOUR_MS;
    e.px.forEach((p, k) => {
      const t = e.t0 + k * HOUR_MS;
      if (t > seededLast) out = hourlyWith(out, t, p, keep);
    });
  }
  return trimHourly(out, keep);
}

/** Hours of closed history a coin has. */
export function hoursOf(ticks: Ticks | undefined, coin: string): number {
  return Math.max(0, (ticks?.h?.[coin]?.px.length ?? 0) - 1);
}

/**
 * The series a strategy on `bar`-sized bars trades on at `now`: 5-minute
 * ticks as they are (`tradingSeries`), or the closes of 15-minute, hourly or
 * 4-hour bars that have finished — never the one still forming, so live
 * trading sees what the lab's backtests saw. Nothing when the price is stale.
 */
export function seriesForBar(ticks: Ticks | undefined, coin: string, bar: 1 | 3 | 12 | 48, now: number): number[] {
  if (bar === 1) return tradingSeries(ticks, coin, now);
  if (bar === 3) {
    const px = tradingSeries(ticks, coin, now);
    if (!px.length || !ticks) return [];
    const t = ticks.t.slice(-px.length);
    const size = 15 * 60_000;
    const current = Math.floor(now / size);
    const out: number[] = [];
    let bucket = -1;
    for (let k = 0; k < px.length; k++) {
      const b = Math.floor(t[k]! / size);
      if (b >= current) break;
      if (b === bucket) out[out.length - 1] = px[k]!;
      else out.push(px[k]!);
      bucket = b;
    }
    return out;
  }
  if (!priceFresh(ticks, coin, now)) return [];
  const e = ticks?.h?.[coin];
  if (!e?.px.length) return [];
  const current = Math.floor(now / HOUR_MS) * HOUR_MS;
  // The hourly series must reach the last closed hour, or it is stale.
  const lastClosed = current - HOUR_MS;
  const lastT = e.t0 + (e.px.length - 1) * HOUR_MS;
  if (lastT < lastClosed) return [];
  const closedN = lastT >= current ? e.px.length - (lastT - current) / HOUR_MS - 1 : e.px.length;
  const closed = e.px.slice(0, Math.max(0, closedN));
  if (bar === 12) return closed;
  // 4-hour bars close with the hour that ends at 04:00, 08:00, … UTC.
  const out: number[] = [];
  for (let k = 0; k < closed.length; k++) if ((e.t0 + (k + 1) * HOUR_MS) % (4 * HOUR_MS) === 0) out.push(closed[k]!);
  return out;
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

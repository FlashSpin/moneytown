/**
 * Backtesting — pure, so it is easy to test. Replays stored prices through
 * the very same trading code the villagers run live (`tradeStep`,
 * src/game/strategies.ts), one 5-minute bar at a time:
 *
 *   - no look-ahead: the decision at bar i sees only prices up to bar i, and
 *     the order fills at bar i+1's price (a delayed fill), never bar i's;
 *   - the live cost model: estimated spread and slippage on every fill (the
 *     history has no order book) and the exchange fee, scalable for
 *     sensitivity tests;
 *   - Kelly sizing from what the villager learns along the way, and the
 *     daily loss limit;
 *   - gaps in the data break the series, as they do live.
 * Every run returns its equity curve and the usual measures, next to the
 * baselines of holding cash and holding Bitcoin.
 */
import type { Asset } from "./dawn.ts";
import { EST_HALF_SPREAD, EST_HALF_SPREAD_TOP, type Executor } from "./execution.ts";
import { VILLAGER_DAILY_LOSS } from "./limits.ts";
import { FEE_RATE } from "./risk.ts";
import { genesOf, STRATEGY_INFO, tradeStep, unrealized, warmupOf, type Strategy, type TradeEvent, type Trader } from "./strategies.ts";

export const BAR_MS = 5 * 60_000;
/** Samples a default strategy needs at most (its longest indicator plus room); tuned genes may need more. */
const LOOKBACK = 60;
const DAY_MS = 86_400_000;
/** Slippage assumed without volume data (as the live executor does). */
const EST_SLIPPAGE = 0.001;

/**
 * Prices on a regular grid of `barMs` bars: the close of each bar, NaN where
 * a coin had no price. Candle data also carries each bar's open, high and
 * low, so orders fill at the next bar's open and stops trigger inside a bar.
 */
export type Grid = {
  t: number[];
  barMs?: number;
  px: Record<Asset, Float64Array>;
  open?: Record<Asset, Float64Array>;
  high?: Record<Asset, Float64Array>;
  low?: Record<Asset, Float64Array>;
  /** Per coin, where the unbroken run of prices through bar i began (filled in by `withRuns`). */
  run?: Record<Asset, Int32Array>;
};

const has = (v: number | undefined): v is number => v !== undefined && v > 0;

/** Where each unbroken run of prices starts, per coin — so a series is a zero-copy view. */
export function withRuns(g: Grid): Grid {
  const run: Record<Asset, Int32Array> = {};
  for (const [coin, col] of Object.entries(g.px)) {
    const r = new Int32Array(col.length);
    let start = -1;
    for (let i = 0; i < col.length; i++) {
      if (has(col[i])) {
        if (start < 0) start = i;
        r[i] = start;
      } else {
        start = -1;
        r[i] = -1;
      }
    }
    run[coin] = r;
  }
  return { ...g, run };
}

/** Bucket raw price history into bars of `barMs` (the last price in each bar). */
export function toGrid(history: Record<Asset, { t: number; price: number }[]>, barMs = BAR_MS): Grid {
  let start = Infinity;
  let end = -Infinity;
  for (const rows of Object.values(history)) {
    for (const r of rows) {
      const b = Math.floor(r.t / barMs) * barMs;
      if (b < start) start = b;
      if (b > end) end = b;
    }
  }
  if (!Number.isFinite(start)) return { t: [], px: {}, barMs, run: {} };
  const n = Math.round((end - start) / barMs) + 1;
  const t = Array.from({ length: n }, (_, i) => start + i * barMs);
  const px: Grid["px"] = {};
  for (const [coin, rows] of Object.entries(history)) {
    const col = new Float64Array(n).fill(NaN);
    for (const r of rows) if (r.price > 0) col[Math.round((Math.floor(r.t / barMs) * barMs - start) / barMs)] = r.price;
    px[coin] = col;
  }
  return withRuns({ t, px, barMs });
}

export type Candle = { t: number; o: number; h: number; l: number; c: number };

/** Candles (bar open time, OHLC) onto a regular grid of `barMs` bars. */
export function candleGrid(candles: Record<Asset, Candle[]>, barMs: number): Grid {
  let start = Infinity;
  let end = -Infinity;
  for (const rows of Object.values(candles)) {
    for (const r of rows) {
      if (r.t < start) start = r.t;
      if (r.t > end) end = r.t;
    }
  }
  if (!Number.isFinite(start)) return { t: [], px: {}, barMs, run: {} };
  start = Math.floor(start / barMs) * barMs;
  const n = Math.round((end - start) / barMs) + 1;
  const t = Array.from({ length: n }, (_, i) => start + i * barMs);
  const px: Grid["px"] = {};
  const open: Grid["px"] = {};
  const high: Grid["px"] = {};
  const low: Grid["px"] = {};
  for (const [coin, rows] of Object.entries(candles)) {
    const c = new Float64Array(n).fill(NaN);
    const o = new Float64Array(n).fill(NaN);
    const h = new Float64Array(n).fill(NaN);
    const l = new Float64Array(n).fill(NaN);
    for (const r of rows) {
      if (!(r.c > 0 && r.o > 0 && r.h > 0 && r.l > 0)) continue;
      const i = Math.round((Math.floor(r.t / barMs) * barMs - start) / barMs);
      c[i] = r.c;
      o[i] = r.o;
      h[i] = Math.max(r.h, r.o, r.c);
      l[i] = Math.min(r.l, r.o, r.c);
    }
    px[coin] = c;
    open[coin] = o;
    high[coin] = h;
    low[coin] = l;
  }
  return withRuns({ t, px, open, high, low, barMs });
}

/** Merge `k` bars into one (e.g. 5-minute candles into 15-minute ones); a bar with any gap is left out. */
export function coarsen(candles: Candle[], barMs: number, k: number): Candle[] {
  const out: Candle[] = [];
  const size = barMs * k;
  let cur: Candle | null = null;
  let count = 0;
  for (const r of candles) {
    const b = Math.floor(r.t / size) * size;
    if (!cur || cur.t !== b) {
      if (cur && count === k) out.push(cur);
      cur = { t: b, o: r.o, h: r.h, l: r.l, c: r.c };
      count = 1;
    } else {
      cur.h = Math.max(cur.h, r.h);
      cur.l = Math.min(cur.l, r.l);
      cur.c = r.c;
      count++;
    }
  }
  if (cur && count === k) out.push(cur);
  return out;
}

/** The unbroken run of prices ending at bar i (at most `lookback` long) — nothing after i. A zero-copy view. */
export function seriesAt(g: Grid, coin: Asset, i: number, lookback = LOOKBACK): Float64Array {
  const col = g.px[coin];
  if (!col || !has(col[i])) return new Float64Array(0);
  let start = g.run?.[coin]?.[i];
  if (start === undefined) for (start = i; start > 0 && has(col[start - 1]); start--);
  return col.subarray(Math.max(start, i - lookback + 1), i + 1);
}

export type Metrics = {
  bars: number;
  days: number;
  startBalance: number;
  endBalance: number;
  totalReturn: number;
  maxDrawdown: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgTrade: number | null;
  sharpe: number | null;
  fees: number;
  /** Spread and slippage paid, in sats. */
  costs: number;
  /** Share of bars with a trade open. */
  exposure: number;
  /** Fee, spread and slippage per fill, as a share of the stake (absent on older runs). */
  costPerFillPct?: number | null;
};

export type RunResult = { metrics: Metrics; equity: number[]; events: TradeEvent[] };

export type RunConfig = {
  strategy: Strategy;
  balance: number;
  stakeSats: number;
  /** Multiplies spread, slippage and fees (1 = live). */
  costs?: number;
  /** Bars [from, to) to trade; prices before `from` may still be read as history. */
  from?: number;
  to?: number;
  /** Coins that count as the most liquid (tighter estimated spread). */
  top?: ReadonlySet<Asset>;
};

/**
 * Fills at the NEXT bar's open (its price without candles), plus estimated
 * spread, slippage and the fee — the live model without a book. A stop or
 * target hit inside bar i (`hit`) fills there, at its level.
 */
function nextBarExecutor(g: Grid, i: number, costs: number, top: ReadonlySet<Asset>, hit?: { coin: Asset; price: number }): Executor {
  const at = (coin: Asset, k: number) => {
    const o = g.open?.[coin]?.[k];
    if (has(o)) return o;
    const c = g.px[coin]?.[k];
    return has(c) ? c : 0;
  };
  const slip = (coin: Asset) => ((top.has(coin) ? EST_HALF_SPREAD_TOP : EST_HALF_SPREAD) + EST_SLIPPAGE) * costs;
  return {
    feeRate: FEE_RATE * costs,
    open(coin, side, stake) {
      const mid = at(coin, i + 1);
      if (!mid || !(stake > 0)) return { ok: false, reason: "rejected: no next price" };
      const price = mid * (1 + (side === "long" ? 1 : -1) * slip(coin));
      return { ok: true, price, mid, stake, qty: 0, cost: Math.round(stake * slip(coin)) };
    },
    close(coin, side, stake) {
      const mid = hit && hit.coin === coin ? hit.price : at(coin, i + 1) || at(coin, i) || (g.px[coin]?.[i] ?? 0);
      const price = mid * (1 + (side === "long" ? -1 : 1) * slip(coin));
      return { price, mid, cost: Math.round(stake * slip(coin)) };
    },
  };
}

/**
 * With candles: whether the open trade's stop or target was reached inside
 * bar i, and at what price. The stop is assumed first when both were (the
 * cautious reading), and a bar that opens past the stop fills at its open.
 */
function intrabarHit(g: Grid, trader: Trader, i: number): { coin: Asset; price: number } | undefined {
  const pos = trader.position;
  if (!pos || !g.high || !g.low) return undefined;
  const hi = g.high[pos.coin]?.[i];
  const lo = g.low[pos.coin]?.[i];
  const op = g.open?.[pos.coin]?.[i];
  if (!has(hi) || !has(lo)) return undefined;
  const tp = pos.own?.tp ?? trader.strategy.takeProfitPct;
  const sl = pos.own?.sl ?? trader.strategy.stopLossPct;
  // A hair past the level, so the strategy code reads it as reached.
  const long = pos.side === "long";
  const stop = pos.entryUsd * (1 + (long ? -1 : 1) * (sl / 100) * (1 + 1e-9));
  const target = pos.entryUsd * (1 + (long ? 1 : -1) * (tp / 100) * (1 + 1e-9));
  if (long ? lo <= stop : hi >= stop) {
    const gapped = has(op) && (long ? op < stop : op > stop);
    return { coin: pos.coin, price: gapped ? op : stop };
  }
  if (long ? hi >= target : lo <= target) {
    const gapped = has(op) && (long ? op > target : op < target);
    return { coin: pos.coin, price: gapped ? op : target };
  }
  return undefined;
}

/** Replay one strategy over the grid. */
export function runBacktest(g: Grid, cfg: RunConfig): RunResult {
  const costs = cfg.costs ?? 1;
  const barMs = g.barMs ?? BAR_MS;
  const from = Math.max(0, cfg.from ?? 0);
  const to = Math.min(g.t.length, cfg.to ?? g.t.length);
  const coins = Object.keys(g.px);
  const cols = coins.map((c) => g.px[c]!);
  const top = cfg.top ?? new Set(coins.slice(0, 10));
  const lookback = Math.max(LOOKBACK, warmupOf(cfg.strategy.kind, genesOf(cfg.strategy)) + 2);
  let trader: Trader = { id: "bt", firstName: "Backtest", balance: cfg.balance, strategy: cfg.strategy };
  const equity: number[] = [];
  const events: TradeEvent[] = [];
  let dayStart = cfg.balance;
  let day = -1;
  let inMarket = 0;
  const noHot: ReadonlySet<Asset> = new Set();

  for (let i = from; i < to - 1; i++) {
    const now = g.t[i]!;
    const close = (coin: Asset) => {
      const v = g.px[coin]?.[i];
      return has(v) ? v : 0;
    };
    const mark = () => trader.balance + (trader.position ? unrealized(trader.position, close(trader.position.coin) || trader.position.entryUsd) : 0);
    const today = Math.floor(now / DAY_MS);
    if (today !== day) {
      day = today;
      dayStart = mark();
    }
    const down = mark() < dayStart * (1 - VILLAGER_DAILY_LOSS);
    const hit = intrabarHit(g, trader, i);
    const priceOf = hit ? (coin: Asset) => (coin === hit.coin ? hit.price : close(coin)) : close;
    const universe: Asset[] = [];
    if (!trader.position) for (let k = 0; k < coins.length; k++) if (has(cols[k]![i])) universe.push(coins[k]!);
    const step = tradeStep(
      trader,
      priceOf,
      (coin) => seriesAt(g, coin, i, lookback),
      now,
      cfg.stakeSats,
      universe,
      noHot,
      () => (down ? "daily loss limit" : null),
      nextBarExecutor(g, i, costs, top, hit),
    );
    trader = step.trader;
    if (step.event) events.push(step.event);
    if (trader.position) inMarket++;
    equity.push(mark());
  }
  // Close anything still open at the end, with costs, so every run ends in cash.
  if (trader.position && to - 1 > from) {
    const last = to - 1;
    const pos = trader.position;
    const exit = nextBarExecutor(g, last - 1, costs, top).close(pos.coin, pos.side, pos.stake);
    const gross = unrealized(pos, exit.price || pos.entryUsd);
    const fee = Math.round((pos.stake + gross) * FEE_RATE * costs);
    const pnl = Math.max(0, trader.balance + gross - fee) - trader.balance;
    events.push({ t: g.t[last]!, id: "bt", name: "Backtest", action: "close", coin: pos.coin, side: pos.side, price: exit.price, pnl, fee, cost: exit.cost, stake: pos.stake, reason: "end of test" });
    trader = { ...trader, balance: trader.balance + pnl, position: undefined };
    equity.push(trader.balance);
  }
  return { metrics: measure(equity, events, cfg.balance, trader.balance, inMarket, to - from, barMs), equity, events };
}

/** The usual measures of a run. */
export function measure(equity: number[], events: TradeEvent[], start: number, end: number, inMarket: number, bars: number, barMs = BAR_MS): Metrics {
  let peak = start;
  let maxDd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - e) / peak);
  }
  const closes = events.filter((e) => e.action === "close");
  const wins = closes.filter((e) => (e.pnl ?? 0) > 0);
  const gain = wins.reduce((n, e) => n + (e.pnl ?? 0), 0);
  const loss = closes.filter((e) => (e.pnl ?? 0) <= 0).reduce((n, e) => n - (e.pnl ?? 0), 0);
  const rets: number[] = [];
  for (let k = 1; k < equity.length; k++) if (equity[k - 1]! > 0) rets.push(equity[k]! / equity[k - 1]! - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  return {
    bars,
    days: Math.round(((bars * barMs) / DAY_MS) * 10) / 10,
    startBalance: start,
    endBalance: end,
    totalReturn: start > 0 ? end / start - 1 : 0,
    maxDrawdown: maxDd,
    trades: closes.length,
    winRate: closes.length ? wins.length / closes.length : null,
    profitFactor: loss > 0 ? gain / loss : null,
    avgTrade: closes.length ? Math.round(closes.reduce((n, e) => n + (e.pnl ?? 0), 0) / closes.length) : null,
    // Annualising a few days of returns means nothing; wait for two weeks of data.
    sharpe: sd > 0 && bars * barMs >= 14 * DAY_MS ? (mean / sd) * Math.sqrt((365 * DAY_MS) / barMs) : null,
    fees: events.reduce((n, e) => n + (e.fee ?? 0), 0),
    costs: events.reduce((n, e) => n + (e.cost ?? 0), 0),
    exposure: bars > 0 ? inMarket / bars : 0,
    costPerFillPct: (() => {
      const fills = events.filter((e) => e.stake && e.stake > 0);
      return fills.length ? fills.reduce((n, e) => n + ((e.fee ?? 0) + (e.cost ?? 0)) / e.stake!, 0) / fills.length : null;
    })(),
  };
}

/** Holding one coin over the same bars, bought and sold once with the same costs. */
export function holdBaseline(g: Grid, coin: Asset, balance: number, from = 0, to = g.t.length, costs = 1): { metrics: Metrics; equity: number[] } | null {
  const col = g.px[coin];
  if (!col) return null;
  let first = -1;
  for (let i = from; i < to; i++) if (has(col[i])) {
    first = i;
    break;
  }
  if (first < 0) return null;
  const roundTrip = (EST_HALF_SPREAD_TOP + EST_SLIPPAGE + FEE_RATE) * costs;
  const entry = col[first]!;
  const equity: number[] = [];
  let last = entry;
  for (let i = from; i < to; i++) {
    if (has(col[i])) last = col[i]!;
    equity.push(Math.round(balance * (1 - roundTrip) * (last / entry)));
  }
  const end = Math.round(equity[equity.length - 1]! * (1 - roundTrip));
  equity[equity.length - 1] = end;
  return { metrics: measure(equity, [], balance, end, to - from, to - from, g.barMs), equity };
}

/** Thin a curve to at most `n` points for storing and drawing. */
export function thin(curve: number[], n = 200): number[] {
  if (curve.length <= n) return curve;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(curve[Math.round((k * (curve.length - 1)) / (n - 1))]!);
  return out;
}

/** A strategy of `kind` with its default targets, trading the whole market. */
export function defaultFor(kind: Strategy["kind"], sizePct = 0.3): Strategy {
  const info = STRATEGY_INFO[kind];
  return { kind, coins: [], sizePct, takeProfitPct: info.tp, stopLossPct: info.sl, shorts: true };
}

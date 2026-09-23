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
import { STRATEGY_INFO, tradeStep, unrealized, type Strategy, type TradeEvent, type Trader } from "./strategies.ts";

export const BAR_MS = 5 * 60_000;
/** Samples a strategy needs at most (its longest indicator plus room). */
const LOOKBACK = 60;
const BARS_PER_YEAR = (365 * 24 * 60) / 5;
const MIN_BARS_FOR_SHARPE = 14 * 288;
/** Slippage assumed without volume data (as the live executor does). */
const EST_SLIPPAGE = 0.001;

/** Prices on a regular 5-minute grid; null where a coin had no price in that bar. */
export type Grid = { t: number[]; px: Record<Asset, (number | null)[]> };

/** Bucket raw price history into 5-minute bars (the last price in each bar). */
export function toGrid(history: Record<Asset, { t: number; price: number }[]>): Grid {
  let start = Infinity;
  let end = -Infinity;
  for (const rows of Object.values(history)) {
    for (const r of rows) {
      const b = Math.floor(r.t / BAR_MS) * BAR_MS;
      if (b < start) start = b;
      if (b > end) end = b;
    }
  }
  if (!Number.isFinite(start)) return { t: [], px: {} };
  const n = Math.round((end - start) / BAR_MS) + 1;
  const t = Array.from({ length: n }, (_, i) => start + i * BAR_MS);
  const px: Grid["px"] = {};
  for (const [coin, rows] of Object.entries(history)) {
    const col: (number | null)[] = Array(n).fill(null);
    for (const r of rows) if (r.price > 0) col[Math.round((Math.floor(r.t / BAR_MS) * BAR_MS - start) / BAR_MS)] = r.price;
    px[coin] = col;
  }
  return { t, px };
}

/** The unbroken run of prices ending at bar i (at most LOOKBACK long) — nothing after i. */
export function seriesAt(g: Grid, coin: Asset, i: number): number[] {
  const col = g.px[coin];
  if (!col || col[i] == null) return [];
  const out: number[] = [];
  for (let k = i; k >= 0 && out.length < LOOKBACK; k--) {
    const v = col[k];
    if (v == null) break;
    out.push(v);
  }
  return out.reverse();
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

/** Fills at the NEXT bar's price, plus estimated spread, slippage and the fee — the live model without a book. */
function nextBarExecutor(g: Grid, i: number, costs: number, top: ReadonlySet<Asset>): Executor {
  const next = (coin: Asset) => g.px[coin]?.[i + 1] ?? g.px[coin]?.[i] ?? 0;
  const slip = (coin: Asset) => ((top.has(coin) ? EST_HALF_SPREAD_TOP : EST_HALF_SPREAD) + EST_SLIPPAGE) * costs;
  return {
    feeRate: FEE_RATE * costs,
    open(coin, side, stake) {
      const mid = g.px[coin]?.[i + 1];
      if (!mid || !(stake > 0)) return { ok: false, reason: "rejected: no next price" };
      const price = mid * (1 + (side === "long" ? 1 : -1) * slip(coin));
      return { ok: true, price, mid, stake, qty: 0, cost: Math.round(stake * slip(coin)) };
    },
    close(coin, side, stake) {
      const mid = next(coin);
      const price = mid * (1 + (side === "long" ? -1 : 1) * slip(coin));
      return { price, mid, cost: Math.round(stake * slip(coin)) };
    },
  };
}

/** Replay one strategy over the grid. */
export function runBacktest(g: Grid, cfg: RunConfig): RunResult {
  const costs = cfg.costs ?? 1;
  const from = Math.max(0, cfg.from ?? 0);
  const to = Math.min(g.t.length, cfg.to ?? g.t.length);
  const coins = Object.keys(g.px);
  const top = cfg.top ?? new Set(coins.slice(0, 10));
  let trader: Trader = { id: "bt", firstName: "Backtest", balance: cfg.balance, strategy: cfg.strategy };
  const equity: number[] = [];
  const events: TradeEvent[] = [];
  let dayStart = cfg.balance;
  let day = -1;
  let inMarket = 0;

  for (let i = from; i < to - 1; i++) {
    const now = g.t[i]!;
    const priceOf = (coin: Asset) => g.px[coin]?.[i] ?? 0;
    const today = Math.floor(now / 86_400_000);
    const mark = () => trader.balance + (trader.position ? unrealized(trader.position, priceOf(trader.position.coin) || trader.position.entryUsd) : 0);
    if (today !== day) {
      day = today;
      dayStart = mark();
    }
    const down = mark() < dayStart * (1 - VILLAGER_DAILY_LOSS);
    const universe = coins.filter((c) => g.px[c]![i] != null);
    const step = tradeStep(
      trader,
      priceOf,
      (coin) => seriesAt(g, coin, i),
      now,
      cfg.stakeSats,
      universe,
      new Set(),
      () => (down ? "daily loss limit" : null),
      nextBarExecutor(g, i, costs, top),
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
    events.push({ t: g.t[last]!, id: "bt", name: "Backtest", action: "close", coin: pos.coin, side: pos.side, price: exit.price, pnl, fee, cost: exit.cost, reason: "end of test" });
    trader = { ...trader, balance: trader.balance + pnl, position: undefined };
    equity.push(trader.balance);
  }
  return { metrics: measure(equity, events, cfg.balance, trader.balance, inMarket, to - from), equity, events };
}

/** The usual measures of a run. */
export function measure(equity: number[], events: TradeEvent[], start: number, end: number, inMarket: number, bars: number): Metrics {
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
    days: Math.round(((bars * BAR_MS) / 86_400_000) * 10) / 10,
    startBalance: start,
    endBalance: end,
    totalReturn: start > 0 ? end / start - 1 : 0,
    maxDrawdown: maxDd,
    trades: closes.length,
    winRate: closes.length ? wins.length / closes.length : null,
    profitFactor: loss > 0 ? gain / loss : null,
    avgTrade: closes.length ? Math.round(closes.reduce((n, e) => n + (e.pnl ?? 0), 0) / closes.length) : null,
    // Annualising a few days of 5-minute returns means nothing; wait for two weeks of data.
    sharpe: sd > 0 && bars >= MIN_BARS_FOR_SHARPE ? (mean / sd) * Math.sqrt(BARS_PER_YEAR) : null,
    fees: events.reduce((n, e) => n + (e.fee ?? 0), 0),
    costs: events.reduce((n, e) => n + (e.cost ?? 0), 0),
    exposure: bars > 0 ? inMarket / bars : 0,
  };
}

/** Holding one coin over the same bars, bought and sold once with the same costs. */
export function holdBaseline(g: Grid, coin: Asset, balance: number, from = 0, to = g.t.length, costs = 1): { metrics: Metrics; equity: number[] } | null {
  const col = g.px[coin];
  if (!col) return null;
  let first = -1;
  for (let i = from; i < to; i++) if (col[i] != null) {
    first = i;
    break;
  }
  if (first < 0) return null;
  const roundTrip = (EST_HALF_SPREAD_TOP + EST_SLIPPAGE + FEE_RATE) * costs;
  const entry = col[first]!;
  const equity: number[] = [];
  let last = entry;
  for (let i = from; i < to; i++) {
    if (col[i] != null) last = col[i]!;
    equity.push(Math.round(balance * (1 - roundTrip) * (last / entry)));
  }
  const end = Math.round(equity[equity.length - 1]! * (1 - roundTrip));
  equity[equity.length - 1] = end;
  return { metrics: measure(equity, [], balance, end, to - from, to - from), equity };
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

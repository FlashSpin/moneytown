/**
 * Day-trading strategies — pure, so they are easy to test.
 *
 * Every villager runs one strategy across the whole market (or the coins it
 * chooses to focus on), every trading tick (5 minutes): with no position it
 * scans every coin for its entry signal and takes the strongest, weighed by
 * what it has learned about each coin (./knowledge.ts); with one it checks
 * take-profit, stop-loss, a trailing stop, the strategy's own exit signal
 * and a time limit. Each trade is sized by the Kelly criterion, never
 * risking more than 6% of the purse at its stop (./risk.ts). Each fill pays
 * a fee, like a real exchange. The AI
 * (King's advice + the villagers' council) chooses and tunes strategies a
 * few times a day, and at the trading desk each villager may also buy,
 * short or close on its own call whenever it wants (`deskStep`).
 */
import { SIZE_DEFAULT, SIZE_MIN, SIZE_WEAK_MAX, WEAK_PURSE_SHARE } from "./constants.ts";
import type { Asset } from "./dawn.ts";
import { change, priorRange, rsi, sma, volatility, type Series } from "./indicators.ts";
import { avoids, coinEdge, learnTrade, type Approach, type Knowledge } from "./knowledge.ts";
import { idealExecutor, type Executor } from "./execution.ts";
import type { Gate } from "./limits.ts";
import { calibratedChance, edgeOf, kelly, riskShare, stakeForRisk, strategyRisk, TRADING_COST_PCT } from "./risk.ts";
import type { Temper } from "./trading.ts";

export { FEE_RATE } from "./risk.ts";
/** After closing, a villager waits this many ticks before trading that coin again. */
export const COOLDOWN_TICKS = 2;
export const TICK_MS = 5 * 60_000;

export type StrategyKind = "scalp" | "momentum" | "breakout" | "reversion" | "trend" | "conservative" | "volatility";
export const STRATEGY_KINDS: StrategyKind[] = ["scalp", "momentum", "breakout", "reversion", "trend", "conservative", "volatility"];
/** Strategies that only ever buy, whatever their `shorts` setting. */
export const LONG_ONLY: ReadonlySet<StrategyKind> = new Set(["conservative"]);

export const STRATEGY_INFO: Record<
  StrategyKind,
  { label: string; about: string; tp: number; sl: number; maxHoldH: number; warmup: number }
> = {
  scalp: {
    label: "Scalper",
    about: "catches small quick moves in the last 15 minutes; tight targets, out within 2 hours",
    tp: 1.2,
    sl: 0.8,
    maxHoldH: 2,
    warmup: 4,
  },
  momentum: {
    label: "Momentum",
    about: "rides a coin moving hard over the last 30 minutes",
    tp: 2.5,
    sl: 1.5,
    maxHoldH: 8,
    warmup: 7,
  },
  breakout: {
    label: "Breakout",
    about: "buys a break above the 2-hour high, shorts a break below the 2-hour low",
    tp: 3,
    sl: 1.5,
    maxHoldH: 10,
    warmup: 25,
  },
  reversion: {
    label: "Mean reversion",
    about: "buys when RSI says oversold (<30), shorts when overbought (>70), exits as RSI returns to 50",
    tp: 2,
    sl: 1.5,
    maxHoldH: 10,
    warmup: 15,
  },
  trend: {
    label: "Trend follower",
    about: "follows the 30-minute average crossing the 2-hour average, with a trailing stop",
    tp: 6,
    sl: 2,
    maxHoldH: 24,
    warmup: 25,
  },
  conservative: {
    label: "Conservative",
    about: "buys only calm coins in a steady uptrend (above both averages, low volatility) and never shorts; small targets, quick to leave",
    tp: 1.5,
    sl: 0.8,
    maxHoldH: 6,
    warmup: 25,
  },
  volatility: {
    label: "Volatility breakout",
    about: "jumps on a coin whose swings suddenly double against the last two hours, in the direction it breaks; wide targets, short holds",
    tp: 4,
    sl: 2,
    maxHoldH: 6,
    warmup: 31,
  },
};

/** Bar size: how many 5-minute ticks make one bar (5 min, 15 min, 1 hour, 4 hours). */
export type Bar = 1 | 3 | 12 | 48;
export const BARS: Bar[] = [1, 3, 12, 48];
export const BAR_LABEL: Record<Bar, string> = { 1: "5-minute", 3: "15-minute", 12: "hourly", 48: "4-hour" };

/**
 * A strategy's tunable genes — what the strategy lab (./lab.ts) evolves.
 * Lengths are in bars of `bar` size.
 *   look    the main window: the move (scalp, momentum), the range (breakout),
 *           the RSI period (reversion), the slow average (trend,
 *           conservative), the calm baseline (volatility)
 *   fast    the short window: the fast average, or recent swings
 *   thr     the trigger: % move (scalp, momentum), % margin past the range
 *           (breakout), distance of RSI from 50 (reversion), largest calm
 *           volatility % (conservative), how many times wider the swings
 *           (volatility); unused by trend
 *   filter  trade only with the longer trend: long above, short below this
 *           average (0 = off)
 *   trail   trailing stop, % off the best price once in profit (0 = off)
 *   hold    the most bars to stay in a trade
 */
export type Genes = { bar: Bar; look: number; fast: number; thr: number; filter: number; trail: number; hold: number };

/** Each strategy's own genes: exactly how it has always traded. */
export const DEFAULT_GENES: Record<StrategyKind, Genes> = {
  scalp: { bar: 1, look: 3, fast: 3, thr: 0.3, filter: 0, trail: 0, hold: 24 },
  momentum: { bar: 1, look: 6, fast: 3, thr: 0.8, filter: 0, trail: 0, hold: 96 },
  breakout: { bar: 1, look: 24, fast: 3, thr: 0, filter: 0, trail: 0, hold: 120 },
  reversion: { bar: 1, look: 14, fast: 3, thr: 20, filter: 0, trail: 0, hold: 120 },
  trend: { bar: 1, look: 24, fast: 6, thr: 0, filter: 0, trail: 0, hold: 288 },
  conservative: { bar: 1, look: 24, fast: 6, thr: 0.4, filter: 0, trail: 0, hold: 72 },
  volatility: { bar: 1, look: 24, fast: 6, thr: 2, filter: 0, trail: 0, hold: 72 },
};

export function genesOf(st: Pick<Strategy, "kind" | "genes">): Genes {
  return st.genes ?? DEFAULT_GENES[st.kind];
}

/** Samples a strategy needs before it can signal. */
export function warmupOf(kind: StrategyKind, g: Genes): number {
  const base = kind === "volatility" ? g.look + g.fast + 1 : kind === "trend" ? Math.max(g.look, g.fast) + 1 : Math.max(g.look, g.fast) + 1;
  return Math.max(base, g.filter > 0 ? g.filter : 0);
}

/** The longest a trade may stay open, in hours. */
export function maxHoldHours(g: Genes): number {
  return (g.hold * g.bar) / 12;
}

/** "15 min", "3h", "2d" for `bars` bars of size `bar`. */
export function spanLabel(bars: number, bar: Bar): string {
  const mins = bars * bar * 5;
  if (mins < 60) return `${mins} min`;
  if (mins < 2880) return `${Math.round((mins / 60) * 10) / 10}h`;
  return `${Math.round((mins / 1440) * 10) / 10}d`;
}

export type Strategy = {
  kind: StrategyKind;
  /** Tuned genes (from the strategy lab); absent = the kind's defaults. */
  genes?: Genes;
  /** Where tuned genes came from: the lab's genome, its parent, and its generation. */
  genome?: { id: string; parent?: string; gen: number };
  /** Coins it focuses on; empty = the whole market (every listed coin). */
  coins: Asset[];
  /** Share of the purse put into each trade (0.1-1). */
  sizePct: number;
  takeProfitPct: number;
  stopLossPct: number;
  /** Whether it may bet on falls. */
  shorts: boolean;
  /** Why it was chosen, in the villager's words. */
  note?: string;
};

export type Position = {
  coin: Asset;
  side: "long" | "short";
  /** Sats committed. */
  stake: number;
  entryUsd: number;
  openedAt: number;
  /** Best price seen since entry (for the trailing stop). */
  peakUsd: number;
  /** What opened it: a strategy, or the villager's own call at the desk. */
  by?: Approach;
  /** The genes of the strategy that opened it (its exits follow them even if the strategy changes). */
  genes?: Genes;
  /** The villager's own targets for a trade it placed itself (instead of its strategy's). */
  own?: { tp: number; sl: number; maxHoldH: number };
  /** Coins bought or sold short (0 when filled without exchange rules), and the mid price at entry. */
  qty?: number;
  entryMid?: number;
};

export type TradeEvent = {
  t: number;
  id: string;
  name: string;
  action: "open" | "close";
  coin: Asset;
  side: "long" | "short";
  price: number;
  /** Net P&L in sats (closes only), fees included. */
  pnl?: number;
  /** The exchange fee on this fill, in sats. */
  fee?: number;
  /** The market's mid price when it filled; `price` is the fill after spread and slippage. */
  mid?: number;
  /** What the spread and slippage cost against the mid, in sats. */
  cost?: number;
  /** Coins bought or sold. */
  qty?: number;
  /** Sats staked (the position's stake). */
  stake?: number;
  /** What opened the position: a strategy, or the villager's own call. */
  by?: Approach;
  /** The lab genome behind the strategy, if any. */
  genomeId?: string;
  reason: string;
  /** The villager's own call at the trading desk, not its strategy's signal. */
  own?: boolean;
  /** Opens: share of the purse it loses if the stop is hit (the Kelly sizing). */
  risk?: number;
};

// ── Choosing and tidying strategies ──────────────────────────────────────

const TEMPER_STRATEGY: Record<Temper, { kind: StrategyKind; size: number; shorts: boolean }> = {
  trend: { kind: "trend", size: 0.3, shorts: true },
  contrarian: { kind: "reversion", size: 0.25, shorts: true },
  cautious: { kind: "conservative", size: 0.15, shorts: false },
  bold: { kind: "breakout", size: 0.4, shorts: true },
  steady: { kind: "momentum", size: 0.25, shorts: false },
};

/** A villager's own strategy when no council has chosen one: its temperament's, across the whole market. */
export function defaultStrategy(_id: string, temper: Temper, _market: Asset[]): Strategy {
  const t = TEMPER_STRATEGY[temper];
  const info = STRATEGY_INFO[t.kind];
  return { kind: t.kind, coins: [], sizePct: t.size, takeProfitPct: info.tp, stopLossPct: info.sl, shorts: t.shorts };
}

/** "the whole market", or the coins a strategy focuses on. */
export function coinsLabel(s: Pick<Strategy, "coins">): string {
  return s.coins.length ? s.coins.join("/") : "the whole market";
}

const ALL_WORDS = new Set(["ALL", "ANY", "MARKET", "WHOLE MARKET", "EVERY", "EVERYTHING", "*"]);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Tidy a proposed strategy (from the AI or the owner): a known kind, listed
 * coins to focus on ("all" or [] = the whole market), sane size and targets.
 * Unknown pieces fall back to `base`.
 */
export function cleanStrategy(raw: unknown, base: Strategy, market: Asset[]): Strategy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = STRATEGY_KINDS.includes(String(r.kind ?? r.strategy ?? "").toLowerCase() as StrategyKind)
    ? (String(r.kind ?? r.strategy).toLowerCase() as StrategyKind)
    : base.kind;
  const listed = new Set(market);
  const coinsIn = Array.isArray(r.coins) ? r.coins : typeof r.coins === "string" ? String(r.coins).split(/[,\s/]+/) : null;
  const words = (coinsIn ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  const wholeMarket =
    (Array.isArray(r.coins) && r.coins.length === 0) ||
    (typeof r.coins === "string" && ALL_WORDS.has(r.coins.trim().toUpperCase())) ||
    words.some((w) => ALL_WORDS.has(w));
  const focus = [...new Set(words.filter((c) => listed.has(c)))];
  const coins = wholeMarket ? [] : focus.length ? focus : base.coins;
  const num = (v: unknown) => (typeof v === "number" || typeof v === "string" ? Number(v) : NaN);
  const size = num(r.sizePct ?? r.size);
  const tp = num(r.takeProfitPct ?? r.takeProfit ?? r.tp);
  const sl = num(r.stopLossPct ?? r.stopLoss ?? r.sl);
  const kindChanged = kind !== base.kind;
  return {
    kind,
    coins,
    sizePct: Number.isFinite(size) && size > 0 ? clamp(size > 1 ? size / 100 : size, SIZE_MIN, 1) : base.sizePct,
    takeProfitPct: Number.isFinite(tp) && tp > 0 ? clamp(tp, 0.5, 15) : kindChanged ? STRATEGY_INFO[kind].tp : base.takeProfitPct,
    stopLossPct: Number.isFinite(sl) && sl > 0 ? clamp(sl, 0.3, 10) : kindChanged ? STRATEGY_INFO[kind].sl : base.stopLossPct,
    shorts: typeof r.shorts === "boolean" ? r.shorts : base.shorts,
    note: typeof r.note === "string" ? r.note.replace(/\s+/g, " ").trim().slice(0, 200) : typeof r.plan === "string" ? String(r.plan).slice(0, 200) : base.note,
    // Tuned genes stay with the same kind of strategy; a new kind starts from its defaults.
    ...(!kindChanged && base.genes ? { genes: base.genes } : {}),
    ...(!kindChanged && base.genome ? { genome: base.genome } : {}),
  };
}

// ── Signals ──────────────────────────────────────────────────────────────

/** An entry signal; `strength` is 1 at the threshold and grows with the move (for picking the best coin). */
export type Signal = { side: "long" | "short"; reason: string; strength: number } | null;

/**
 * The strategy's entry signal on one coin's price series (bars of the
 * genes' size), with the trend filter applied.
 */
export function entrySignal(kind: StrategyKind, s: Series, genes: Genes = DEFAULT_GENES[kind]): Signal {
  const g = genes;
  if (s.length < warmupOf(kind, g)) return null;
  const sig = rawSignal(kind, s, g);
  if (!sig || g.filter <= 0) return sig;
  const f = sma(s, g.filter);
  const last = s[s.length - 1]!;
  if (f === null) return null;
  if (sig.side === "long" && last <= f) return null;
  if (sig.side === "short" && last >= f) return null;
  return sig;
}

function rawSignal(kind: StrategyKind, s: Series, g: Genes): Signal {
  const last = s[s.length - 1]!;
  switch (kind) {
    case "scalp":
    case "momentum": {
      const c = change(s, g.look);
      if (c === null) return null;
      const span = spanLabel(g.look, g.bar);
      const what = kind === "scalp" ? "" : "momentum ";
      if (c > g.thr) return { side: "long", reason: kind === "scalp" ? `up ${c.toFixed(2)}% in ${span}` : `${what}+${c.toFixed(2)}% in ${span}`, strength: c / Math.max(g.thr, 0.01) };
      if (c < -g.thr) return { side: "short", reason: kind === "scalp" ? `down ${Math.abs(c).toFixed(2)}% in ${span}` : `${what}${c.toFixed(2)}% in ${span}`, strength: -c / Math.max(g.thr, 0.01) };
      return null;
    }
    case "breakout": {
      const r = priorRange(s, g.look);
      if (!r) return null;
      const up = r.high * (1 + g.thr / 100);
      const down = r.low * (1 - g.thr / 100);
      const span = spanLabel(g.look, g.bar);
      if (last > up) return { side: "long", reason: `broke the ${span} high`, strength: 1 + ((last - up) / up) * 500 };
      if (last < down) return { side: "short", reason: `broke the ${span} low`, strength: 1 + ((down - last) / down) * 500 };
      return null;
    }
    case "reversion": {
      const v = rsi(s, g.look);
      if (v === null) return null;
      const lo = 50 - g.thr;
      const hi = 50 + g.thr;
      if (v < lo) return { side: "long", reason: `oversold, RSI ${v.toFixed(0)}`, strength: 1 + (lo - v) / 10 };
      if (v > hi) return { side: "short", reason: `overbought, RSI ${v.toFixed(0)}`, strength: 1 + (v - hi) / 10 };
      return null;
    }
    case "conservative": {
      const fast = sma(s, g.fast);
      const slow = sma(s, g.look);
      const c = change(s, g.fast);
      const vol = volatility(s, Math.max(2, Math.floor(g.look / 2)));
      if (fast === null || slow === null || c === null || vol === null) return null;
      if (last > fast && fast > slow && c > 0 && vol < g.thr)
        return { side: "long", reason: `calm uptrend, +${c.toFixed(2)}% in ${spanLabel(g.fast, g.bar)}, volatility ${vol.toFixed(2)}%`, strength: 1 + c / 2 };
      return null;
    }
    case "volatility": {
      const recent = volatility(s, g.fast);
      const before = volatility(s, g.look, g.fast);
      const c = change(s, Math.min(3, g.fast));
      if (recent === null || before === null || c === null || !(before > 0) || recent < before * g.thr || Math.abs(c) < 0.5) return null;
      const side = c > 0 ? "long" : "short";
      return {
        side,
        reason: `swings ${(recent / before).toFixed(1)}× the last ${spanLabel(g.look, g.bar)}, ${c >= 0 ? "+" : ""}${c.toFixed(2)}% in ${spanLabel(Math.min(3, g.fast), g.bar)}`,
        strength: Math.min(5, recent / before),
      };
    }
    case "trend": {
      const fast = sma(s, g.fast);
      const slow = sma(s, g.look);
      const fastBefore = sma(s, g.fast, 1);
      const slowBefore = sma(s, g.look, 1);
      if (fast === null || slow === null || fastBefore === null || slowBefore === null) return null;
      const gap = 1 + (Math.abs(fast - slow) / slow) * 200;
      const f = spanLabel(g.fast, g.bar);
      const sl = spanLabel(g.look, g.bar);
      if (fast > slow && fastBefore <= slowBefore) return { side: "long", reason: `${f} average crossed above ${sl}`, strength: gap };
      if (fast < slow && fastBefore >= slowBefore) return { side: "short", reason: `${f} average crossed below ${sl}`, strength: gap };
      return null;
    }
  }
}

/** The strategy's own reason to leave early (beyond targets and stops). */
function exitSignal(kind: StrategyKind, side: "long" | "short", s: Series, g: Genes): string | null {
  if (kind === "reversion") {
    const v = rsi(s, g.look);
    if (v !== null && ((side === "long" && v >= 50) || (side === "short" && v <= 50))) return `RSI back to ${v.toFixed(0)}`;
  }
  if (kind === "conservative") {
    const fast = sma(s, g.fast);
    const slow = sma(s, g.look);
    if (fast !== null && slow !== null && fast < slow) return "uptrend broken";
  }
  if (kind === "trend") {
    const fast = sma(s, g.fast);
    const slow = sma(s, g.look);
    if (fast !== null && slow !== null && ((side === "long" && fast < slow) || (side === "short" && fast > slow)))
      return "averages crossed back";
  }
  return null;
}

// ── The trading step for one villager ────────────────────────────────────

export type Trader = {
  id: string;
  firstName: string;
  balance: number;
  strategy: Strategy;
  position?: Position;
  /** Tick time before which it won't reopen `cooldownCoin`. */
  cooldownUntil?: number;
  cooldownCoin?: Asset;
  record?: { wins: number; losses: number; pnl: number };
  trades?: number;
  knowledge?: Knowledge;
  /** The most of its purse it may lose on one trade, by its rank (./ranks.ts); the global cap applies too. */
  riskCap?: number;
};

type Step = { trader: Trader; event: TradeEvent | null };

/** An order the exchange turned down: what was asked for, and why. */
export type RejectedOrder = { coin: Asset; side: "long" | "short"; stake: number; by: Approach; reason: string };

/** Stake for a new trade: the strategy's share of the purse, capped for weak purses. */
export function stakeFor(balance: number, sizePct: number, stakeSats: number): number {
  const size = stakeSats > 0 && balance < stakeSats * WEAK_PURSE_SHARE ? Math.min(sizePct, SIZE_WEAK_MAX) : sizePct;
  return Math.floor(balance * (size || SIZE_DEFAULT));
}

export function unrealized(p: Position, priceUsd: number): number {
  if (!(priceUsd > 0) || !(p.entryUsd > 0)) return 0;
  const move = ((priceUsd - p.entryUsd) / p.entryUsd) * (p.side === "long" ? 1 : -1);
  return Math.round(Math.max(p.stake * move, -p.stake));
}

/** Close the open position at `px`: pay the fee, bank the P&L, remember how it went. */
function closeAt(trader: Trader, pos: Position, exec: Executor, now: number, reason: string, own = false): Step {
  const fill = exec.close(pos.coin, pos.side, pos.stake, pos.qty);
  const px = fill.price;
  const gross = unrealized(pos, px);
  const fee = Math.round((pos.stake + gross) * exec.feeRate);
  // A purse can't go below nothing: a loss bigger than the purse takes only what is there.
  const balance = Math.max(0, trader.balance + gross - fee);
  const pnl = balance - trader.balance;
  const r = trader.record ?? { wins: 0, losses: 0, pnl: 0 };
  return {
    trader: {
      ...trader,
      balance,
      position: undefined,
      // A strategy on longer bars waits a whole bar: its signal can't change sooner.
      cooldownUntil: now + Math.max(COOLDOWN_TICKS, pos.genes?.bar ?? 1) * TICK_MS,
      cooldownCoin: pos.coin,
      record: { wins: r.wins + (pnl > 0 ? 1 : 0), losses: r.losses + (pnl <= 0 ? 1 : 0), pnl: r.pnl + pnl },
      trades: (trader.trades ?? 0) + 1,
      knowledge: learnTrade(trader.knowledge, { coin: pos.coin, side: pos.side, approach: pos.by ?? trader.strategy.kind, pnl }),
    },
    event: {
      t: now,
      id: trader.id,
      name: trader.firstName,
      action: "close",
      coin: pos.coin,
      side: pos.side,
      price: px,
      pnl,
      fee,
      reason,
      stake: pos.stake,
      by: pos.by ?? trader.strategy.kind,
      ...(fill.mid && fill.mid !== px ? { mid: fill.mid, cost: fill.cost } : {}),
      ...(pos.qty ? { qty: pos.qty } : {}),
      ...(own ? { own } : {}),
    },
  };
}

/** Open a position: pay the fee on the stake. */
/** Send an order to open to the executor; a rejected order changes nothing and says why. */
function openAt(
  trader: Trader,
  open: { coin: Asset; side: "long" | "short"; stake: number; reason: string; by: Approach; own?: Position["own"]; sl: number; genes?: Genes; genomeId?: string },
  now: number,
  exec: Executor,
): Step & { rejected?: string; rejectedOrder?: RejectedOrder } {
  const fill = exec.open(open.coin, open.side, open.stake);
  if (!fill.ok) {
    return { trader, event: null, rejected: fill.reason, rejectedOrder: { coin: open.coin, side: open.side, stake: open.stake, by: open.by, reason: fill.reason } };
  }
  const fee = Math.round(fill.stake * exec.feeRate);
  const position: Position = {
    coin: open.coin,
    side: open.side,
    stake: fill.stake,
    entryUsd: fill.price,
    openedAt: now,
    peakUsd: fill.mid,
    by: open.by,
    ...(fill.qty ? { qty: fill.qty } : {}),
    ...(fill.mid !== fill.price ? { entryMid: fill.mid } : {}),
  };
  if (open.own) position.own = open.own;
  if (open.genes) position.genes = open.genes;
  return {
    trader: { ...trader, balance: trader.balance - fee, position, trades: (trader.trades ?? 0) + 1 },
    event: {
      t: now,
      id: trader.id,
      name: trader.firstName,
      action: "open",
      coin: open.coin,
      side: open.side,
      price: fill.price,
      fee,
      reason: open.reason,
      stake: fill.stake,
      by: open.by,
      risk: riskAt(fill.stake, trader.balance, open.sl),
      ...(fill.mid !== fill.price ? { mid: fill.mid, cost: fill.cost } : {}),
      ...(fill.qty ? { qty: fill.qty } : {}),
      ...(open.own ? { own: true } : {}),
      ...(open.genomeId ? { genomeId: open.genomeId } : {}),
    },
  };
}

/**
 * One tick for one villager: manage the open position, or scan the market
 * for an entry. `universe` is every tradable coin; the strategy scans its
 * focus coins if it has any, else all of them, skips coins it has learned to
 * avoid, and takes the strongest signal weighed by its record on each coin
 * and the crowd's attention (`hot`: coins trending right now). The stake is
 * the smaller of the strategy's size and its Kelly sizing.
 * Returns the updated trader and what happened (at most one fill per tick).
 */
export function tradeStep(
  trader: Trader,
  priceOf: (coin: Asset) => number,
  seriesOf: (coin: Asset, bar: Bar) => Series,
  now: number,
  stakeSats: number,
  universe: Asset[] = [],
  hot: ReadonlySet<Asset> = new Set(),
  gate: Gate = () => null,
  exec: Executor = idealExecutor(priceOf),
): Step & { rejected?: string; rejectedOrder?: RejectedOrder } {
  const st = trader.strategy;
  const pos = trader.position;

  if (pos) {
    const px = priceOf(pos.coin);
    if (!(px > 0)) return { trader, event: null };
    // A trade the villager placed itself keeps its own targets; a strategy's trade follows the strategy.
    const tp = pos.own?.tp ?? st.takeProfitPct;
    const sl = pos.own?.sl ?? st.stopLossPct;
    const kind = pos.by && pos.by !== "own" ? pos.by : pos.own ? null : st.kind;
    // The genes the trade was opened with (older trades: the strategy's, if it's the same kind, else the kind's defaults).
    const g = pos.genes ?? (kind === st.kind ? genesOf(st) : kind ? DEFAULT_GENES[kind] : genesOf(st));
    const maxHoldH = pos.own?.maxHoldH ?? maxHoldHours(g);
    // The trend follower always trails (at its stop-loss unless its genes say otherwise).
    const trail = pos.own ? 0 : g.trail > 0 ? g.trail : kind === "trend" ? sl : 0;
    const peak = pos.side === "long" ? Math.max(pos.peakUsd, px) : Math.min(pos.peakUsd, px);
    const movePct = ((px - pos.entryUsd) / pos.entryUsd) * 100 * (pos.side === "long" ? 1 : -1);
    const fromPeakPct = ((px - peak) / peak) * 100 * (pos.side === "long" ? -1 : 1);
    let reason: string | null = null;
    if (movePct >= tp) reason = `take-profit +${movePct.toFixed(2)}%`;
    else if (movePct <= -sl) reason = `stop-loss ${movePct.toFixed(2)}%`;
    else if (trail > 0 && movePct > 0 && fromPeakPct >= trail) reason = `trailing stop, ${fromPeakPct.toFixed(2)}% off the peak`;
    else if (kind) reason = exitSignal(kind, pos.side, seriesOf(pos.coin, g.bar), g);
    if (!reason && now - pos.openedAt >= maxHoldH * 3_600_000) reason = `time limit (${maxHoldH}h)`;
    if (!reason) return { trader: { ...trader, position: { ...pos, peakUsd: peak } }, event: null };
    return closeAt(trader, pos, exec, now, reason);
  }

  const scan = st.coins.length ? st.coins : universe.length ? universe : st.coins;
  const genes = genesOf(st);
  let best: { coin: Asset; sig: NonNullable<Signal>; px: number; score: number } | null = null;
  for (const coin of scan) {
    if (trader.cooldownCoin === coin && (trader.cooldownUntil ?? 0) > now) continue;
    if (avoids(trader.knowledge, coin)) continue;
    const px = priceOf(coin);
    if (!(px > 0)) continue;
    const sig = entrySignal(st.kind, seriesOf(coin, genes.bar), genes);
    if (!sig || (sig.side === "short" && (!st.shorts || LONG_ONLY.has(st.kind)))) continue;
    if (gate(coin, 0)) continue;
    // Coins it has done well on count for more; focus coins win ties in their listed order.
    const score = Math.min(sig.strength, 5) * (1 + 0.5 * coinEdge(trader.knowledge, coin)) * (hot.has(coin) ? 1.15 : 1);
    if (!best || score > best.score) best = { coin, sig, px, score };
  }
  if (!best) return { trader, event: null };
  const risk = Math.min(strategyRisk(trader.knowledge, st.kind, best.coin, st.takeProfitPct, st.stopLossPct), trader.riskCap ?? 1);
  const stake = Math.min(stakeFor(trader.balance, st.sizePct, stakeSats), stakeForRisk(trader.balance, risk, st.stopLossPct));
  if (stake <= 0 || gate(best.coin, stake)) return { trader, event: null };
  return openAt(
    trader,
    { coin: best.coin, side: best.sig.side, stake, reason: best.sig.reason, by: st.kind, sl: st.stopLossPct, genes: genesOf(st), ...(st.genome ? { genomeId: st.genome.id } : {}) },
    now,
    exec,
  );
}

/** Share of the purse a stake loses at the stop, fees, spread and slippage included. */
function riskAt(stake: number, balance: number, sl: number): number {
  return balance > 0 ? Math.round(((stake * ((sl + TRADING_COST_PCT) / 100)) / balance) * 10_000) / 10_000 : 0;
}

// ── The villager's own calls, from the trading desk ──────────────────────

export type DeskOrder = {
  action: "buy" | "short" | "close";
  coin?: Asset;
  /** The most of the purse to stake (0.05-1); the Kelly sizing may stake less. */
  sizePct?: number;
  /** Its honest chance (0-1) that the trade reaches take-profit before stop-loss. */
  chance?: number;
  tp?: number;
  sl?: number;
  hours?: number;
  why: string;
};

/**
 * Carry out a villager's own order from the trading desk, at market: close
 * its trade, or open one of its choosing (closing a different open trade
 * first — a switch is two fills). A new trade goes ahead only when its
 * chance — calibrated against how the villager's own calls have gone —
 * beats break-even by the edge bar, and is sized by Kelly (./risk.ts).
 * Orders it can't or shouldn't carry out do nothing and say why (`skipped`).
 */
export function deskStep(
  trader: Trader,
  order: DeskOrder,
  priceOf: (coin: Asset) => number,
  now: number,
  stakeSats: number,
  gate: Gate = () => null,
  exec: Executor = idealExecutor(priceOf),
): { trader: Trader; events: TradeEvent[]; skipped?: string; rejectedOrder?: RejectedOrder } {
  const why = order.why || "its own call";
  const events: TradeEvent[] = [];
  let t = trader;
  if (order.action === "close") {
    const pos = t.position;
    const px = pos ? priceOf(pos.coin) : 0;
    if (!pos || !(px > 0)) return { trader, events };
    const step = closeAt(t, pos, exec, now, why, true);
    return { trader: step.trader, events: [step.event!] };
  }
  const coin = order.coin;
  const side = order.action === "buy" ? "long" : "short";
  const px = coin ? priceOf(coin) : 0;
  if (!coin || !(px > 0)) return { trader, events, skipped: "no price" };
  if (t.position?.coin === coin && t.position.side === side) return { trader, events };
  const tp = clamp(order.tp ?? t.strategy.takeProfitPct, 0.5, 15);
  const sl = clamp(order.sl ?? t.strategy.stopLossPct, 0.3, 10);
  if (order.chance === undefined) return { trader, events, skipped: "gave no odds" };
  const p = calibratedChance(t.knowledge, clamp(order.chance, 0, 0.99));
  const { edge, ok } = edgeOf(p, tp, sl);
  if (!ok) return { trader, events, skipped: `edge too thin (${edge >= 0 ? "+" : ""}${Math.round(edge * 100)} pts)` };
  const blocked = gate(coin, 0);
  if (blocked) return { trader, events, skipped: blocked };
  if (t.position) {
    const held = t.position;
    const heldPx = priceOf(held.coin);
    if (!(heldPx > 0)) return { trader, events };
    const step = closeAt(t, held, exec, now, `switching to ${side === "long" ? "buy" : "short"} ${coin}`, true);
    t = { ...step.trader, cooldownUntil: undefined, cooldownCoin: undefined };
    events.push(step.event!);
  } else if (t.cooldownCoin === coin && (t.cooldownUntil ?? 0) > now) {
    return { trader, events, skipped: "just left that coin" };
  }
  const size = clamp(order.sizePct ?? 1, 0.05, 1);
  const stake = Math.min(stakeFor(t.balance, size, stakeSats), stakeForRisk(t.balance, Math.min(riskShare(kelly(p, tp, sl)), t.riskCap ?? 1), sl));
  if (stake <= 0) return { trader: t, events };
  const capped = gate(coin, stake);
  if (capped) return { trader: t, events, skipped: capped };
  const own = { tp, sl, maxHoldH: clamp(order.hours ?? 12, 0.25, 48) };
  const reason = `${why} (${Math.round(p * 100)}% chance, +${Math.round(edge * 100)} pts edge)`;
  const step = openAt(t, { coin, side, stake, reason, by: "own", own, sl }, now, exec);
  if (!step.event) return { trader: t, events, skipped: step.rejected, rejectedOrder: step.rejectedOrder };
  events.push(step.event);
  return { trader: step.trader, events };
}

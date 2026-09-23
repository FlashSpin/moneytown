/**
 * Day-trading strategies — pure, so they are easy to test.
 *
 * Every villager runs one strategy on a small watchlist, every trading tick
 * (5 minutes): with no position it looks for an entry signal; with one it
 * checks take-profit, stop-loss, a trailing stop, the strategy's own exit
 * signal and a time limit. Each fill pays a fee, like a real exchange. The
 * AI (King's advice + the villagers' council) chooses and tunes strategies a
 * few times a day; the code trades them in between.
 */
import { SIZE_DEFAULT, SIZE_MIN, SIZE_WEAK_MAX, WEAK_PURSE_SHARE } from "./constants.ts";
import type { Asset } from "./dawn.ts";
import { change, priorRange, rsi, sma } from "./indicators.ts";
import type { Temper } from "./trading.ts";

/** Fee per fill (open and close), as a fraction — about what a small account pays an exchange. */
export const FEE_RATE = 0.004;
/** After closing, a villager waits this many ticks before trading that coin again. */
export const COOLDOWN_TICKS = 2;
export const TICK_MS = 5 * 60_000;

export type StrategyKind = "scalp" | "momentum" | "breakout" | "reversion" | "trend";
export const STRATEGY_KINDS: StrategyKind[] = ["scalp", "momentum", "breakout", "reversion", "trend"];

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
};

export type Strategy = {
  kind: StrategyKind;
  /** Coins it watches, 1-3, in order of preference. */
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
  reason: string;
};

// ── Choosing and tidying strategies ──────────────────────────────────────

const TEMPER_STRATEGY: Record<Temper, { kind: StrategyKind; size: number; shorts: boolean }> = {
  trend: { kind: "trend", size: 0.3, shorts: true },
  contrarian: { kind: "reversion", size: 0.25, shorts: true },
  cautious: { kind: "reversion", size: 0.15, shorts: false },
  bold: { kind: "breakout", size: 0.4, shorts: true },
  steady: { kind: "momentum", size: 0.25, shorts: false },
};

function hash(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A villager's own strategy when no council has chosen one: its temperament's, on its own watchlist. */
export function defaultStrategy(id: string, temper: Temper, market: Asset[]): Strategy {
  const t = TEMPER_STRATEGY[temper];
  const info = STRATEGY_INFO[t.kind];
  const pool = market.length ? market : ["BTC"];
  // Spread the parish: each villager starts at a different place in the market.
  const start = hash(id) % pool.length;
  const coins = [0, 1, 2].map((k) => pool[(start + k * 3) % pool.length]!).filter((c, i, a) => a.indexOf(c) === i);
  return { kind: t.kind, coins, sizePct: t.size, takeProfitPct: info.tp, stopLossPct: info.sl, shorts: t.shorts };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Tidy a proposed strategy (from the AI or the owner): a known kind, 1-3
 * listed coins, sane size and targets. Unknown pieces fall back to `base`.
 */
export function cleanStrategy(raw: unknown, base: Strategy, market: Asset[]): Strategy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = STRATEGY_KINDS.includes(String(r.kind ?? r.strategy ?? "").toLowerCase() as StrategyKind)
    ? (String(r.kind ?? r.strategy).toLowerCase() as StrategyKind)
    : base.kind;
  const listed = new Set(market);
  const coinsIn = Array.isArray(r.coins) ? r.coins : typeof r.coins === "string" ? String(r.coins).split(/[,\s]+/) : [];
  const coins = [...new Set(coinsIn.map((c) => String(c).trim().toUpperCase()).filter((c) => listed.has(c)))].slice(0, 3);
  const num = (v: unknown) => (typeof v === "number" || typeof v === "string" ? Number(v) : NaN);
  const size = num(r.sizePct ?? r.size);
  const tp = num(r.takeProfitPct ?? r.takeProfit ?? r.tp);
  const sl = num(r.stopLossPct ?? r.stopLoss ?? r.sl);
  const kindChanged = kind !== base.kind;
  return {
    kind,
    coins: coins.length ? coins : base.coins,
    sizePct: Number.isFinite(size) && size > 0 ? clamp(size > 1 ? size / 100 : size, SIZE_MIN, 1) : base.sizePct,
    takeProfitPct: Number.isFinite(tp) && tp > 0 ? clamp(tp, 0.5, 15) : kindChanged ? STRATEGY_INFO[kind].tp : base.takeProfitPct,
    stopLossPct: Number.isFinite(sl) && sl > 0 ? clamp(sl, 0.3, 10) : kindChanged ? STRATEGY_INFO[kind].sl : base.stopLossPct,
    shorts: typeof r.shorts === "boolean" ? r.shorts : base.shorts,
    note: typeof r.note === "string" ? r.note.replace(/\s+/g, " ").trim().slice(0, 200) : typeof r.plan === "string" ? String(r.plan).slice(0, 200) : base.note,
  };
}

// ── Signals ──────────────────────────────────────────────────────────────

export type Signal = { side: "long" | "short"; reason: string } | null;

/** The strategy's entry signal on one coin's price series. */
export function entrySignal(kind: StrategyKind, s: number[]): Signal {
  if (s.length < STRATEGY_INFO[kind].warmup) return null;
  switch (kind) {
    case "scalp": {
      const c = change(s, 3)!;
      if (c > 0.3) return { side: "long", reason: `up ${c.toFixed(2)}% in 15 min` };
      if (c < -0.3) return { side: "short", reason: `down ${Math.abs(c).toFixed(2)}% in 15 min` };
      return null;
    }
    case "momentum": {
      const c = change(s, 6)!;
      if (c > 0.8) return { side: "long", reason: `momentum +${c.toFixed(2)}% in 30 min` };
      if (c < -0.8) return { side: "short", reason: `momentum ${c.toFixed(2)}% in 30 min` };
      return null;
    }
    case "breakout": {
      const r = priorRange(s, 24)!;
      const last = s[s.length - 1]!;
      if (last > r.high) return { side: "long", reason: `broke the 2-hour high` };
      if (last < r.low) return { side: "short", reason: `broke the 2-hour low` };
      return null;
    }
    case "reversion": {
      const v = rsi(s, 14)!;
      if (v < 30) return { side: "long", reason: `oversold, RSI ${v.toFixed(0)}` };
      if (v > 70) return { side: "short", reason: `overbought, RSI ${v.toFixed(0)}` };
      return null;
    }
    case "trend": {
      const fast = sma(s, 6)!;
      const slow = sma(s, 24)!;
      const fastBefore = sma(s, 6, 1)!;
      const slowBefore = sma(s, 24, 1)!;
      if (fast > slow && fastBefore <= slowBefore) return { side: "long", reason: "30-min average crossed above 2-hour" };
      if (fast < slow && fastBefore >= slowBefore) return { side: "short", reason: "30-min average crossed below 2-hour" };
      return null;
    }
  }
}

/** The strategy's own reason to leave early (beyond targets and stops). */
function exitSignal(kind: StrategyKind, side: "long" | "short", s: number[]): string | null {
  if (kind === "reversion") {
    const v = rsi(s, 14);
    if (v !== null && ((side === "long" && v >= 50) || (side === "short" && v <= 50))) return `RSI back to ${v.toFixed(0)}`;
  }
  if (kind === "trend") {
    const fast = sma(s, 6);
    const slow = sma(s, 24);
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
};

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

/**
 * One tick for one villager: manage the open position, or look for an entry.
 * Returns the updated trader and what happened (at most one fill per tick).
 */
export function tradeStep(
  trader: Trader,
  priceOf: (coin: Asset) => number,
  seriesOf: (coin: Asset) => number[],
  now: number,
  stakeSats: number,
): { trader: Trader; event: TradeEvent | null } {
  const st = trader.strategy;
  const info = STRATEGY_INFO[st.kind];
  const pos = trader.position;

  if (pos) {
    const px = priceOf(pos.coin);
    if (!(px > 0)) return { trader, event: null };
    const peak = pos.side === "long" ? Math.max(pos.peakUsd, px) : Math.min(pos.peakUsd, px);
    const movePct = ((px - pos.entryUsd) / pos.entryUsd) * 100 * (pos.side === "long" ? 1 : -1);
    const fromPeakPct = ((px - peak) / peak) * 100 * (pos.side === "long" ? -1 : 1);
    let reason: string | null = null;
    if (movePct >= st.takeProfitPct) reason = `take-profit +${movePct.toFixed(2)}%`;
    else if (movePct <= -st.stopLossPct) reason = `stop-loss ${movePct.toFixed(2)}%`;
    else if (st.kind === "trend" && movePct > 0 && fromPeakPct >= st.stopLossPct) reason = `trailing stop, ${fromPeakPct.toFixed(2)}% off the peak`;
    else reason = exitSignal(st.kind, pos.side, seriesOf(pos.coin));
    if (!reason && now - pos.openedAt >= info.maxHoldH * 3_600_000) reason = `time limit (${info.maxHoldH}h)`;
    if (!reason) return { trader: { ...trader, position: { ...pos, peakUsd: peak } }, event: null };

    const gross = unrealized(pos, px);
    const fee = Math.round((pos.stake + gross) * FEE_RATE);
    const pnl = gross - fee;
    const r = trader.record ?? { wins: 0, losses: 0, pnl: 0 };
    return {
      trader: {
        ...trader,
        balance: Math.max(0, trader.balance + pnl),
        position: undefined,
        cooldownUntil: now + COOLDOWN_TICKS * TICK_MS,
        cooldownCoin: pos.coin,
        record: { wins: r.wins + (pnl > 0 ? 1 : 0), losses: r.losses + (pnl <= 0 ? 1 : 0), pnl: r.pnl + pnl },
        trades: (trader.trades ?? 0) + 1,
      },
      event: { t: now, id: trader.id, name: trader.firstName, action: "close", coin: pos.coin, side: pos.side, price: px, pnl, reason },
    };
  }

  for (const coin of st.coins) {
    if (trader.cooldownCoin === coin && (trader.cooldownUntil ?? 0) > now) continue;
    const px = priceOf(coin);
    if (!(px > 0)) continue;
    const sig = entrySignal(st.kind, seriesOf(coin));
    if (!sig || (sig.side === "short" && !st.shorts)) continue;
    const stake = stakeFor(trader.balance, st.sizePct, stakeSats);
    if (stake <= 0) return { trader, event: null };
    const fee = Math.round(stake * FEE_RATE);
    return {
      trader: {
        ...trader,
        balance: trader.balance - fee,
        position: { coin, side: sig.side, stake, entryUsd: px, openedAt: now, peakUsd: px },
        trades: (trader.trades ?? 0) + 1,
      },
      event: { t: now, id: trader.id, name: trader.firstName, action: "open", coin, side: sig.side, price: px, reason: sig.reason },
    };
  }
  return { trader, event: null };
}

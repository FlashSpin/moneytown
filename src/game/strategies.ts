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
import { change, priorRange, rsi, sma } from "./indicators.ts";
import { avoids, coinEdge, learnTrade, type Approach, type Knowledge } from "./knowledge.ts";
import type { Gate } from "./limits.ts";
import { calibratedChance, edgeOf, FEE_RATE, kelly, riskShare, stakeForRisk, strategyRisk } from "./risk.ts";
import type { Temper } from "./trading.ts";

export { FEE_RATE } from "./risk.ts";
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
  /** The villager's own targets for a trade it placed itself (instead of its strategy's). */
  own?: { tp: number; sl: number; maxHoldH: number };
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
  cautious: { kind: "reversion", size: 0.15, shorts: false },
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
  };
}

// ── Signals ──────────────────────────────────────────────────────────────

/** An entry signal; `strength` is 1 at the threshold and grows with the move (for picking the best coin). */
export type Signal = { side: "long" | "short"; reason: string; strength: number } | null;

/** The strategy's entry signal on one coin's price series. */
export function entrySignal(kind: StrategyKind, s: number[]): Signal {
  if (s.length < STRATEGY_INFO[kind].warmup) return null;
  switch (kind) {
    case "scalp": {
      const c = change(s, 3)!;
      if (c > 0.3) return { side: "long", reason: `up ${c.toFixed(2)}% in 15 min`, strength: c / 0.3 };
      if (c < -0.3) return { side: "short", reason: `down ${Math.abs(c).toFixed(2)}% in 15 min`, strength: -c / 0.3 };
      return null;
    }
    case "momentum": {
      const c = change(s, 6)!;
      if (c > 0.8) return { side: "long", reason: `momentum +${c.toFixed(2)}% in 30 min`, strength: c / 0.8 };
      if (c < -0.8) return { side: "short", reason: `momentum ${c.toFixed(2)}% in 30 min`, strength: -c / 0.8 };
      return null;
    }
    case "breakout": {
      const r = priorRange(s, 24)!;
      const last = s[s.length - 1]!;
      if (last > r.high) return { side: "long", reason: `broke the 2-hour high`, strength: 1 + ((last - r.high) / r.high) * 500 };
      if (last < r.low) return { side: "short", reason: `broke the 2-hour low`, strength: 1 + ((r.low - last) / r.low) * 500 };
      return null;
    }
    case "reversion": {
      const v = rsi(s, 14)!;
      if (v < 30) return { side: "long", reason: `oversold, RSI ${v.toFixed(0)}`, strength: 1 + (30 - v) / 10 };
      if (v > 70) return { side: "short", reason: `overbought, RSI ${v.toFixed(0)}`, strength: 1 + (v - 70) / 10 };
      return null;
    }
    case "trend": {
      const fast = sma(s, 6)!;
      const slow = sma(s, 24)!;
      const fastBefore = sma(s, 6, 1)!;
      const slowBefore = sma(s, 24, 1)!;
      const gap = 1 + (Math.abs(fast - slow) / slow) * 200;
      if (fast > slow && fastBefore <= slowBefore) return { side: "long", reason: "30-min average crossed above 2-hour", strength: gap };
      if (fast < slow && fastBefore >= slowBefore) return { side: "short", reason: "30-min average crossed below 2-hour", strength: gap };
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
  knowledge?: Knowledge;
};

type Step = { trader: Trader; event: TradeEvent | null };

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
function closeAt(trader: Trader, pos: Position, px: number, now: number, reason: string, own = false): Step {
  const gross = unrealized(pos, px);
  const fee = Math.round((pos.stake + gross) * FEE_RATE);
  // A purse can't go below nothing: a loss bigger than the purse takes only what is there.
  const balance = Math.max(0, trader.balance + gross - fee);
  const pnl = balance - trader.balance;
  const r = trader.record ?? { wins: 0, losses: 0, pnl: 0 };
  return {
    trader: {
      ...trader,
      balance,
      position: undefined,
      cooldownUntil: now + COOLDOWN_TICKS * TICK_MS,
      cooldownCoin: pos.coin,
      record: { wins: r.wins + (pnl > 0 ? 1 : 0), losses: r.losses + (pnl <= 0 ? 1 : 0), pnl: r.pnl + pnl },
      trades: (trader.trades ?? 0) + 1,
      knowledge: learnTrade(trader.knowledge, { coin: pos.coin, side: pos.side, approach: pos.by ?? trader.strategy.kind, pnl }),
    },
    event: { t: now, id: trader.id, name: trader.firstName, action: "close", coin: pos.coin, side: pos.side, price: px, pnl, fee, reason, ...(own ? { own } : {}) },
  };
}

/** Open a position: pay the fee on the stake. */
function openAt(
  trader: Trader,
  open: { coin: Asset; side: "long" | "short"; stake: number; px: number; reason: string; by: Approach; own?: Position["own"]; risk: number },
  now: number,
): Step {
  const fee = Math.round(open.stake * FEE_RATE);
  const position: Position = { coin: open.coin, side: open.side, stake: open.stake, entryUsd: open.px, openedAt: now, peakUsd: open.px, by: open.by };
  if (open.own) position.own = open.own;
  return {
    trader: { ...trader, balance: trader.balance - fee, position, trades: (trader.trades ?? 0) + 1 },
    event: {
      t: now,
      id: trader.id,
      name: trader.firstName,
      action: "open",
      coin: open.coin,
      side: open.side,
      price: open.px,
      fee,
      reason: open.reason,
      risk: open.risk,
      ...(open.own ? { own: true } : {}),
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
  seriesOf: (coin: Asset) => number[],
  now: number,
  stakeSats: number,
  universe: Asset[] = [],
  hot: ReadonlySet<Asset> = new Set(),
  gate: Gate = () => null,
): Step {
  const st = trader.strategy;
  const pos = trader.position;

  if (pos) {
    const px = priceOf(pos.coin);
    if (!(px > 0)) return { trader, event: null };
    // A trade the villager placed itself keeps its own targets; a strategy's trade follows the strategy.
    const tp = pos.own?.tp ?? st.takeProfitPct;
    const sl = pos.own?.sl ?? st.stopLossPct;
    const kind = pos.by && pos.by !== "own" ? pos.by : pos.own ? null : st.kind;
    const maxHoldH = pos.own?.maxHoldH ?? STRATEGY_INFO[kind ?? st.kind].maxHoldH;
    const peak = pos.side === "long" ? Math.max(pos.peakUsd, px) : Math.min(pos.peakUsd, px);
    const movePct = ((px - pos.entryUsd) / pos.entryUsd) * 100 * (pos.side === "long" ? 1 : -1);
    const fromPeakPct = ((px - peak) / peak) * 100 * (pos.side === "long" ? -1 : 1);
    let reason: string | null = null;
    if (movePct >= tp) reason = `take-profit +${movePct.toFixed(2)}%`;
    else if (movePct <= -sl) reason = `stop-loss ${movePct.toFixed(2)}%`;
    else if (kind === "trend" && movePct > 0 && fromPeakPct >= sl) reason = `trailing stop, ${fromPeakPct.toFixed(2)}% off the peak`;
    else if (kind) reason = exitSignal(kind, pos.side, seriesOf(pos.coin));
    if (!reason && now - pos.openedAt >= maxHoldH * 3_600_000) reason = `time limit (${maxHoldH}h)`;
    if (!reason) return { trader: { ...trader, position: { ...pos, peakUsd: peak } }, event: null };
    return closeAt(trader, pos, px, now, reason);
  }

  const scan = st.coins.length ? st.coins : universe.length ? universe : st.coins;
  let best: { coin: Asset; sig: NonNullable<Signal>; px: number; score: number } | null = null;
  for (const coin of scan) {
    if (trader.cooldownCoin === coin && (trader.cooldownUntil ?? 0) > now) continue;
    if (avoids(trader.knowledge, coin)) continue;
    const px = priceOf(coin);
    if (!(px > 0)) continue;
    const sig = entrySignal(st.kind, seriesOf(coin));
    if (!sig || (sig.side === "short" && !st.shorts)) continue;
    if (gate(coin, 0)) continue;
    // Coins it has done well on count for more; focus coins win ties in their listed order.
    const score = Math.min(sig.strength, 5) * (1 + 0.5 * coinEdge(trader.knowledge, coin)) * (hot.has(coin) ? 1.15 : 1);
    if (!best || score > best.score) best = { coin, sig, px, score };
  }
  if (!best) return { trader, event: null };
  const risk = strategyRisk(trader.knowledge, st.kind, best.coin, st.takeProfitPct, st.stopLossPct);
  const stake = Math.min(stakeFor(trader.balance, st.sizePct, stakeSats), stakeForRisk(trader.balance, risk, st.stopLossPct));
  if (stake <= 0 || gate(best.coin, stake)) return { trader, event: null };
  const atRisk = riskAt(stake, trader.balance, st.stopLossPct);
  return openAt(trader, { coin: best.coin, side: best.sig.side, stake, px: best.px, reason: best.sig.reason, by: st.kind, risk: atRisk }, now);
}

/** Share of the purse a stake loses at the stop, fees included. */
function riskAt(stake: number, balance: number, sl: number): number {
  return balance > 0 ? Math.round(((stake * (sl / 100 + 2 * FEE_RATE)) / balance) * 10_000) / 10_000 : 0;
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
): { trader: Trader; events: TradeEvent[]; skipped?: string } {
  const why = order.why || "its own call";
  const events: TradeEvent[] = [];
  let t = trader;
  if (order.action === "close") {
    const pos = t.position;
    const px = pos ? priceOf(pos.coin) : 0;
    if (!pos || !(px > 0)) return { trader, events };
    const step = closeAt(t, pos, px, now, why, true);
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
    const step = closeAt(t, held, heldPx, now, `switching to ${side === "long" ? "buy" : "short"} ${coin}`, true);
    t = { ...step.trader, cooldownUntil: undefined, cooldownCoin: undefined };
    events.push(step.event!);
  } else if (t.cooldownCoin === coin && (t.cooldownUntil ?? 0) > now) {
    return { trader, events, skipped: "just left that coin" };
  }
  const size = clamp(order.sizePct ?? 1, 0.05, 1);
  const stake = Math.min(stakeFor(t.balance, size, stakeSats), stakeForRisk(t.balance, riskShare(kelly(p, tp, sl)), sl));
  if (stake <= 0) return { trader: t, events };
  const capped = gate(coin, stake);
  if (capped) return { trader: t, events, skipped: capped };
  const own = { tp, sl, maxHoldH: clamp(order.hours ?? 12, 0.25, 48) };
  const reason = `${why} (${Math.round(p * 100)}% chance, +${Math.round(edge * 100)} pts edge)`;
  const step = openAt(t, { coin, side, stake, px, reason, by: "own", own, risk: riskAt(stake, t.balance, sl) }, now);
  events.push(step.event!);
  return { trader: step.trader, events };
}

/**
 * What a villager has learned from its own trading — pure, so it is easy to
 * test. Every closed trade is tallied by coin, by the approach that opened it
 * (a strategy, or the villager's own call at the trading desk) and by side;
 * the AI adds short written lessons at the councils and the desk. The
 * strategies lean on it when choosing among coins (src/game/strategies.ts),
 * and the AI reads it before every decision (src/game/llm.server.ts), so each
 * villager builds on its experience instead of starting fresh.
 */
import type { Asset } from "./dawn.ts";

/** Wins, losses and net P&L in sats (fees included). */
export type Tally = { w: number; l: number; pnl: number };

/** "own" = trades a villager placed itself at the trading desk. */
export type Approach = "scalp" | "momentum" | "breakout" | "reversion" | "trend" | "conservative" | "volatility" | "own";

export type Knowledge = {
  coins: Record<Asset, Tally>;
  approaches: Partial<Record<Approach, Tally>>;
  sides: { long: Tally; short: Tally };
  /** Written lessons, newest last. */
  lessons: string[];
};

export const LESSONS_KEPT = 6;
/** Closed trades on a coin before its record counts for anything. */
export const MIN_SAMPLE = 3;

const zero = (): Tally => ({ w: 0, l: 0, pnl: 0 });

export function emptyKnowledge(): Knowledge {
  return { coins: {}, approaches: {}, sides: { long: zero(), short: zero() }, lessons: [] };
}

function add(t: Tally | undefined, pnl: number): Tally {
  const b = t ?? zero();
  return { w: b.w + (pnl > 0 ? 1 : 0), l: b.l + (pnl > 0 ? 0 : 1), pnl: b.pnl + pnl };
}

/** Tally one closed trade. */
export function learnTrade(
  k: Knowledge | undefined,
  trade: { coin: Asset; side: "long" | "short"; approach: Approach; pnl: number },
): Knowledge {
  const base = k ?? emptyKnowledge();
  return {
    ...base,
    coins: { ...base.coins, [trade.coin]: add(base.coins[trade.coin], trade.pnl) },
    approaches: { ...base.approaches, [trade.approach]: add(base.approaches[trade.approach], trade.pnl) },
    sides: { ...base.sides, [trade.side]: add(base.sides[trade.side], trade.pnl) },
  };
}

/** Add a written lesson, skipping repeats; keeps the newest few. */
export function addLesson(k: Knowledge | undefined, text: unknown): Knowledge {
  const base = k ?? emptyKnowledge();
  const lesson = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (lesson.length < 8) return base;
  const key = lesson.toLowerCase();
  const kept = base.lessons.filter((l) => l.toLowerCase() !== key);
  return { ...base, lessons: [...kept, lesson].slice(-LESSONS_KEPT) };
}

/**
 * How well a coin has gone for this villager, from -1 (always loses) to +1
 * (always wins); 0 until it has traded it a few times. Laplace-smoothed so a
 * lucky first trade doesn't count for much.
 */
export function coinEdge(k: Knowledge | undefined, coin: Asset): number {
  const t = k?.coins[coin];
  if (!t) return 0;
  const n = t.w + t.l;
  if (n < MIN_SAMPLE) return 0;
  const rate = (t.w + 1) / (n + 2);
  const confidence = Math.min(1, n / 8);
  return (rate - 0.5) * 2 * confidence;
}

/** A coin this villager has learned to leave alone: it keeps losing money on it. */
export function avoids(k: Knowledge | undefined, coin: Asset): boolean {
  const t = k?.coins[coin];
  if (!t) return false;
  const n = t.w + t.l;
  return n >= 4 && t.pnl < 0 && t.w / n < 0.35;
}

/** Plain summary for the AI and the ledger: best and worst coins, how each approach has gone, and the lessons. */
export function describeKnowledge(k: Knowledge | undefined, money: (sats: number) => string): string {
  if (!k) return "nothing learned yet";
  const signed = (n: number) => `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`;
  const row = (name: string, t: Tally) => `${name} ${t.w}W/${t.l}L ${signed(t.pnl)}`;
  const coins = Object.entries(k.coins).sort((a, b) => b[1].pnl - a[1].pnl);
  const parts: string[] = [];
  if (coins.length) {
    const best = coins.slice(0, 3).filter(([, t]) => t.pnl > 0);
    const worst = coins.slice(-3).reverse().filter(([, t]) => t.pnl < 0);
    if (best.length) parts.push(`best coins: ${best.map(([c, t]) => row(c, t)).join(", ")}`);
    if (worst.length) parts.push(`worst coins: ${worst.map(([c, t]) => row(c, t)).join(", ")}`);
  }
  const approaches = Object.entries(k.approaches) as [Approach, Tally][];
  if (approaches.length) parts.push(`by approach: ${approaches.map(([a, t]) => row(a, t)).join(", ")}`);
  const { long, short } = k.sides;
  if (long.w + long.l + short.w + short.l) parts.push(`longs ${long.w}W/${long.l}L, shorts ${short.w}W/${short.l}L`);
  if (k.lessons.length) parts.push(`lessons: ${k.lessons.map((l) => `"${l}"`).join(" ")}`);
  return parts.join("; ") || "nothing learned yet";
}

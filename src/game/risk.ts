/**
 * Position sizing and the edge test — pure, so they are easy to test.
 *
 * Every trade is sized by the Kelly criterion from the villager's chance of
 * winning (learned from its own record, or the AI's honest estimate at the
 * trading desk, calibrated against how its past calls actually went), at
 * half-Kelly, and capped so that no single trade can lose more than
 * MAX_RISK of the purse at its stop-loss. A villager's own call at the desk
 * only goes ahead when its chance beats the break-even chance by MIN_EDGE:
 * a trade has to look clearly mispriced, not merely interesting.
 */
import type { Asset } from "./dawn.ts";
import { MIN_SAMPLE, type Approach, type Knowledge, type Tally } from "./knowledge.ts";

/** Fee per fill (open and close), as a fraction — about what a small account pays an exchange. */
export const FEE_RATE = 0.004;
/** Both fills, in percent of the stake. */
export const ROUND_TRIP_PCT = FEE_RATE * 2 * 100;
/** The most of its purse a villager may lose on one trade, at the stop (6%). */
export const MAX_RISK = 0.06;
/** The least it risks — a losing approach keeps trading small, so it can still learn. */
export const MIN_RISK = 0.005;
/** What it risks before it has a record to size from. */
export const PRIOR_RISK = 0.02;
/** Its chance must beat break-even by this much (8 points) for its own call to go ahead. */
export const MIN_EDGE = 0.08;
/** Trades of one approach before its record sizes the next one. */
export const SIZING_SAMPLE = 5;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The chance of winning at which a trade to `tp`% / `sl`% breaks even after fees. */
export function breakEven(tp: number, sl: number): number {
  return (sl + ROUND_TRIP_PCT) / (tp + sl);
}

/**
 * The Kelly fraction — the share of the purse to put at risk — for a trade
 * that wins `tp`% or loses `sl`% (fees included) with chance `p`. Negative
 * when the trade has no edge.
 */
export function kelly(p: number, tp: number, sl: number): number {
  const win = tp - ROUND_TRIP_PCT;
  const loss = sl + ROUND_TRIP_PCT;
  if (!(win > 0) || !(loss > 0)) return -1;
  return p - (1 - p) / (win / loss);
}

/** Half-Kelly, between MIN_RISK and MAX_RISK. */
export function riskShare(kellyFraction: number): number {
  return kellyFraction > 0 ? clamp(kellyFraction / 2, MIN_RISK, MAX_RISK) : MIN_RISK;
}

/** The stake that loses `risk` of the purse if the stop is hit (fees included). */
export function stakeForRisk(balance: number, risk: number, sl: number): number {
  return Math.floor((balance * risk) / ((sl + ROUND_TRIP_PCT) / 100));
}

const laplace = (t: Tally) => (t.w + 1) / (t.w + t.l + 2);
const count = (t: Tally | undefined) => (t ? t.w + t.l : 0);

/**
 * A villager's learned chance of winning with `approach` (on `coin`, when it
 * has traded that coin enough to say), or null until it has a record.
 */
export function learnedChance(k: Knowledge | undefined, approach: Approach, coin?: Asset): number | null {
  const a = k?.approaches[approach];
  if (!a || count(a) < SIZING_SAMPLE) return null;
  const c = coin ? k?.coins[coin] : undefined;
  return c && count(c) >= MIN_SAMPLE ? (laplace(a) + laplace(c)) / 2 : laplace(a);
}

/** Risk for a strategy's trade: Kelly on its learned chance, or the prior until it has a record. */
export function strategyRisk(k: Knowledge | undefined, approach: Approach, coin: Asset, tp: number, sl: number): number {
  const p = learnedChance(k, approach, coin);
  return p === null ? PRIOR_RISK : riskShare(kelly(p, tp, sl));
}

/**
 * The AI's estimated chance for its own call, pulled towards how its own
 * calls have actually gone — the more calls on record, the harder.
 */
export function calibratedChance(k: Knowledge | undefined, estimate: number): number {
  const own = k?.approaches.own;
  const n = count(own);
  if (!own || n < MIN_SAMPLE) return estimate;
  const w = n / (n + 10);
  return estimate * (1 - w) + laplace(own) * w;
}

/** Whether a call with chance `p` clears the edge bar, and by how much. */
export function edgeOf(p: number, tp: number, sl: number): { edge: number; ok: boolean } {
  const edge = p - breakEven(tp, sl);
  return { edge, ok: edge >= MIN_EDGE };
}

/**
 * The day's dues and the villagers' temperaments — pure, so they are easy to
 * test. Trading itself (positions, strategies, fills) lives in ./strategies.ts.
 */

/**
 * The day's dues, at dawn:
 *   1. tax: `taxRate` of the day's banked profit, after setting it against
 *      losses carried forward from earlier losing days (nothing on a losing
 *      day, whose loss is carried forward instead);
 *   2. upkeep: `rent`, or whatever is left if the purse can't cover it;
 *   3. a purse left below `floor` hangs.
 */
export function settleDay(p: { balance: number; dayStart: number; taxRate: number; rent: number; floor: number; carry?: number }): {
  profit: number;
  tithe: number;
  rentPaid: number;
  balance: number;
  hanged: boolean;
  /** Losses still to be set against future profits. */
  carry: number;
  /** How much of today's profit earlier losses sheltered from tax. */
  offset: number;
} {
  let balance = Math.max(0, p.balance);
  const profit = balance - p.dayStart;
  const rate = Math.min(1, Math.max(0, p.taxRate));
  const before = Math.max(0, p.carry ?? 0);
  const offset = profit > 0 ? Math.min(before, profit) : 0;
  const carry = profit > 0 ? before - offset : before - profit;
  const tithe = Math.floor(Math.max(0, profit - offset) * rate);
  balance -= tithe;
  const rentPaid = Math.min(Math.max(0, p.rent), balance);
  balance -= rentPaid;
  return { profit, tithe, rentPaid, balance, hanged: balance < p.floor, carry, offset };
}

/** History shorter than this says nothing a 24h change doesn't say better. */
export const TREND_MIN_SPAN_MS = 3 * 3_600_000;

// ── Temperaments: each villager trades in its own way ───────────────────────

export type Temper = "trend" | "contrarian" | "cautious" | "bold" | "steady";
export const TEMPERS: Temper[] = ["trend", "contrarian", "cautious", "bold", "steady"];

export const TEMPER_DESCRIPTIONS: Record<Temper, string> = {
  trend: "a trend-follower who rides whatever is moving",
  contrarian: "a contrarian who bets against moves that look overdone",
  cautious: "a cautious trader who risks little and sits out doubtful markets",
  bold: "a bold trader who backs strong convictions with bigger stakes",
  steady: "a steady trader who holds positions and dislikes needless changes",
};

/** A stable temperament for villagers born before temperaments existed. */
export function temperOf(id: string): Temper {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEMPERS[h % TEMPERS.length]!;
}

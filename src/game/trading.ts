/**
 * The day's dues and the villagers' temperaments — pure, so they are easy to
 * test. Trading itself (positions, strategies, fills) lives in ./strategies.ts.
 */

/** The day's dues: tax on today's profit (nothing on a losing day), then upkeep; below the floor hangs. */
export function settleDay(p: { balance: number; dayStart: number; taxRate: number; rent: number; floor: number }): {
  profit: number;
  tithe: number;
  rentPaid: number;
  balance: number;
  hanged: boolean;
} {
  let balance = Math.max(0, p.balance);
  const profit = balance - p.dayStart;
  const rate = Math.min(1, Math.max(0, p.taxRate));
  const tithe = Math.floor(Math.max(0, profit) * rate);
  balance -= tithe;
  const rentPaid = Math.min(Math.max(0, p.rent), balance);
  balance -= rentPaid;
  return { profit, tithe, rentPaid, balance, hanged: balance < p.floor };
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

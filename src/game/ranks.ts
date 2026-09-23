/**
 * Villager ranks — pure, so they are easy to test. A villager rises through
 * the ranks by its own record of closed trades, and each rank may risk a
 * little more of its purse on one trade (./risk.ts caps everyone at 6%):
 *
 *   Apprentice   fewer than 10 closed trades                  risks up to 3%
 *   Journeyman   10+ trades, not losing overall                risks up to 4%
 *   Merchant     30+ trades, in profit                         risks up to 5%
 *   Master       75+ trades, in profit, winning half or more   risks up to 6%
 *
 * A villager whose record turns falls back — rank is earned, not kept.
 */
export type Rank = "apprentice" | "journeyman" | "merchant" | "master";
export const RANKS: Rank[] = ["apprentice", "journeyman", "merchant", "master"];

export const RANK_INFO: Record<Rank, { label: string; riskCap: number; rule: string }> = {
  apprentice: { label: "Apprentice", riskCap: 0.03, rule: "fewer than 10 closed trades" },
  journeyman: { label: "Journeyman", riskCap: 0.04, rule: "10+ closed trades and not losing overall" },
  merchant: { label: "Merchant", riskCap: 0.05, rule: "30+ closed trades and in profit" },
  master: { label: "Master", riskCap: 0.06, rule: "75+ closed trades, in profit, winning at least half" },
};

export function rankOf(record: { wins: number; losses: number; pnl: number } | undefined): Rank {
  const n = record ? record.wins + record.losses : 0;
  if (!record || n < 10) return "apprentice";
  if (n >= 75 && record.pnl > 0 && record.wins / n >= 0.5) return "master";
  if (n >= 30 && record.pnl > 0) return "merchant";
  return record.pnl >= 0 ? "journeyman" : "apprentice";
}

/** +1 promoted, -1 demoted, 0 unchanged. */
export function rankChange(before: Rank, after: Rank): -1 | 0 | 1 {
  const d = RANKS.indexOf(after) - RANKS.indexOf(before);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

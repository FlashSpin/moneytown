/**
 * Merchant ranks — pure, so they are easy to test. A merchant rises by how
 * long it has invested and how it has done against a plain 60/40 over the
 * same days (./guild.ts `performance`):
 *
 *   Apprentice   fewer than 20 market days
 *   Journeyman   20+ days, and not losing money
 *   Merchant     60+ days, and ahead of the 60/40
 *   Master       120+ days, and 2 points or more ahead of the 60/40
 *
 * A merchant whose results turn falls back — rank is earned, not kept.
 */
import { performance, type MerchantFields } from "./guild.ts";

export type Rank = "apprentice" | "journeyman" | "merchant" | "master";
export const RANKS: Rank[] = ["apprentice", "journeyman", "merchant", "master"];

export const RANK_INFO: Record<Rank, { label: string; rule: string }> = {
  apprentice: { label: "Apprentice", rule: "fewer than 20 market days" },
  journeyman: { label: "Journeyman", rule: "20+ market days and not losing money" },
  merchant: { label: "Merchant", rule: "60+ market days and ahead of the 60/40" },
  master: { label: "Master", rule: "120+ market days and 2 points ahead of the 60/40" },
};

export function rankOf(s: Pick<MerchantFields, "worth" | "balance" | "track">, bench: number): Rank {
  const days = s.track?.days ?? 0;
  const p = performance(s, bench);
  if (!p || days < 20) return "apprentice";
  if (days >= 120 && p.ahead >= 0.02) return "master";
  if (days >= 60 && p.ahead > 0) return "merchant";
  return p.ret >= 0 ? "journeyman" : "apprentice";
}

/** +1 promoted, -1 demoted, 0 unchanged. */
export function rankChange(before: Rank, after: Rank): -1 | 0 | 1 {
  const d = RANKS.indexOf(after) - RANKS.indexOf(before);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

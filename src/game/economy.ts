/**
 * Survival and treasury rules, kept pure so they are easy to test.
 *
 * - A villager lives only while its wallet keeps proving it can earn.
 * - The King's treasury (and only the treasury) pays to open new villagers.
 * - New villagers inherit the agent setup of the best lifetime earner.
 */

export type KingPolicy = {
  /** The King never spends the treasury below this. */
  reserveSats: number;
  /** Cost of opening one villager, paid from the treasury. */
  stakeSats: number;
  maxLiving: number;
  maxSpawnsPerDawn: number;
  /** Do not open more villagers while this many are already in their first days. */
  maxUnproven: number;
};

export function defaultKingPolicy(stakeSats: number, maxLiving: number): KingPolicy {
  return {
    reserveSats: stakeSats * 2,
    stakeSats,
    maxLiving,
    maxSpawnsPerDawn: 1,
    maxUnproven: 2,
  };
}

/** How many villagers the King may open this dawn. Never spends below the reserve. */
export function kingSpawnCount(input: {
  treasury: number;
  living: number;
  unproven: number;
  policy: KingPolicy;
}): number {
  const { treasury, living, unproven, policy } = input;
  if (policy.stakeSats <= 0) return 0;
  const spendable = treasury - policy.reserveSats;
  if (spendable < policy.stakeSats) return 0;
  const byMoney = Math.floor(spendable / policy.stakeSats);
  const bySlots = Math.max(0, policy.maxLiving - living);
  const byProof = Math.max(0, policy.maxUnproven - unproven);
  return Math.max(0, Math.min(byMoney, bySlots, byProof, policy.maxSpawnsPerDawn));
}

export type Earner = {
  id: string;
  earnedSats?: number;
  brainChoice: string;
  brainModel: string;
};

/** The living villager with the highest lifetime earnings. Null when nobody has earned anything. */
export function pickParent<T extends Earner>(living: T[]): T | null {
  let best: T | null = null;
  for (const v of living) {
    const e = v.earnedSats ?? 0;
    if (e > 0 && (best == null || e > (best.earnedSats ?? 0))) best = v;
  }
  return best;
}

/** Consecutive dawns with no new money before a watched wallet is condemned. */
export const DRY_DAYS_LIMIT = 7;

/**
 * Income is measured by the wallet: a rise in the watched balance since last dawn.
 * Spending never counts as income and never hides it.
 */
export function walletIncome(prev: number | null, next: number | null): number {
  if (prev == null || next == null) return 0;
  return Math.max(0, next - prev);
}

export function nextDryDays(dryDays: number, income: number): number {
  return income > 0 ? 0 : dryDays + 1;
}

export function isStarved(dryDays: number, walletSats: number | null): boolean {
  if (walletSats != null && walletSats <= 0) return true;
  return dryDays >= DRY_DAYS_LIMIT;
}

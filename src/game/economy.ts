/**
 * Treasury rules, kept pure so they are easy to test.
 *
 * - A villager lives only while its purse can pay rent and tax.
 * - The King's treasury (and only the treasury) pays to open new villagers.
 */

export type KingPolicy = {
  /** The King never spends the treasury below this. */
  reservePence: number;
  /** Cost of opening one villager, paid from the treasury. */
  stakePence: number;
  maxLiving: number;
  maxSpawnsPerDawn: number;
  /** Do not open more villagers while this many are already in their first days. */
  maxUnproven: number;
};

export function defaultKingPolicy(stakePence: number, maxLiving: number): KingPolicy {
  return {
    reservePence: stakePence * 2,
    stakePence,
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
  if (policy.stakePence <= 0) return 0;
  const spendable = treasury - policy.reservePence;
  if (spendable < policy.stakePence) return 0;
  const byMoney = Math.floor(spendable / policy.stakePence);
  const bySlots = Math.max(0, policy.maxLiving - living);
  const byProof = Math.max(0, policy.maxUnproven - unproven);
  return Math.max(0, Math.min(byMoney, bySlots, byProof, policy.maxSpawnsPerDawn));
}

/**
 * How many souls a petition may have summoned, whatever the King's AI asked
 * for. Same treasury reserve as the daily rule, plus a per-petition and a
 * per-day ceiling so no one visitor (or a clever prompt) can empty the crown.
 */
export function petitionSummonCount(input: {
  requested: number;
  treasury: number;
  living: number;
  summonedToday: number;
  policy: KingPolicy;
  perPetition: number;
  perDay: number;
}): number {
  const { requested, treasury, living, summonedToday, policy, perPetition, perDay } = input;
  if (!Number.isFinite(requested) || requested <= 0 || policy.stakePence <= 0) return 0;
  const spendable = treasury - policy.reservePence;
  const byMoney = spendable < policy.stakePence ? 0 : Math.floor(spendable / policy.stakePence);
  const bySlots = Math.max(0, policy.maxLiving - living);
  const byDay = Math.max(0, perDay - summonedToday);
  return Math.max(0, Math.min(Math.floor(requested), byMoney, bySlots, byDay, perPetition));
}

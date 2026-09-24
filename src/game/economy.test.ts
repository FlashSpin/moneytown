import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultKingPolicy, kingSpawnCount, petitionSummonCount } from "./economy.ts";

const policy = defaultKingPolicy(1_000, 24);

describe("king spawning is paid from the treasury only", () => {
  it("never spends below the reserve", () => {
    assert.equal(kingSpawnCount({ treasury: 2_999, living: 0, unproven: 0, policy }), 0);
    assert.equal(kingSpawnCount({ treasury: 3_000, living: 0, unproven: 0, policy }), 1);
  });
  it("respects population and unproven caps and per-dawn limit", () => {
    const rich = { ...policy, maxSpawnsPerDawn: 5 };
    assert.equal(kingSpawnCount({ treasury: 1_000_000, living: 24, unproven: 0, policy: rich }), 0);
    assert.equal(kingSpawnCount({ treasury: 1_000_000, living: 0, unproven: 2, policy: rich }), 0);
    assert.equal(kingSpawnCount({ treasury: 1_000_000, living: 0, unproven: 0, policy: rich }), 2);
    assert.equal(kingSpawnCount({ treasury: 1_000_000, living: 22, unproven: 0, policy: rich }), 2);
  });
  it("zero stake never spawns", () => {
    assert.equal(
      kingSpawnCount({
        treasury: 9e9,
        living: 0,
        unproven: 0,
        policy: { ...policy, stakePence: 0 },
      }),
      0,
    );
  });
});

describe("petition summons stay inside the crown's rules", () => {
  const base = { treasury: 100_000, living: 0, summonedToday: 0, policy, perPetition: 3, perDay: 6 };

  it("grants what was asked when everything allows it", () => {
    assert.equal(petitionSummonCount({ ...base, requested: 2 }), 2);
  });

  it("caps a greedy request at the per-petition limit", () => {
    assert.equal(petitionSummonCount({ ...base, requested: 500 }), 3);
  });

  it("honours the daily limit across petitions", () => {
    assert.equal(petitionSummonCount({ ...base, requested: 3, summonedToday: 5 }), 1);
    assert.equal(petitionSummonCount({ ...base, requested: 3, summonedToday: 6 }), 0);
  });

  it("never spends below the reserve", () => {
    // reserve 2_000 + one stake of 1_000 = exactly one affordable soul
    assert.equal(petitionSummonCount({ ...base, requested: 3, treasury: 3_000 }), 1);
    assert.equal(petitionSummonCount({ ...base, requested: 3, treasury: 2_999 }), 0);
  });

  it("respects the living cap", () => {
    assert.equal(petitionSummonCount({ ...base, requested: 3, living: 23 }), 1);
    assert.equal(petitionSummonCount({ ...base, requested: 3, living: 24 }), 0);
  });

  it("treats nonsense requests as zero", () => {
    assert.equal(petitionSummonCount({ ...base, requested: -2 }), 0);
    assert.equal(petitionSummonCount({ ...base, requested: Number.NaN }), 0);
    assert.equal(petitionSummonCount({ ...base, requested: 0 }), 0);
  });
});

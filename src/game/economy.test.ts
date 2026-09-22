import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultKingPolicy, kingSpawnCount } from "./economy.ts";

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
        policy: { ...policy, stakeSats: 0 },
      }),
      0,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRY_DAYS_LIMIT,
  defaultKingPolicy,
  isStarved,
  kingSpawnCount,
  nextDryDays,
  pickParent,
  walletIncome,
} from "./economy.ts";

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

describe("survival is measured by the wallet", () => {
  it("only rises count as income", () => {
    assert.equal(walletIncome(1_000, 1_500), 500);
    assert.equal(walletIncome(1_000, 400), 0);
    assert.equal(walletIncome(null, 400), 0);
    assert.equal(walletIncome(400, null), 0);
  });
  it("dry days reset on income and condemn after the limit", () => {
    let d = 0;
    for (let i = 0; i < DRY_DAYS_LIMIT - 1; i++) d = nextDryDays(d, 0);
    assert.equal(isStarved(d, 5_000), false);
    d = nextDryDays(d, 0);
    assert.equal(isStarved(d, 5_000), true);
    assert.equal(nextDryDays(d, 1), 0);
  });
  it("an empty watched wallet is starved immediately", () => {
    assert.equal(isStarved(0, 0), true);
    assert.equal(isStarved(0, null), false);
  });
});

describe("children inherit from the best earner", () => {
  it("returns null when nobody has earned", () => {
    assert.equal(pickParent([{ id: "a", brainChoice: "grok", brainModel: "" }]), null);
  });
  it("picks the highest lifetime earnings", () => {
    const p = pickParent([
      { id: "a", earnedSats: 10, brainChoice: "grok", brainModel: "" },
      { id: "b", earnedSats: 90, brainChoice: "ollama", brainModel: "x" },
    ]);
    assert.equal(p?.id, "b");
  });
});

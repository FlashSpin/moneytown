import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { learnTrade, type Knowledge } from "./knowledge.ts";
import { breakEven, calibratedChance, edgeOf, kelly, MAX_RISK, MIN_RISK, PRIOR_RISK, riskShare, stakeForRisk, strategyRisk } from "./risk.ts";

const record = (approach: "momentum" | "own", w: number, l: number, coin = "SOL"): Knowledge => {
  let k: Knowledge | undefined;
  for (let i = 0; i < w; i++) k = learnTrade(k, { coin, side: "long", approach, pnl: 100 });
  for (let i = 0; i < l; i++) k = learnTrade(k, { coin, side: "long", approach, pnl: -100 });
  return k!;
};

describe("sizing and edge", () => {
  it("break-even includes both fees", () => {
    assert.ok(Math.abs(breakEven(2, 1) - 0.6) < 1e-9);
  });

  it("Kelly is positive only with an edge", () => {
    assert.ok(kelly(0.7, 2, 1) > 0);
    assert.ok(kelly(0.5, 2, 1) < 0);
    assert.equal(kelly(0.9, 0.5, 1), -1, "a target inside the fees can never pay");
  });

  it("risks half-Kelly, between the floor and the 6% cap", () => {
    assert.equal(riskShare(-0.2), MIN_RISK);
    assert.equal(riskShare(0.04), 0.02);
    assert.equal(riskShare(0.9), MAX_RISK);
  });

  it("sizes the stake so the stop loses exactly the risk", () => {
    const stake = stakeForRisk(100_000, 0.02, 1.2);
    assert.ok(Math.abs(stake * 0.02 - 2_000) < 1);
  });

  it("sizes strategy trades from the villager's record once it has one", () => {
    assert.equal(strategyRisk(undefined, "momentum", "SOL", 2.5, 1.5), PRIOR_RISK);
    assert.equal(strategyRisk(record("momentum", 1, 7), "momentum", "SOL", 2.5, 1.5), MIN_RISK, "losing: tiny stakes");
    assert.ok(strategyRisk(record("momentum", 9, 1), "momentum", "SOL", 2.5, 1.5) > PRIOR_RISK, "winning: bigger");
  });

  it("calibrates the AI's chance against how its own calls went", () => {
    assert.equal(calibratedChance(undefined, 0.7), 0.7);
    assert.ok(calibratedChance(record("own", 2, 18), 0.7) < 0.45);
    assert.ok(calibratedChance(record("own", 18, 2), 0.7) > 0.7);
  });

  it("needs an 8-point edge over break-even", () => {
    assert.equal(edgeOf(0.67, 2, 1).ok, false);
    assert.equal(edgeOf(0.69, 2, 1).ok, true);
  });
});

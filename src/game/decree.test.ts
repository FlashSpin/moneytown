import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsSeal, parseCommand, parseFavor, parseHalt, parseKinds, parseTaxPercent, resolveBanish } from "./decree.ts";

describe("royal commands are held to the law", () => {
  it("reads tax as percent or fraction, clamped to 0-60%", () => {
    assert.equal(parseTaxPercent(10), 0.1);
    assert.equal(parseTaxPercent("15%"), 0.15);
    assert.equal(parseTaxPercent(0.25), 0.25);
    assert.equal(parseTaxPercent(95), 0.6);
    assert.equal(parseTaxPercent(-5), 0);
    assert.equal(parseTaxPercent(0), 0);
    assert.equal(parseTaxPercent("auto"), "auto");
    assert.equal(parseTaxPercent(null), null);
    assert.equal(parseTaxPercent("lots"), null);
  });

  it("accepts only coins the market lists as the favoured market", () => {
    const coins = ["BTC", "ETH", "SOL", "DOGE"];
    assert.equal(parseFavor("eth", coins), "ETH");
    assert.equal(parseFavor("doge", coins), "DOGE");
    assert.equal(parseFavor("FAKECOIN", coins), null);
    assert.equal(parseFavor("auto", coins), "auto");
    assert.equal(parseFavor(undefined, coins), null);
  });

  it("banishes only souls that exist, never twice", () => {
    const living = [
      { id: "s-1", firstName: "Agnes" },
      { id: "s-2", firstName: "Hugh" },
    ];
    const hit = resolveBanish(living, ["agnes", "Nobody", "AGNES", "s-2"]);
    assert.deepEqual(hit.map((s) => s.firstName), ["Agnes", "Hugh"]);
  });

  it("parses a full command and knows what needs the seal", () => {
    const c = parseCommand({ summon: "2", banish: ["Hugh"], taxRate: 12, favorAsset: "sol" }, ["BTC", "SOL"]);
    assert.deepEqual(c, { summon: 2, banish: ["Hugh"], taxRate: 0.12, favorAsset: "SOL", strategies: [], halt: null, pause: [], resume: [] });
    assert.equal(needsSeal(c), true);
    assert.equal(needsSeal(parseCommand({ summon: 1 }, [])), false);
    assert.equal(needsSeal(parseCommand({ banish: [], taxRate: null }, [])), false);
    const s = parseCommand({ strategies: [{ name: "Agnes", kind: "scalp", coins: ["SOL"] }, { kind: "trend" }, "junk"] }, []);
    assert.deepEqual(s.strategies.map((x) => x.name), ["Agnes"], "unnamed and junk entries are dropped");
    assert.equal(needsSeal(s), true, "setting strategies needs the seal");
  });
});

describe("halting trading", () => {
  it("reads halt and resume, and needs the seal", () => {
    assert.equal(parseHalt("halt"), true);
    assert.equal(parseHalt("Resume"), false);
    assert.equal(parseHalt(true), true);
    assert.equal(parseHalt(null), null);
    assert.equal(parseHalt("maybe"), null);
    assert.equal(needsSeal(parseCommand({ halt: "halt" }, [])), true);
    assert.equal(parseCommand({}, []).halt, null);
  });
});

describe("pausing a strategy", () => {
  it("reads the strategies to pause or resume, and needs the seal", () => {
    assert.deepEqual(parseKinds(["Scalp", "nonsense", "scalp", "trend"]), ["scalp", "trend"]);
    assert.deepEqual(parseKinds("momentum, breakout"), ["momentum", "breakout"]);
    assert.deepEqual(parseKinds(undefined), []);
    assert.equal(needsSeal(parseCommand({ pause: ["scalp"] }, [])), true);
    assert.equal(needsSeal(parseCommand({ resume: "trend" }, [])), true);
  });
});

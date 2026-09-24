import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsSeal, parseCommand, parseFavor, parseHalt, parseTaxPercent, resolveBanish } from "./decree.ts";

describe("royal commands are held to the law", () => {
  it("reads the dues as percent or fraction, clamped to 0-30%", () => {
    assert.equal(parseTaxPercent(10), 0.1);
    assert.equal(parseTaxPercent("15%"), 0.15);
    assert.equal(parseTaxPercent(0.25), 0.25);
    assert.equal(parseTaxPercent(95), 0.3);
    assert.equal(parseTaxPercent(-5), 0);
    assert.equal(parseTaxPercent(0), 0);
    assert.equal(parseTaxPercent("auto"), "auto");
    assert.equal(parseTaxPercent(null), null);
    assert.equal(parseTaxPercent("lots"), null);
  });

  it("accepts only the guild's funds as the favoured fund", () => {
    assert.equal(parseFavor("gld"), "GLD");
    assert.equal(parseFavor("SPY"), "SPY");
    assert.equal(parseFavor("BTC"), null);
    assert.equal(parseFavor("auto"), "auto");
    assert.equal(parseFavor(""), null);
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
    const c = parseCommand({ summon: "2", banish: ["Hugh"], taxRate: 12, favorAsset: "gld" });
    assert.deepEqual(c, { summon: 2, summonAs: null, banish: ["Hugh"], taxRate: 0.12, favorAsset: "GLD", strategies: [], halt: null });
    assert.equal(parseCommand({ favorAsset: "DOGE" }).favorAsset, null, "only the guild's funds");
    assert.equal(needsSeal(c), true);
    assert.equal(needsSeal(parseCommand({ summon: 1 })), false);
    assert.equal(parseCommand({ summon: 1, summonAs: "bre-abc123" }).summonAs, "bre-abc123");
    assert.equal(parseCommand({ summon: 1, summonAs: "<script>" }).summonAs, null);
    assert.equal(needsSeal(parseCommand({ banish: [], taxRate: null })), false);
    const s = parseCommand({ strategies: [{ name: "Agnes", strategy: "momentum" }, { strategy: "trend" }, "junk"] });
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
    assert.equal(needsSeal(parseCommand({ halt: "halt" })), true);
    assert.equal(parseCommand({}).halt, null);
  });
});

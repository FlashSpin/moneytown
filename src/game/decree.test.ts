import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsSeal, parseCommand, parseFavor, parseTaxPercent, resolveBanish } from "./decree.ts";

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

  it("accepts only tradable assets as the favoured market", () => {
    assert.equal(parseFavor("eth"), "ETH");
    assert.equal(parseFavor("DOGE"), null);
    assert.equal(parseFavor("auto"), "auto");
    assert.equal(parseFavor(undefined), null);
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
    const c = parseCommand({ summon: "2", banish: ["Hugh"], taxRate: 12, favorAsset: "sol" });
    assert.deepEqual(c, { summon: 2, banish: ["Hugh"], taxRate: 0.12, favorAsset: "SOL" });
    assert.equal(needsSeal(c), true);
    assert.equal(needsSeal(parseCommand({ summon: 1 })), false);
    assert.equal(needsSeal(parseCommand({ banish: [] , taxRate: null })), false);
  });
});

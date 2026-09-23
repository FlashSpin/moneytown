import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settleDay, temperOf } from "./trading.ts";

describe("the day's dues: tax on profit only", () => {
  const base = { dayStart: 10_000, taxRate: 0.2, rent: 100, floor: 1_000 };

  it("taxes a winning day's gain, not the purse", () => {
    const r = settleDay({ ...base, balance: 11_000 });
    assert.equal(r.tithe, 200); // 20% of the 1,000 gain
    assert.equal(r.rentPaid, 100);
    assert.equal(r.balance, 10_700);
    assert.equal(r.hanged, false);
  });

  it("charges no tax on a losing day, only upkeep", () => {
    const r = settleDay({ ...base, balance: 9_000 });
    assert.equal(r.tithe, 0);
    assert.equal(r.balance, 8_900);
  });

  it("a flat day costs only the upkeep", () => {
    assert.equal(settleDay({ ...base, balance: 10_000 }).balance, 9_900);
  });

  it("hangs a villager left below the floor", () => {
    const r = settleDay({ ...base, balance: 1_050 });
    assert.equal(r.balance, 950);
    assert.equal(r.hanged, true);
  });
});

describe("temperaments", () => {
  it("gives every old villager a stable one", () => {
    assert.equal(temperOf("s-abc"), temperOf("s-abc"));
    assert.ok(["trend", "contrarian", "cautious", "bold", "steady"].includes(temperOf("s-xyz")));
  });
});

describe("which stalls stand", () => {
  it("uses the world's list, else the live feed's for an older world", async () => {
    const { stallCoins } = await import("./dawn.ts");
    const old = { assets: { BTC: { usd: 1 }, ETH: { usd: 1 }, SOL: { usd: 1 } } };
    const live = { coins: ["BTC", "ETH", "XRP", "SOL"], assets: {} };
    assert.deepEqual(stallCoins(old, live), ["BTC", "ETH", "XRP", "SOL"]);
    assert.deepEqual(stallCoins({ ...old, coins: ["BTC", "DOGE"] }, live), ["BTC", "DOGE"]);
    assert.deepEqual(stallCoins(old, null), ["BTC", "ETH", "SOL"]);
  });
});

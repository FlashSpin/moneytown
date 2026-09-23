import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capSizeForPurse, clampSize, markToMarket, momentumOrder, recordTrade, settleDay, temperDecide, temperOf } from "./trading.ts";

describe("marking a position to market", () => {
  it("longs gain on a rise, shorts on a fall, on the share at risk only", () => {
    assert.equal(markToMarket({ balance: 10_000, side: "long", size: 0.5, entryUsd: 100, nowUsd: 110 }), 500);
    assert.equal(markToMarket({ balance: 10_000, side: "short", size: 0.5, entryUsd: 100, nowUsd: 110 }), -500);
    assert.equal(markToMarket({ balance: 10_000, side: "flat", size: 1, entryUsd: 100, nowUsd: 200 }), 0);
  });

  it("never loses more than was put at risk", () => {
    assert.equal(markToMarket({ balance: 10_000, side: "short", size: 0.4, entryUsd: 100, nowUsd: 400 }), -4_000);
  });

  it("does nothing without a known entry or price", () => {
    assert.equal(markToMarket({ balance: 10_000, side: "long", size: 1, nowUsd: 110 }), 0);
    assert.equal(markToMarket({ balance: 10_000, side: "long", size: 1, entryUsd: 100, nowUsd: 0 }), 0);
  });
});

describe("sizes", () => {
  it("reads percent or fraction, clamped 10-100%, defaulting to 40%", () => {
    assert.equal(clampSize(40), 0.4);
    assert.equal(clampSize(0.25), 0.25);
    assert.equal(clampSize(500), 1);
    assert.equal(clampSize(1), 1);
    assert.equal(clampSize(0.01), 0.1);
    assert.equal(clampSize(undefined), 0.4);
    assert.equal(clampSize("lots"), 0.4);
  });

  it("weak purses may not bet big", () => {
    assert.equal(capSizeForPurse(0.8, 4_000, 10_000), 0.25);
    assert.equal(capSizeForPurse(0.8, 6_000, 10_000), 0.8);
  });
});

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

describe("the King's fallback strategy", () => {
  const assets = {
    BTC: { usd: 100_000, change24h: 0.4 },
    ETH: { usd: 3_000, change24h: -3.2 },
    SOL: { usd: 150, change24h: 1.5 },
  };

  it("follows the strongest clear move", () => {
    const o = momentumOrder(assets, []);
    assert.equal(o.side, "short");
    assert.equal(o.asset, "ETH");
    assert.equal(o.size, 0.3);
  });

  it("prefers the trend across its own price history", () => {
    const history = [{ t: 0, BTC: 90_000, ETH: 3_000, SOL: 150 }];
    const o = momentumOrder(assets, history);
    assert.equal(o.asset, "BTC"); // +11% since the first sample
    assert.equal(o.side, "long");
  });

  it("ignores a price history only minutes long, using the 24h move instead", () => {
    const fresh = [{ t: Date.now() - 60_000, BTC: 100_000, ETH: 3_000, SOL: 150 }];
    assert.equal(momentumOrder(assets, fresh).asset, "ETH");
  });

  it("reads new-style samples with prices for any coin", () => {
    const history = [{ t: 0, prices: { DOGE: 0.1, BTC: 100_000 } }];
    const o = momentumOrder({ BTC: { usd: 100_000, change24h: 0 }, DOGE: { usd: 0.15, change24h: 0 } }, history);
    assert.deepEqual([o.asset, o.side], ["DOGE", "long"]);
  });

  it("sits out when nothing moves", () => {
    const calm = {
      BTC: { usd: 100_000, change24h: 0.2 },
      ETH: { usd: 3_000, change24h: -0.5 },
      SOL: { usd: 150, change24h: 0.9 },
    };
    assert.equal(momentumOrder(calm, []).side, "flat");
  });
});

describe("villagers trade in their own way", () => {
  const call = { side: "long" as const, asset: "ETH" as const, size: 0.4, note: "Ride Ether." };

  it("gives every old villager a stable temperament", () => {
    assert.equal(temperOf("s-abc"), temperOf("s-abc"));
    assert.ok(["trend", "contrarian", "cautious", "bold", "steady"].includes(temperOf("s-xyz")));
  });

  it("trend-followers take the advice as given", () => {
    const d = temperDecide("trend", call, {});
    assert.equal(d.side, "long");
    assert.equal(d.size, 0.4);
    assert.equal(d.followsKing, true);
  });

  it("contrarians fade a strong call, lightly", () => {
    const d = temperDecide("contrarian", call, {});
    assert.equal(d.side, "short");
    assert.equal(d.size, 0.2);
    assert.equal(d.followsKing, false);
  });

  it("the cautious halve the stake; the bold raise it, up to 60%", () => {
    assert.equal(temperDecide("cautious", call, {}).size, 0.2);
    assert.equal(temperDecide("bold", call, {}).size, 0.6);
  });

  it("the steady hold an open position unless told to reverse it", () => {
    const holding = { side: "short" as const, asset: "BTC" as const, size: 0.3 };
    assert.deepEqual(
      { side: temperDecide("steady", call, holding).side, asset: temperDecide("steady", call, holding).asset },
      { side: "short", asset: "BTC" },
    );
    const reverse = { side: "long" as const, asset: "BTC" as const, size: 0.3, note: "" };
    assert.equal(temperDecide("steady", reverse, holding).side, "long");
  });

  it("keeps a track record of wins, losses and total P&L", () => {
    let r = recordTrade(undefined, 500);
    r = recordTrade(r, -200);
    r = recordTrade(r, 0);
    assert.deepEqual(r, { wins: 1, losses: 1, pnl: 300 });
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

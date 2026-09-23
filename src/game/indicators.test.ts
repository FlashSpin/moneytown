import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendTick, change, priceFresh, priorRange, rsi, seriesOf, sma, tradingSeries, volatility } from "./indicators.ts";

describe("indicators", () => {
  const up = [100, 101, 102, 103, 104, 105];

  it("change over n samples", () => {
    assert.equal(change(up, 5), 5);
    assert.equal(change(up, 6), null);
  });

  it("simple moving average, optionally offset", () => {
    assert.equal(sma(up, 3), 104);
    assert.equal(sma(up, 3, 1), 103);
    assert.equal(sma(up, 10), null);
  });

  it("RSI: all gains is 100, all losses 0, flat 50", () => {
    const rising = Array.from({ length: 15 }, (_, i) => 100 + i);
    const falling = Array.from({ length: 15 }, (_, i) => 100 - i);
    assert.equal(rsi(rising), 100);
    assert.equal(rsi(falling), 0);
    assert.equal(rsi(Array(15).fill(100)), 50);
    assert.equal(rsi([1, 2, 3]), null);
  });

  it("prior range excludes the latest sample", () => {
    assert.deepEqual(priorRange([5, 9, 7, 20], 3), { high: 9, low: 5 });
  });

  it("volatility is zero for a steady climb of equal steps in %", () => {
    const steady = [100, 110, 121, 133.1];
    assert.ok(volatility(steady, 3)! < 1e-9);
    assert.ok(volatility([100, 110, 100, 110], 3)! > 5);
  });
});

describe("the tick history", () => {
  it("appends prices, carries a missing price forward, and keeps a rolling window", () => {
    let t = appendTick(undefined, 1, { BTC: 100, ETH: 10 }, 3);
    t = appendTick(t, 2, { BTC: 101 }, 3);
    t = appendTick(t, 3, { BTC: 102, ETH: 11, SOL: 5 }, 3);
    t = appendTick(t, 4, { BTC: 103, ETH: 12, SOL: 6 }, 3);
    assert.deepEqual(t.t, [2, 3, 4]);
    assert.deepEqual(seriesOf(t, "BTC"), [101, 102, 103]);
    assert.deepEqual(seriesOf(t, "ETH"), [10, 11, 12]); // tick 2 repeated 10
    assert.deepEqual(seriesOf(t, "SOL"), [5, 6]); // starts when first priced
    assert.deepEqual(seriesOf(t, "DOGE"), []);
  });
});

describe("trading on clean data", () => {
  const M = 60_000;
  it("reads only the unbroken run since the last gap", () => {
    let t = appendTick(undefined, 0, { SOL: 1 });
    t = appendTick(t, 5 * M, { SOL: 2 });
    t = appendTick(t, 125 * M, { SOL: 3 }); // two hours of silence
    t = appendTick(t, 130 * M, { SOL: 4 });
    assert.deepEqual(seriesOf(t, "SOL"), [1, 2, 3, 4]);
    assert.deepEqual(tradingSeries(t, "SOL", 131 * M), [3, 4]);
  });

  it("gives nothing when the ticks or the coin's price have gone stale", () => {
    let t = appendTick(undefined, 0, { SOL: 1, ETH: 5 });
    t = appendTick(t, 5 * M, { SOL: 2 });
    t = appendTick(t, 10 * M, { SOL: 3 });
    t = appendTick(t, 15 * M, { SOL: 4 });
    assert.deepEqual(tradingSeries(t, "ETH", 16 * M), [], "ETH's last real price was 16 minutes ago");
    assert.equal(priceFresh(t, "ETH", 16 * M), false);
    assert.equal(priceFresh(t, "SOL", 16 * M), true);
    assert.deepEqual(tradingSeries(t, "SOL", 40 * M), [], "no tick for 25 minutes");
  });
});

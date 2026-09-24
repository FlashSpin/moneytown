import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendHourly, appendTick, change, HOUR_MS, priceFresh, seedHourly, seriesForBar, validatePrices, priorRange, rsi, seriesOf, sma, tradingSeries, volatility } from "./indicators.ts";

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

describe("checking prices before they are recorded", () => {
  it("holds back a jump over 25% until the next tick confirms it", () => {
    const t = appendTick(undefined, 0, { SOL: 100, ETH: 10 });
    const first = validatePrices(t, { SOL: 140, ETH: 10.5, BAD: -1 });
    assert.deepEqual(first.accepted, { ETH: 10.5 });
    assert.deepEqual(first.held, ["SOL"]);
    const t2 = { ...appendTick(t, 1, first.accepted), suspect: first.suspect };
    const second = validatePrices(t2, { SOL: 141 });
    assert.deepEqual(second.accepted, { SOL: 141 }, "two ticks agree: a real move");
    const third = validatePrices(t2, { SOL: 60 });
    assert.deepEqual(third.held, ["SOL"], "a different wild price is held again");
  });
});

describe("longer bars", () => {
  const H = HOUR_MS;
  it("keeps one close per hour, the forming hour taking the latest price", () => {
    let h = appendHourly(undefined, 10 * H + 5, { BTC: 1 });
    h = appendHourly(h, 10 * H + 50 * 60_000, { BTC: 2 });
    h = appendHourly(h, 11 * H + 5, { BTC: 3 });
    assert.deepEqual(h.BTC, { t0: 10 * H, px: [2, 3] });
    h = appendHourly(h, 13 * H, { BTC: 4 });
    assert.deepEqual(h.BTC!.px, [2, 3, 3, 4], "a short gap repeats the last close");
    h = appendHourly(h, 30 * H, { BTC: 5 });
    assert.deepEqual(h.BTC, { t0: 30 * H, px: [5] }, "a long gap starts again");
  });

  it("serves only finished bars, and 4-hour bars from hours ending on the 4-hour mark", () => {
    const now = 20 * H + 10 * 60_000;
    const ticks = { t: [now], px: { BTC: [9] }, seen: { BTC: now }, h: { BTC: { t0: 10 * H, px: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] } } };
    assert.deepEqual(seriesForBar(ticks, "BTC", 12, now), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], "the forming 20:00 hour is left out");
    assert.deepEqual(seriesForBar(ticks, "BTC", 48, now), [11, 15, 19], "closes at 12:00, 16:00 and 20:00");
    assert.deepEqual(seriesForBar({ ...ticks, seen: { BTC: now - 3 * H } }, "BTC", 12, now), [], "stale price");
  });

  it("builds 15-minute closes from the ticks, leaving out the forming one", () => {
    const M = 60_000;
    const t = [0, 5, 10, 15, 20, 25, 30].map((m) => m * M);
    const ticks = { t, px: { SOL: [1, 2, 3, 4, 5, 6, 7] }, seen: { SOL: 30 * M } };
    assert.deepEqual(seriesForBar(ticks, "SOL", 3, 31 * M), [3, 6]);
  });

  it("seeds from exchange candles and keeps later hours", () => {
    const e = seedHourly({ t0: 5 * H, px: [50, 51] }, [{ t: 2 * H, close: 20 }, { t: 3 * H, close: 30 }, { t: 4 * H, close: 40 }]);
    assert.deepEqual(e, { t0: 2 * H, px: [20, 30, 40, 50, 51] });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BAR_MS, defaultFor, holdBaseline, runBacktest, seriesAt, toGrid, type Grid } from "./backtest.ts";
import { fullReport, tune } from "./validation.ts";

/** A deterministic random-walk history: `coins` coins, `bars` 5-minute bars. */
function walk(coins: string[], bars: number, seed = 7, vol = 0.004): Record<string, { t: number; price: number }[]> {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out: Record<string, { t: number; price: number }[]> = {};
  coins.forEach((c, k) => {
    let p = 10 + k * 7;
    out[c] = Array.from({ length: bars }, (_, i) => {
      p *= 1 + (rnd() - 0.5) * 2 * vol;
      return { t: 1_700_000_000_000 + i * BAR_MS, price: p };
    });
  });
  return out;
}

const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE"];
const OPTS = { balance: 1_000_000, stakeSats: 20_000 };

describe("the price grid", () => {
  it("buckets prices into 5-minute bars and leaves gaps empty", () => {
    const g = toGrid({ SOL: [{ t: 0, price: 1 }, { t: 60_000, price: 2 }, { t: 3 * BAR_MS + 5, price: 3 }] });
    assert.deepEqual(g.t, [0, BAR_MS, 2 * BAR_MS, 3 * BAR_MS]);
    assert.deepEqual(g.px.SOL, [2, null, null, 3], "the last price in a bar counts");
    assert.deepEqual(seriesAt(g, "SOL", 3), [3], "a gap breaks the series");
    assert.deepEqual(seriesAt(g, "SOL", 1), []);
  });
});

describe("a backtest", () => {
  const history = walk(COINS, 2_000);
  const g = toGrid(history);

  it("trades, and ends in cash with every trade closed", () => {
    const r = runBacktest(g, { ...OPTS, strategy: defaultFor("scalp") });
    assert.ok(r.metrics.trades > 10, `only ${r.metrics.trades} trades`);
    assert.equal(r.events.filter((e) => e.action === "open").length, r.metrics.trades);
    assert.ok(r.metrics.fees > 0 && r.metrics.costs > 0);
    assert.ok(r.metrics.maxDrawdown >= 0 && r.metrics.maxDrawdown < 1);
    assert.equal(r.equity[r.equity.length - 1], r.metrics.endBalance);
  });

  it("never looks ahead: changing the future changes nothing before it", () => {
    const k = 1_200;
    const future = structuredClone(history);
    for (const c of COINS) for (let i = k; i < future[c]!.length; i++) future[c]![i]!.price *= 1.5 + (i % 7) / 10;
    const a = runBacktest(g, { ...OPTS, strategy: defaultFor("momentum") });
    const b = runBacktest(toGrid(future), { ...OPTS, strategy: defaultFor("momentum") });
    // A decision at bar i fills at bar i+1, so everything up to bar k-2 must match exactly.
    const before = (e: { t: number }) => e.t <= g.t[k - 2]!;
    assert.deepEqual(a.events.filter(before), b.events.filter(before));
    assert.deepEqual(a.equity.slice(0, k - 2), b.equity.slice(0, k - 2));
    assert.notDeepEqual(a.equity, b.equity, "the future did change");
  });

  it("costs more when costs are higher", () => {
    const run = (costs: number) => runBacktest(g, { ...OPTS, strategy: defaultFor("scalp"), costs }).metrics;
    const free = run(0);
    const live = run(1);
    const double = run(2);
    assert.equal(free.fees, 0);
    assert.ok(free.totalReturn > live.totalReturn && live.totalReturn > double.totalReturn);
  });

  it("holding Bitcoin tracks its price, less one round trip", () => {
    const h = holdBaseline(g, "BTC", 1_000_000)!;
    const col = g.px.BTC!;
    const gross = col[col.length - 1]! / col[0]!;
    assert.ok(Math.abs(h.metrics.endBalance / 1_000_000 / gross - 1) < 0.02);
    assert.ok(h.metrics.endBalance < 1_000_000 * gross);
  });

  it("tunes only on the data it is given", () => {
    const k = 1_000;
    const future = structuredClone(history);
    for (const c of COINS) for (let i = k; i < future[c]!.length; i++) future[c]![i]!.price *= 2;
    const a = tune(g, defaultFor("breakout"), 0, k, OPTS);
    const b = tune(toGrid(future), defaultFor("breakout"), 0, k, OPTS);
    assert.deepEqual(a, b);
  });
});

describe("the full report", () => {
  it("reports every strategy with hold-out and walk-forward results, and baselines", () => {
    const g: Grid = toGrid(walk(COINS, 1_500, 11));
    const started = Date.now();
    const r = fullReport(g, OPTS);
    const took = Date.now() - started;
    assert.equal(r.kinds.length, 5);
    assert.ok(r.baselines.btc && r.baselines.btcValidation);
    for (const k of r.kinds) {
      assert.equal(k.walkForward.folds.length, 4);
      assert.equal(k.grid.length, 9);
      assert.equal(k.costSensitivity.length, 3);
      assert.ok(k.verdict.length > 10);
      assert.ok(k.equity.length <= 200);
      for (const f of k.walkForward.folds) assert.ok(f.from < f.to);
    }
    assert.ok(took < 60_000, `took ${took} ms`);
  });
});

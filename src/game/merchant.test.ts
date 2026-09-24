import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blend,
  CORE,
  COST_PER_TRADE,
  evolveMerchants,
  FUND_IDS,
  ISA_START,
  mutateM,
  randomM,
  rng,
  simulate,
  SIXTY_FORTY,
  stepIsa,
  targetWeights,
  toDaily,
  type Daily,
  type FundId,
  type MGenome,
} from "./merchant.ts";

/** Business days of prices for every fund: a drift per fund plus noise. */
function market(days: number, drift: Partial<Record<FundId, number>> = {}, seed = 3): Daily {
  const r = rng(seed);
  const rows: Partial<Record<FundId, { d: string; c: number }[]>> = {};
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.UTC(2005, 0, 3) + i * 86_400_000).toISOString().slice(0, 10));
  for (const f of FUND_IDS) {
    let p = 100;
    rows[f] = dates.map((d) => {
      p *= 1 + (drift[f] ?? 0.0002) + (r() - 0.5) * (f === "SHY" ? 0.0005 : 0.02);
      return { d, c: p };
    });
  }
  return toDaily(rows);
}

const g0: MGenome = { id: "t", gen: 0, mode: "hold", funds: ["SPY"], sma: 200, look: 100, top: 1, abs: 0, safe: "SHY", every: 21 };

describe("merchant strategies", () => {
  const g = market(600);
  it("hold splits equally; 60/40 is sixty-forty", () => {
    assert.deepEqual(targetWeights(g, { ...g0, funds: ["SPY", "GLD"] }, 300), { SPY: 0.5, GLD: 0.5 });
    const w = targetWeights(g, SIXTY_FORTY, 300)!;
    assert.ok(Math.abs(w.SPY! - 0.6) < 1e-9 && Math.abs(w.IEF! - 0.4) < 1e-9);
  });

  it("trend steps aside into the safe fund below the average, and waits for the history", () => {
    const down = market(600, { SPY: -0.003 });
    assert.deepEqual(targetWeights(down, { ...g0, mode: "trend", funds: ["SPY"] }, 400), { SHY: 1 });
    assert.equal(targetWeights(down, { ...g0, mode: "trend", funds: ["SPY"] }, 100), null, "not enough history");
    const up = market(600, { SPY: 0.003 });
    assert.deepEqual(targetWeights(up, { ...g0, mode: "trend", funds: ["SPY"] }, 400), { SPY: 1 });
  });

  it("momentum holds the leaders, and the safe fund when nothing beats it", () => {
    const m: MGenome = { ...g0, mode: "momentum", funds: ["SPY", "EEM", "GLD"], top: 1, look: 100, abs: 1 };
    assert.deepEqual(targetWeights(market(600, { EEM: 0.004 }), m, 400), { EEM: 1 });
    assert.deepEqual(targetWeights(market(600, { SPY: -0.002, EEM: -0.002, GLD: -0.002 }), m, 400), { SHY: 1 });
  });

  it("never looks ahead: a rise tomorrow doesn't change today's decision", () => {
    const a = market(500);
    const b: Daily = { days: a.days, px: { ...a.px, SPY: Float64Array.from(a.px.SPY!, (x, i) => (i > 300 ? x * 2 : x)) } };
    const m: MGenome = { ...g0, mode: "trend", funds: ["SPY"] };
    assert.deepEqual(targetWeights(a, m, 300), targetWeights(b, m, 300));
  });

  it("pays costs on what it trades, and fills a day after deciding", () => {
    const flat: Daily = { days: ["a", "b", "c"], px: Object.fromEntries(FUND_IDS.map((f) => [f, new Float64Array([100, 100, 100])])) };
    const r = simulate(flat, g0, 0, 3);
    assert.equal(r.equity[0], 1, "day 0: still in cash (decided, not filled)");
    assert.ok(Math.abs(r.equity[1]! - (1 - COST_PER_TRADE)) < 1e-9, "day 1: bought, paying the cost");
    assert.equal(r.score.trades, 1);
  });

  it("mutations stay valid and small", () => {
    const r = rng(2);
    let m = randomM(r);
    for (let k = 0; k < 50; k++) {
      const n = mutateM(r, m);
      assert.ok(n.funds.length >= 1 && n.sma >= 20 && n.sma <= 250 && n.top >= 1 && [5, 10, 21, 63].includes(n.every));
      assert.equal(n.parent, m.id);
      m = n;
    }
  });
});

describe("the merchant lab", () => {
  it("judges against 60/40 and proves nothing on a market with no pattern", () => {
    const res = evolveMerchants(market(1800), { seed: 1, population: 10, generations: 3 });
    assert.equal(res.benchmarks.length, 3);
    assert.ok(res.evaluated >= 10);
    assert.ok(!res.champion?.proven || res.champion.edge > 0);
  });
});

describe("the paper ISA", () => {
  const g = market(600);
  it("starts with £10,000, decides at a close and fills at the next, tracking the benchmarks", () => {
    let isa = stepIsa(undefined, g, 300, null).isa;
    assert.equal(isa.history[0]!.v, ISA_START);
    assert.ok(isa.pending, "decided at the first close");
    const next = stepIsa(isa, g, 301, null);
    assert.ok(next.traded.length > 0, "filled at the next close");
    assert.equal(next.isa.pending, undefined);
    isa = next.isa;
    assert.ok(Object.keys(isa.units).length > 0);
    assert.equal(stepIsa(isa, g, 301, null).traded.length, 0, "the same day twice changes nothing");
    assert.ok(isa.history[1]!.us > 0 && isa.history[1]!.sf > 0);
  });

  it("80% core, 20% satellite", () => {
    const w = blend({ SPY: 1 }, { GLD: 1 })!;
    assert.ok(Math.abs(w.SPY! - 0.8) < 1e-9 && Math.abs(w.GLD! - 0.2) < 1e-9);
    assert.deepEqual(blend({ SPY: 1 }, null), { SPY: 1 });
    assert.equal(CORE.mode, "trend");
  });
});

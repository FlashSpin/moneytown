import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candleGrid, type Candle } from "./backtest.ts";
import { cleanEntry, defaultGenome, evolveNiche, fix, isProven, MAX_WARMUP, mergePool, mutate, pickForSpawn, randomGenome, recordLive, rng, type PoolEntry, type Score } from "./lab.ts";
import { BARS, DEFAULT_GENES, STRATEGY_KINDS, warmupOf } from "./strategies.ts";

/** Candles for `n` coins: a random walk, with `drift` adding trends that persist. */
function market(n: number, bars: number, barMs: number, drift: number, seed = 5): Record<string, Candle[]> {
  const r = rng(seed);
  const out: Record<string, Candle[]> = {};
  for (let k = 0; k < n; k++) {
    let p = 100;
    let d = 0;
    out[`C${k}`] = Array.from({ length: bars }, (_, i) => {
      const o = p;
      d = 0.97 * d + (r() - 0.5) * drift;
      p *= 1 + d + (r() - 0.5) * 0.008;
      return { t: i * barMs, o, h: Math.max(o, p) * 1.001, l: Math.min(o, p) * 0.999, c: p };
    });
  }
  return out;
}

const good: Score = { trades: 40, ret: 0.05, avg: 0.004, t: 2, winRate: 0.55, pf: 1.4, maxDd: 0.05, days: 30 };
const entry = (over: Partial<PoolEntry> = {}): PoolEntry => ({
  ...defaultGenome("breakout", 12),
  at: 1,
  train: good,
  val: { ...good, days: 10, trades: 10 },
  test: { ...good, days: 10, trades: 10 },
  stress: good,
  proven: true,
  score: 8,
  ...over,
});

describe("genomes", () => {
  it("the usual genes on 5-minute bars trade exactly as the strategies always have", () => {
    for (const kind of STRATEGY_KINDS) assert.deepEqual(defaultGenome(kind, 1).genes, DEFAULT_GENES[kind], kind);
  });

  it("random and mutated genomes stay in range and fit the history the parish keeps", () => {
    const r = rng(1);
    for (const kind of STRATEGY_KINDS) {
      for (const bar of BARS) {
        let g = randomGenome(r, kind, bar);
        for (let k = 0; k < 30; k++) {
          g = mutate(r, g);
          assert.ok(warmupOf(kind, g.genes) <= MAX_WARMUP[bar], `${kind}/${bar} needs ${warmupOf(kind, g.genes)}`);
          assert.equal(g.genes.bar, bar);
          assert.ok(g.tp >= 0.5 && g.sl >= 0.3 && g.genes.hold >= 2);
          if (kind === "conservative") assert.equal(g.shorts, false);
        }
      }
    }
  });

  it("a mutation is a tiny adjustment that remembers its parent", () => {
    const r = rng(2);
    const a = defaultGenome("momentum", 12);
    const b = mutate(r, a);
    assert.equal(b.parent, a.id);
    assert.equal(b.gen, a.gen + 1);
    const changed = (["look", "fast", "thr", "filter", "trail", "hold"] as const).filter((k) => a.genes[k] !== b.genes[k]).length + Number(a.tp !== b.tp) + Number(a.sl !== b.sl) + Number(a.shorts !== b.shorts);
    assert.ok(changed <= 3, `${changed} genes changed`);
  });

  it("fix clamps nonsense", () => {
    const g = fix({ ...defaultGenome("trend", 48), genes: { bar: 48, look: 9999, fast: 9999, thr: 0, filter: 5000, trail: -1, hold: 1e6 }, tp: 1e3, sl: 0 });
    assert.ok(warmupOf("trend", g.genes) <= MAX_WARMUP[48]);
    assert.equal(g.genes.trail, 0);
    assert.equal(g.tp, 25);
    assert.equal(g.sl, 0.3);
  });
});

describe("evolution", () => {
  it("finds and proves a trend-follower where trends persist", () => {
    const g = candleGrid(market(8, 4_000, 3_600_000, 0.004), 3_600_000);
    const res = evolveNiche(g, { kind: "trend", bar: 12 }, { balance: 1_000_000, stakeSats: 20_000, seed: 3, population: 12, generations: 4 });
    assert.ok(res.champion, "a champion");
    assert.ok(res.champion.proven, JSON.stringify(res.champion.test));
    assert.ok(res.curve[res.curve.length - 1]! >= res.curve[0]!, "fitness never goes backwards (elitism)");
  });

  it("proves nothing on a pure random walk", () => {
    const g = candleGrid(market(6, 3_000, 3_600_000, 0), 3_600_000);
    const res = evolveNiche(g, { kind: "breakout", bar: 12 }, { balance: 1_000_000, stakeSats: 20_000, seed: 4, population: 12, generations: 3 });
    assert.ok(!res.champion?.proven);
  });
});

describe("the guild book", () => {
  it("recomputes proof instead of trusting it", () => {
    const e = cleanEntry({ ...entry(), test: { ...good, ret: -0.1, days: 10, trades: 10 }, proven: true });
    assert.equal(e?.proven, false);
    assert.equal(cleanEntry({ kind: "nonsense" }), null);
    assert.equal(isProven(entry()), true);
  });

  it("keeps live records through a new run, and retires a genome that loses live", () => {
    const a = entry({ id: "bre-a" });
    let book = mergePool([], [a], 1);
    const losses = Array.from({ length: 25 }, () => ({ action: "close" as const, genomeId: "bre-a", pnl: -200, stake: 10_000 }));
    book = recordLive(book, losses);
    assert.equal(book[0]!.live?.trades, 25);
    assert.ok(book[0]!.retired, "retired");
    book = mergePool(book, [{ ...a, id: "bre-new" }], 2);
    assert.equal(book.length, 1);
    assert.equal(book[0]!.id, "bre-a", "same genes keep their name");
    assert.equal(book[0]!.live?.trades, 25);
    assert.ok(book[0]!.retired, "stays retired");
  });

  it("trains newcomers in a slightly adjusted proven genome, never a retired one", () => {
    const r = rng(9);
    const book = [entry({ id: "bre-x", retired: "lost" }), entry({ id: "bre-y", score: 7 }), entry({ id: "bre-z", proven: false, score: 1 })];
    for (let k = 0; k < 20; k++) {
      const g = pickForSpawn(book, r)!;
      assert.equal(g.parent, "bre-y");
    }
    assert.equal(pickForSpawn(book, r, "scalp"), null);
  });
});

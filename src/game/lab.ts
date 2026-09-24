/**
 * The strategy lab — pure, so it is easy to test. It breeds strategies the
 * way a guild trains apprentices: many variants of each kind of strategy,
 * on each bar size, are backtested on real candles (./backtest.ts, the same
 * trading code the villagers run live); the best are kept, adjusted a little
 * (mutation) and crossed, and tried again, generation after generation.
 * Every run starts from the previous run's best, so the guild's book keeps
 * getting refined as new market data arrives.
 *
 * Honest selection, so luck isn't mistaken for skill:
 *   - the data is split in time: the first 60% (train) is all evolution ever
 *     sees; the next 20% (validation) picks each niche's champion from the
 *     finalists; the last 20% (test) is looked at once, for the verdict;
 *   - fitness is the t-statistic of per-trade returns after every cost
 *     (fee, spread, slippage), with a minimum number of trades, so a few
 *     lucky trades can't win;
 *   - breeding rewards consistency: a genome scores by the worse of the two
 *     halves of the training data, so one lucky stretch can't carry it;
 *   - "proven" means it made money on train, validation AND test, with
 *     enough trades on each, a profit factor above 1, validation and test
 *     together clearly positive (t ≥ PROVEN_OOS_T), and still made money
 *     on validation with costs 50% higher than expected.
 * Even so, many niches are tried, so one may pass by chance; live paper
 * results (`recordLive`) are the final judge, and a genome that does badly
 * live is retired from the book.
 */
import { runBacktest, type Grid, type Metrics } from "./backtest.ts";
import {
  BAR_LABEL,
  BARS,
  DEFAULT_GENES,
  LONG_ONLY,
  STRATEGY_INFO,
  STRATEGY_KINDS,
  fromBook,
  warmupOf,
  type Bar,
  type Genes,
  type Strategy,
  type StrategyKind,
  type TradeEvent,
} from "./strategies.ts";

// ── Genomes ─────────────────────────────────────────────────────────────────

export type Genome = {
  id: string;
  kind: StrategyKind;
  genes: Genes;
  tp: number;
  sl: number;
  shorts: boolean;
  /** The genome it was bred from, and how many generations of breeding lie behind it. */
  parent?: string;
  gen: number;
};

/** How a genome did on one slice of the data. */
export type Score = {
  trades: number;
  /** Total return of the purse over the slice. */
  ret: number;
  /** Mean net return per trade, as a share of the stake. */
  avg: number;
  /** t-statistic of the per-trade returns (mean / sd × √n). */
  t: number;
  winRate: number;
  pf: number | null;
  maxDd: number;
  days: number;
};

/** Live paper results for a genome in the book: closed trades and the sums of their returns. */
export type Live = { trades: number; sum: number; sumSq: number; pnl: number };

/** A genome in the guild's book, with its verdicts. */
export type PoolEntry = Genome & {
  at: number;
  train: Score;
  val: Score;
  test: Score;
  /** Validation with costs 50% higher. */
  stress: Score;
  proven: boolean;
  /** How the book ranks it (higher is better): test and validation evidence, then live results. */
  score: number;
  live?: Live;
  retired?: string;
};

/** Every gene's range, per kind and bar. Lengths are in bars. */
type Range = { look: [number, number]; fast: [number, number]; thr: [number, number] };

const RANGES: Record<StrategyKind, Range> = {
  scalp: { look: [1, 12], fast: [3, 3], thr: [0.1, 2] },
  momentum: { look: [2, 48], fast: [3, 3], thr: [0.3, 4] },
  breakout: { look: [6, 120], fast: [3, 3], thr: [0, 2] },
  reversion: { look: [3, 30], fast: [3, 3], thr: [8, 35] },
  trend: { look: [8, 200], fast: [2, 40], thr: [0, 0] },
  conservative: { look: [8, 150], fast: [2, 30], thr: [0.1, 3] },
  volatility: { look: [8, 120], fast: [3, 24], thr: [1.2, 4] },
};
/** Percent thresholds grow with the bar: a 4-hour bar moves more than a 5-minute one. */
const PCT_THR: ReadonlySet<StrategyKind> = new Set(["scalp", "momentum", "conservative"]);
const thrScale = (kind: StrategyKind, bar: Bar) => (PCT_THR.has(kind) ? Math.sqrt(bar) : 1);

/**
 * The most bars of history a genome may need, per bar size — what the live
 * parish keeps (24 hours of 5-minute ticks, 10 days of hourly bars).
 */
export const MAX_WARMUP: Record<Bar, number> = { 1: 280, 3: 90, 12: 230, 48: 56 };
/** The longest hold, in bars: two days on short bars, a week hourly, two weeks on 4-hour bars. */
const MAX_HOLD: Record<Bar, number> = { 1: 576, 3: 192, 12: 168, 48: 84 };
const TP: [number, number] = [0.5, 25];
const SL: [number, number] = [0.3, 12];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Pull genes back into their ranges and keep them consistent. */
export function fix(g: Genome): Genome {
  const r = RANGES[g.kind];
  const bar = g.genes.bar;
  const s = thrScale(g.kind, bar);
  const genes = { ...g.genes };
  genes.fast = Math.round(clamp(genes.fast, r.fast[0], r.fast[1]));
  genes.look = Math.round(clamp(genes.look, r.look[0], r.look[1]));
  if (g.kind === "trend" || g.kind === "conservative") genes.look = Math.max(genes.look, genes.fast + 2);
  if (g.kind === "volatility") genes.look = Math.max(genes.look, genes.fast * 2);
  genes.thr = round(clamp(genes.thr, r.thr[0] * s, r.thr[1] * s), 3);
  genes.filter = genes.filter > 0 ? Math.round(Math.max(genes.filter, 10)) : 0;
  genes.trail = genes.trail > 0 ? round(clamp(genes.trail, 0.3, 10)) : 0;
  genes.hold = Math.round(clamp(genes.hold, 2, MAX_HOLD[bar]));
  // Whatever it needs must fit the history the live parish keeps.
  const cap = MAX_WARMUP[bar];
  if (genes.filter > cap) genes.filter = cap;
  while (warmupOf(g.kind, genes) > cap && genes.look > r.look[0]) genes.look = Math.max(r.look[0], Math.floor(genes.look * 0.9));
  if (warmupOf(g.kind, genes) > cap) genes.fast = Math.max(r.fast[0], Math.floor(cap / 3));
  return {
    ...g,
    genes,
    tp: round(clamp(g.tp, TP[0], TP[1])),
    sl: round(clamp(g.sl, SL[0], SL[1])),
    shorts: LONG_ONLY.has(g.kind) ? false : g.shorts,
  };
}

/** A small, deterministic random number generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uni = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const logUni = (r: () => number, lo: number, hi: number) => Math.exp(uni(r, Math.log(Math.max(lo, 1e-6)), Math.log(hi)));
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

let serial = 0;
/** A short id for a new genome. */
export function newId(r: () => number, kind: StrategyKind): string {
  serial = (serial + 1) % 1296;
  return `${kind.slice(0, 3)}-${Math.floor(r() * 36 ** 4).toString(36).padStart(4, "0")}${serial.toString(36).padStart(2, "0")}`;
}

/** A genome with the kind's usual genes, on `bar`-sized bars. */
export function defaultGenome(kind: StrategyKind, bar: Bar = 1): Genome {
  const info = STRATEGY_INFO[kind];
  const d = DEFAULT_GENES[kind];
  const genes = bar === 1 ? { ...d } : { ...d, bar, hold: Math.max(2, Math.round(d.hold / bar)), thr: d.thr * thrScale(kind, bar) };
  return fix({ id: `${kind.slice(0, 3)}-default-${bar}`, kind, genes, tp: info.tp * (bar === 1 ? 1 : Math.sqrt(bar) / 1.5), sl: info.sl * (bar === 1 ? 1 : Math.sqrt(bar) / 1.5), shorts: !LONG_ONLY.has(kind), gen: 0 });
}

/** A random genome of `kind` on `bar`-sized bars. */
export function randomGenome(r: () => number, kind: StrategyKind, bar: Bar): Genome {
  const range = RANGES[kind];
  const s = thrScale(kind, bar);
  const fast = Math.round(logUni(r, range.fast[0], range.fast[1] + 0.49));
  const genes: Genes = {
    bar,
    look: Math.round(logUni(r, range.look[0], range.look[1] + 0.49)),
    fast,
    thr: range.thr[1] > 0 ? uni(r, range.thr[0] * s, range.thr[1] * s) : 0,
    filter: r() < 0.5 ? 0 : Math.round(logUni(r, 20, MAX_WARMUP[bar])),
    trail: r() < 0.5 ? 0 : logUni(r, 0.5, 8),
    hold: Math.round(logUni(r, 3, MAX_HOLD[bar])),
  };
  const sl = logUni(r, SL[0] * Math.sqrt(bar) ** 0.5, Math.min(SL[1], 2 * Math.sqrt(bar)));
  return fix({ id: newId(r, kind), kind, genes, sl, tp: sl * logUni(r, 0.7, 5), shorts: r() < 0.6, gen: 0 });
}

/** A tiny adjustment: one or two genes nudged by about 15%, now and then a switch flipped. */
export function mutate(r: () => number, g: Genome, strength = 0.15): Genome {
  const next: Genome = { ...g, genes: { ...g.genes }, id: newId(r, g.kind), parent: g.id, gen: g.gen + 1 };
  const nudge = (x: number) => x * Math.exp(gauss(r) * strength);
  const step = (x: number) => Math.max(1, Math.round(nudge(x) + (r() < 0.5 ? -1 : 1) * (r() < 0.3 ? 1 : 0)));
  const changes = 1 + (r() < 0.4 ? 1 : 0);
  for (let k = 0; k < changes; k++) {
    const pick = Math.floor(r() * 9);
    if (pick === 0) next.genes.look = step(next.genes.look);
    else if (pick === 1) next.genes.fast = step(next.genes.fast);
    else if (pick === 2) next.genes.thr = next.genes.thr > 0 ? nudge(next.genes.thr) : RANGES[g.kind].thr[1] > 0 ? RANGES[g.kind].thr[0] * thrScale(g.kind, g.genes.bar) : 0;
    else if (pick === 3) next.genes.filter = next.genes.filter > 0 ? (r() < 0.15 ? 0 : step(next.genes.filter)) : Math.round(logUni(r, 20, MAX_WARMUP[g.genes.bar]));
    else if (pick === 4) next.genes.trail = next.genes.trail > 0 ? (r() < 0.15 ? 0 : nudge(next.genes.trail)) : logUni(r, 0.5, 6);
    else if (pick === 5) next.genes.hold = step(next.genes.hold);
    else if (pick === 6) next.tp = nudge(next.tp);
    else if (pick === 7) next.sl = nudge(next.sl);
    else next.shorts = r() < 0.2 ? !next.shorts : next.shorts;
  }
  return fix(next);
}

/** A child taking each gene from one parent or the other (same kind and bar). */
export function crossover(r: () => number, a: Genome, b: Genome): Genome {
  const pick = <T,>(x: T, y: T) => (r() < 0.5 ? x : y);
  const genes: Genes = {
    bar: a.genes.bar,
    look: pick(a.genes.look, b.genes.look),
    fast: pick(a.genes.fast, b.genes.fast),
    thr: pick(a.genes.thr, b.genes.thr),
    filter: pick(a.genes.filter, b.genes.filter),
    trail: pick(a.genes.trail, b.genes.trail),
    hold: pick(a.genes.hold, b.genes.hold),
  };
  return fix({ id: newId(r, a.kind), kind: a.kind, genes, tp: pick(a.tp, b.tp), sl: pick(a.sl, b.sl), shorts: pick(a.shorts, b.shorts), parent: a.id, gen: Math.max(a.gen, b.gen) + 1 });
}

/** Everything that decides how a genome trades, for spotting duplicates. */
export const keyOf = (g: Genome) => JSON.stringify([g.kind, g.genes, g.tp, g.sl, g.shorts]);

/** The strategy a genome trades as. */
export function strategyOf(g: Genome, sizePct = 0.3): Strategy {
  return {
    kind: g.kind,
    genes: g.genes,
    genome: { id: g.id, ...(g.parent ? { parent: g.parent } : {}), gen: g.gen },
    coins: [],
    sizePct,
    takeProfitPct: g.tp,
    stopLossPct: g.sl,
    shorts: g.shorts,
  };
}

/** "Breakout · hourly · 36-bar range, trend filter, trailing 2%". */
export function describe(g: Genome): string {
  const bits = [`${STRATEGY_INFO[g.kind].label}`, BAR_LABEL[g.genes.bar] + " bars", `look ${g.genes.look}`];
  if (g.kind === "trend" || g.kind === "conservative" || g.kind === "volatility") bits.push(`fast ${g.genes.fast}`);
  if (g.genes.thr) bits.push(`trigger ${g.genes.thr}`);
  if (g.genes.filter) bits.push(`trend filter ${g.genes.filter}`);
  if (g.genes.trail) bits.push(`trailing ${g.genes.trail}%`);
  bits.push(`TP ${g.tp}% / SL ${g.sl}%`, `hold ≤ ${g.genes.hold} bars`, g.shorts ? "long & short" : "long only");
  return bits.join(" · ");
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export function scoreOf(m: Metrics, events: TradeEvent[]): Score {
  const rets: number[] = [];
  for (const e of events) if (e.action === "close" && e.stake && e.stake > 0) rets.push((e.pnl ?? 0) / e.stake);
  const n = rets.length;
  const mean = n ? rets.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    trades: n,
    ret: round(m.totalReturn, 5),
    avg: round(mean, 5),
    t: n > 1 && sd > 0 ? round((mean / sd) * Math.sqrt(n), 3) : 0,
    winRate: round(m.winRate ?? 0, 3),
    pf: m.profitFactor === null ? null : round(m.profitFactor, 3),
    maxDd: round(m.maxDrawdown, 4),
    days: m.days,
  };
}

export type Slices = { train: [number, number]; val: [number, number]; test: [number, number] };

/** Split a grid's bars in time: 60% train, 20% validation, 20% test. */
export function slices(bars: number, trainShare = 0.6, valShare = 0.2): Slices {
  const a = Math.floor(bars * trainShare);
  const b = Math.floor(bars * (trainShare + valShare));
  return { train: [0, a], val: [a, b], test: [b, bars] };
}

export type EvalOpts = { balance: number; stakeSats: number; costs?: number };

export function evaluate(grid: Grid, g: Genome, [from, to]: [number, number], opts: EvalOpts): Score {
  const r = runBacktest(grid, { strategy: strategyOf(g), balance: opts.balance, stakeSats: opts.stakeSats, from, to, costs: opts.costs ?? 1 });
  return scoreOf(r.metrics, r.events);
}

/** Trades a slice needs before its result counts, by how many days it covers. */
export function minTrades(days: number, slice: "train" | "val" | "test"): number {
  const perDay = slice === "train" ? 0.25 : 0.12;
  return Math.max(slice === "train" ? 15 : 6, Math.round(days * perDay));
}

/**
 * Fitness on the training slice: the t-statistic of per-trade returns,
 * held back until there are enough trades, and marked down for deep
 * drawdowns. Too few trades scores below any real result.
 */
export function fitness(s: Score, need: number): number {
  if (s.trades < need) return -10 + (s.trades / need) * 5;
  return s.t - Math.max(0, s.maxDd - 0.25) * 10;
}

/** The t-statistic of two slices' per-trade returns taken together. */
export function pooledT(a: Score, b: Score): number {
  const parts = [a, b].filter((s) => s.trades > 1);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (const s of parts) {
    const sd = s.t !== 0 ? Math.abs((s.avg * Math.sqrt(s.trades)) / s.t) : 0;
    n += s.trades;
    sum += s.avg * s.trades;
    sumSq += (s.trades - 1) * sd * sd + s.trades * s.avg * s.avg;
  }
  if (n < 2) return 0;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, (sumSq - n * mean * mean) / (n - 1)));
  return sd > 0 ? round((mean / sd) * Math.sqrt(n), 3) : 0;
}

/** Out-of-sample evidence a proven strategy needs: validation and test together at least this t. */
export const PROVEN_OOS_T = 1.5;

/**
 * Proven: made money on all three slices with enough trades, the unseen
 * slices together clearly (not by a whisker), and survived higher costs.
 */
export function isProven(e: Pick<PoolEntry, "train" | "val" | "test" | "stress">): boolean {
  const ok = (s: Score, slice: "train" | "val" | "test") => s.trades >= minTrades(s.days, slice) && s.ret > 0 && s.avg > 0 && (s.pf ?? 0) > 1;
  return ok(e.train, "train") && ok(e.val, "val") && ok(e.test, "test") && e.stress.ret > 0 && pooledT(e.val, e.test) >= PROVEN_OOS_T;
}

/** The t-statistic of live per-trade returns (a steady loss counts as strongly negative). */
export function liveT(live: Live): number {
  if (live.trades < 2) return 0;
  const mean = live.sum / live.trades;
  const sd = Math.sqrt(Math.max(0, live.sumSq / live.trades - mean * mean));
  return sd > 1e-9 ? clamp((mean / sd) * Math.sqrt(live.trades), -4, 4) : Math.sign(mean) * 4;
}

/** How the book ranks an entry: out-of-sample evidence first, then live results once there are enough. */
export function rankScore(e: Pick<PoolEntry, "val" | "test" | "proven" | "live">): number {
  let s = (e.proven ? 5 : 0) + Math.min(e.test.t, 4) + 0.5 * Math.min(e.val.t, 4);
  // Live results count for more the more of them there are, up to outweighing the backtest.
  if (e.live && e.live.trades >= 5) s += Math.min(1, e.live.trades / 30) * 3 * liveT(e.live);
  return round(s, 3);
}

// ── Evolution ───────────────────────────────────────────────────────────────

export type Niche = { kind: StrategyKind; bar: Bar };
export const nicheKey = (n: Niche) => `${n.kind}/${n.bar}`;
export const NICHES: Niche[] = BARS.flatMap((bar) => STRATEGY_KINDS.map((kind) => ({ kind, bar })));

export type EvolveOpts = EvalOpts & {
  seed: number;
  population: number;
  generations: number;
  /** Finalists taken from training to validation. */
  finalists?: number;
  /** Stop breeding once past this time (ms since epoch). */
  deadline?: number;
  /** Genomes to start from (the book's), in this niche. */
  seeds?: Genome[];
};

export type NicheResult = {
  niche: Niche;
  evaluated: number;
  generations: number;
  champion: PoolEntry | null;
  /** The best of the other finalists that also made money on validation. */
  runnersUp: PoolEntry[];
  /** The kind's usual genes on the same slices, for comparison. */
  baseline: { train: Score; val: Score; test: Score };
  /** The best training fitness, generation by generation. */
  curve: number[];
};

/** Breed one niche on its grid, then judge its finalists on validation and the champion on test. */
export function evolveNiche(grid: Grid, niche: Niche, opts: EvolveOpts): NicheResult {
  const r = rng(opts.seed);
  const sl = slices(grid.t.length);
  const days = (s: [number, number]) => ((s[1] - s[0]) * (grid.barMs ?? 300_000)) / 86_400_000;
  const need = minTrades(days(sl.train), "train");
  const mid = Math.floor((sl.train[0] + sl.train[1]) / 2);
  const cache = new Map<string, { g: Genome; halves: [Score, Score]; fit: number }>();
  // Scored by the worse half of the training data: a strategy must work in both.
  const judge = (g: Genome) => {
    const k = keyOf(g);
    let hit = cache.get(k);
    if (!hit) {
      const halves: [Score, Score] = [evaluate(grid, g, [sl.train[0], mid], opts), evaluate(grid, g, [mid, sl.train[1]], opts)];
      hit = { g, halves, fit: Math.min(fitness(halves[0], need / 2), fitness(halves[1], need / 2)) * Math.SQRT2 };
      cache.set(k, hit);
    }
    return hit;
  };

  const base = defaultGenome(niche.kind, niche.bar);
  let pop: Genome[] = [base];
  for (const s of opts.seeds ?? []) {
    const fixed = fix({ ...s, genes: { ...s.genes, bar: niche.bar } });
    pop.push(fixed, mutate(r, fixed), mutate(r, fixed, 0.3));
  }
  while (pop.length < opts.population) pop.push(randomGenome(r, niche.kind, niche.bar));

  const curve: number[] = [];
  let gens = 0;
  for (; gens < opts.generations; gens++) {
    const ranked = pop.map(judge).sort((a, b) => b.fit - a.fit);
    curve.push(round(ranked[0]!.fit, 3));
    if (opts.deadline && Date.now() > opts.deadline) break;
    const elite = ranked.slice(0, Math.max(2, Math.floor(opts.population / 4))).map((x) => x.g);
    const tournament = () => {
      const a = ranked[Math.floor(r() * ranked.length)]!;
      const b = ranked[Math.floor(r() * ranked.length)]!;
      return (a.fit >= b.fit ? a : b).g;
    };
    const next: Genome[] = [...elite];
    const seen = new Set(next.map(keyOf));
    let tries = 0;
    while (next.length < opts.population && tries++ < opts.population * 10) {
      const roll = r();
      const child = roll < 0.55 ? mutate(r, tournament()) : roll < 0.85 ? mutate(r, crossover(r, tournament(), tournament()), 0.08) : randomGenome(r, niche.kind, niche.bar);
      const k = keyOf(child);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push(child);
    }
    pop = next;
  }

  const all = [...cache.values()].sort((a, b) => b.fit - a.fit);
  const finalists = all.filter((x) => x.fit > 0).slice(0, opts.finalists ?? 6);
  const judged = finalists.map((x) => ({ ...x, train: evaluate(grid, x.g, sl.train, opts), val: evaluate(grid, x.g, sl.val, opts) }));
  judged.sort((a, b) => b.val.t - a.val.t);
  const entry = (x: (typeof judged)[number]): PoolEntry => {
    const test = evaluate(grid, x.g, sl.test, opts);
    const stress = evaluate(grid, x.g, sl.val, { ...opts, costs: 1.5 });
    const e = { ...x.g, at: 0, train: x.train, val: x.val, test, stress, proven: false, score: 0 };
    e.proven = isProven(e);
    e.score = rankScore(e);
    return e;
  };
  const champion = judged[0] ? entry(judged[0]) : null;
  // The test slice is looked at for the champion, and for runners-up only once they're chosen on validation.
  const runnersUp = judged.slice(1).filter((x) => x.val.ret > 0 && x.val.trades >= minTrades(x.val.days, "val")).slice(0, 2).map(entry);
  const baseline = { train: evaluate(grid, base, sl.train, opts), val: evaluate(grid, base, sl.val, opts), test: evaluate(grid, base, sl.test, opts) };
  return { niche, evaluated: cache.size, generations: gens, champion, runnersUp, baseline, curve };
}

// ── The guild's book ────────────────────────────────────────────────────────

export const POOL_MAX = 40;

/**
 * Fold a lab run into the book: new champions and runners-up join, a genome
 * already there keeps its live record, retired genomes stay retired, and the
 * book keeps the best POOL_MAX by rank.
 */
export function mergePool(book: PoolEntry[], found: PoolEntry[], at: number): PoolEntry[] {
  const byKey = new Map<string, PoolEntry>();
  for (const e of book) byKey.set(keyOf(e), e);
  for (const f of found) {
    const old = byKey.get(keyOf(f));
    const merged: PoolEntry = { ...f, at, id: old?.id ?? f.id, ...(old?.live ? { live: old.live } : {}), ...(old?.retired ? { retired: old.retired } : {}) };
    merged.score = rankScore(merged);
    byKey.set(keyOf(f), merged);
  }
  // A genome not found again for three weeks, and never traded live, leaves the book.
  const fresh = [...byKey.values()].filter((e) => e.at >= at - 21 * 86_400_000 || (e.live?.trades ?? 0) > 0);
  return fresh.sort((a, b) => Number(!!a.retired) - Number(!!b.retired) || b.score - a.score).slice(0, POOL_MAX);
}

/** Closed trades by genome, from the events of a tick, folded into the book's live records. Bad live records retire. */
export function recordLive(book: PoolEntry[], events: Pick<TradeEvent, "action" | "genomeId" | "pnl" | "stake">[]): PoolEntry[] {
  const add = new Map<string, Live>();
  for (const e of events) {
    if (e.action !== "close" || !e.genomeId || !e.stake) continue;
    const x = (e.pnl ?? 0) / e.stake;
    const l = add.get(e.genomeId) ?? { trades: 0, sum: 0, sumSq: 0, pnl: 0 };
    add.set(e.genomeId, { trades: l.trades + 1, sum: l.sum + x, sumSq: l.sumSq + x * x, pnl: l.pnl + (e.pnl ?? 0) });
  }
  if (!add.size) return book;
  return book.map((e) => {
    const a = add.get(e.id);
    if (!a) return e;
    const l = e.live ?? { trades: 0, sum: 0, sumSq: 0, pnl: 0 };
    const live = { trades: l.trades + a.trades, sum: round(l.sum + a.sum, 6), sumSq: round(l.sumSq + a.sumSq, 6), pnl: l.pnl + a.pnl };
    const next: PoolEntry = { ...e, live };
    next.score = rankScore(next);
    // Twenty live trades losing clearly (not just unluckily) retire it: the backtest was wrong.
    if (!next.retired && live.trades >= 20 && live.sum < 0 && liveT(live) <= -1) next.retired = `lost money over ${live.trades} live trades`;
    return next;
  });
}

/**
 * The genome a new villager is trained in: drawn from the proven entries
 * (or, with none proven, the best-ranked), better-ranked more often, of
 * `kind` if asked — then adjusted a little, so each newcomer is a new
 * variant of what has worked best so far.
 */
export function pickForSpawn(book: PoolEntry[], r: () => number, kind?: StrategyKind): Genome | null {
  const open = book.filter((e) => !e.retired && (!kind || e.kind === kind));
  const proven = open.filter((e) => e.proven);
  const from = (proven.length ? proven : open.filter((e) => e.val.ret > 0 && e.test.ret > 0)).sort((a, b) => b.score - a.score).slice(0, 8);
  if (!from.length) return null;
  // Rank-weighted: the best is twice as likely as the fourth.
  const w = from.map((_, i) => 1 / (1 + i / 3));
  let x = r() * w.reduce((a, b) => a + b, 0);
  let k = 0;
  while (k < from.length - 1 && (x -= w[k]!) > 0) k++;
  const parent = from[k]!;
  return mutate(r, { id: parent.id, kind: parent.kind, genes: parent.genes, tp: parent.tp, sl: parent.sl, shorts: parent.shorts, gen: parent.gen, parent: parent.parent }, 0.06);
}

/**
 * A newcomer's strategy from the book: `want` may name a book entry (by id)
 * or a kind of strategy; otherwise the best of the book. Always a slightly
 * adjusted copy, so the parish keeps exploring around what works. Null when
 * the book has nothing worth training in (the newcomer keeps its
 * temperament's strategy).
 */
export function trainNewcomer(book: PoolEntry[], r: () => number, base: Pick<Strategy, "coins" | "sizePct" | "note">, want?: string | null): Strategy | null {
  const w = (want ?? "").trim().toLowerCase();
  const named = w ? book.find((e) => e.id.toLowerCase() === w && !e.retired) : undefined;
  const kind = STRATEGY_KINDS.find((k) => k === w);
  const child = named
    ? mutate(r, { id: named.id, kind: named.kind, genes: named.genes, tp: named.tp, sl: named.sl, shorts: named.shorts, gen: named.gen, parent: named.parent }, 0.06)
    : pickForSpawn(book, r, kind);
  if (!child) return null;
  const from = book.find((e) => e.id === child.parent);
  if (!from) return null;
  return fromBook({ ...from, genes: child.genes, tp: child.tp, sl: child.sl, shorts: child.shorts }, base, { id: child.id, parent: from.id, gen: child.gen });
}

/** Genomes in the book for one niche (to seed the next run). */
export function seedsFor(book: Genome[], niche: Niche, n = 4): Genome[] {
  return book.filter((e) => e.kind === niche.kind && e.genes.bar === niche.bar).slice(0, n);
}

/** Clean a pool entry arriving over the network (the lab posts its results). */
export function cleanEntry(raw: unknown): PoolEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as StrategyKind;
  if (!STRATEGY_KINDS.includes(kind)) return null;
  const gr = (o.genes ?? {}) as Record<string, unknown>;
  const bar = Number(gr.bar) as Bar;
  if (!BARS.includes(bar)) return null;
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const score = (v: unknown): Score => {
    const s = (v ?? {}) as Record<string, unknown>;
    return { trades: num(s.trades), ret: num(s.ret), avg: num(s.avg), t: num(s.t), winRate: num(s.winRate), pf: s.pf === null ? null : num(s.pf), maxDd: num(s.maxDd), days: num(s.days) };
  };
  const g = fix({
    id: String(o.id ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "genome",
    kind,
    genes: { bar, look: num(gr.look, 10), fast: num(gr.fast, 3), thr: num(gr.thr), filter: num(gr.filter), trail: num(gr.trail), hold: num(gr.hold, 24) },
    tp: num(o.tp, 2),
    sl: num(o.sl, 1),
    shorts: o.shorts === true,
    ...(typeof o.parent === "string" ? { parent: o.parent.replace(/[^a-z0-9-]/gi, "").slice(0, 32) } : {}),
    gen: Math.max(0, Math.floor(num(o.gen))),
  });
  const e: PoolEntry = { ...g, at: num(o.at), train: score(o.train), val: score(o.val), test: score(o.test), stress: score(o.stress), proven: false, score: 0 };
  // Proof is recomputed here, never taken on trust.
  e.proven = isProven(e);
  e.score = rankScore(e);
  return e;
}

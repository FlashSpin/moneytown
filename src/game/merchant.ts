/**
 * The Merchant guild — pure, so it is easy to test. Where the crypto
 * villagers day-trade, the merchants invest the way a stocks & shares ISA
 * can: long-only, in a handful of index funds, rebalanced every week or
 * month, never shorting and never borrowing.
 *
 * The lab tests on long histories of US-listed funds (the proxies, which go
 * back to 2004); a real ISA would hold the matching UK-listed (UCITS) funds,
 * shown next to each proxy. Returns are in the proxies' own currency (US
 * dollars, dividends included): a sterling investor's would differ with the
 * exchange rate.
 *
 * Honest by construction, as in ./lab.ts:
 *   - a decision at day i's close fills at day i+1's close (no look-ahead),
 *     paying COST_PER_TRADE on every pound traded;
 *   - the data is split in time: 60% to breed on, 20% to choose the champion,
 *     20% looked at once for the verdict;
 *   - breeding scores the worse of the two halves of the training data;
 *   - "proven" means a positive return on all three slices AND a better
 *     risk-adjusted return (Sharpe) than a plain 60/40 portfolio on both
 *     validation and test.
 */

// ── The funds ───────────────────────────────────────────────────────────────

export type FundId = "SPY" | "QQQ" | "IWM" | "EWU" | "EEM" | "VNQ" | "GLD" | "TLT" | "IEF" | "SHY";

export const FUNDS: Record<FundId, { name: string; isa: string; kind: "equity" | "real" | "bond" | "cash" }> = {
  SPY: { name: "US large companies (S&P 500)", isa: "VUSA — Vanguard S&P 500 UCITS", kind: "equity" },
  QQQ: { name: "US technology (Nasdaq-100)", isa: "EQQQ — Invesco Nasdaq-100 UCITS", kind: "equity" },
  IWM: { name: "US small companies (Russell 2000)", isa: "R2SC — SPDR Russell 2000 UCITS", kind: "equity" },
  EWU: { name: "UK companies", isa: "ISF — iShares Core FTSE 100", kind: "equity" },
  EEM: { name: "Emerging markets", isa: "VFEM — Vanguard FTSE Emerging Markets UCITS", kind: "equity" },
  VNQ: { name: "Property (REITs)", isa: "IWDP — iShares Developed Markets Property Yield UCITS", kind: "real" },
  GLD: { name: "Gold", isa: "SGLN — iShares Physical Gold", kind: "real" },
  TLT: { name: "Long government bonds", isa: "IDTL — iShares $ Treasury Bond 20+yr UCITS", kind: "bond" },
  IEF: { name: "Medium government bonds", isa: "IBTM — iShares $ Treasury Bond 7-10yr UCITS", kind: "bond" },
  SHY: { name: "Cash-like short bonds", isa: "IB01 — iShares $ Treasury Bond 0-1yr UCITS", kind: "cash" },
};
export const FUND_IDS = Object.keys(FUNDS) as FundId[];
/** Where money waits when a strategy steps aside. */
export const SAFE_FUNDS: FundId[] = ["SHY", "IEF", "TLT", "GLD"];
export const RISK_FUNDS: FundId[] = ["SPY", "QQQ", "IWM", "EWU", "EEM", "VNQ", "GLD", "TLT"];

/** What a trade costs, as a share of the amount traded: the spread, plus Trading 212's 0.15% currency fee on non-sterling funds. */
export const COST_PER_TRADE = 0.002;
/** Differences smaller than this share of the portfolio aren't traded (saves costs). */
export const BAND = 0.01;
const DAYS_PER_YEAR = 252;

// ── Prices ──────────────────────────────────────────────────────────────────

/** Daily closes (dividends included) on a common calendar: `px[f][i]` on `days[i]`, NaN before a fund existed. */
export type Daily = { days: string[]; px: Partial<Record<FundId, Float64Array>> };

/** Line up each fund's daily closes on one calendar; a missing day repeats the last close. */
export function toDaily(rows: Partial<Record<FundId, { d: string; c: number }[]>>): Daily {
  const all = new Set<string>();
  for (const r of Object.values(rows)) for (const x of r ?? []) all.add(x.d);
  const days = [...all].sort();
  const index = new Map(days.map((d, i) => [d, i]));
  const px: Daily["px"] = {};
  for (const [f, r] of Object.entries(rows) as [FundId, { d: string; c: number }[]][]) {
    const col = new Float64Array(days.length).fill(NaN);
    for (const x of r) if (x.c > 0) col[index.get(x.d)!] = x.c;
    let last = NaN;
    for (let i = 0; i < col.length; i++) {
      if (col[i]! > 0) last = col[i]!;
      else if (last > 0) col[i] = last;
    }
    px[f] = col;
  }
  return { days, px };
}

/** The first day from which every one of `funds` has a price. */
export function firstCommonDay(g: Daily, funds: FundId[]): number {
  let start = 0;
  for (const f of funds) {
    const col = g.px[f];
    if (!col) return g.days.length;
    let i = 0;
    while (i < col.length && !(col[i]! > 0)) i++;
    start = Math.max(start, i);
  }
  return start;
}

/** Prefix sums per fund, so any moving average is O(1). */
const prefixes = new WeakMap<Daily, Partial<Record<FundId, Float64Array>>>();
function prefixOf(g: Daily, f: FundId): Float64Array {
  let cache = prefixes.get(g);
  if (!cache) prefixes.set(g, (cache = {}));
  let p = cache[f];
  if (!p) {
    const col = g.px[f]!;
    p = new Float64Array(col.length + 1);
    for (let i = 0; i < col.length; i++) p[i + 1] = p[i]! + (col[i]! > 0 ? col[i]! : 0);
    cache[f] = p;
  }
  return p;
}

/** Average close over the `n` days ending at day i, or null without the history. */
export function avg(g: Daily, f: FundId, i: number, n: number): number | null {
  const col = g.px[f];
  if (!col || i - n + 1 < 0 || !(col[i - n + 1]! > 0)) return null;
  const p = prefixOf(g, f);
  return (p[i + 1]! - p[i - n + 1]!) / n;
}

/** Return over the `n` days ending at day i, or null. */
export function ret(g: Daily, f: FundId, i: number, n: number): number | null {
  const col = g.px[f];
  if (!col || i - n < 0 || !(col[i - n]! > 0) || !(col[i]! > 0)) return null;
  return col[i]! / col[i - n]! - 1;
}

// ── Strategies ──────────────────────────────────────────────────────────────

/**
 * A merchant's strategy.
 *   hold      keep `funds` in equal shares
 *   trend     each of `funds` in equal shares while above its `sma`-day
 *             average; its share goes to `safe` while below
 *   momentum  the `top` of `funds` with the best `look`-day return; with
 *             `abs`, a fund that hasn't beaten `safe` over the same days is
 *             swapped for `safe`
 * Rebalanced every `every` trading days.
 */
export type MGenome = {
  id: string;
  gen: number;
  parent?: string;
  mode: "hold" | "trend" | "momentum";
  funds: FundId[];
  sma: number;
  look: number;
  top: number;
  abs: 0 | 1;
  safe: FundId;
  every: number;
};

export type Weights = Partial<Record<FundId, number>>;

/** The target weights at day i's close, from closes up to day i only. */
export function targetWeights(g: Daily, m: MGenome, i: number): Weights | null {
  const out: Weights = {};
  const add = (f: FundId, w: number) => (out[f] = (out[f] ?? 0) + w);
  const funds = m.funds.filter((f) => (g.px[f]?.[i] ?? 0) > 0);
  if (!funds.length) return null;
  if (m.mode === "hold") {
    for (const f of funds) add(f, 1 / funds.length);
    return out;
  }
  if (m.mode === "trend") {
    for (const f of funds) {
      const a = avg(g, f, i, m.sma);
      if (a === null) return null;
      add(g.px[f]![i]! > a ? f : m.safe, 1 / funds.length);
    }
    return out;
  }
  const ranked = funds
    .map((f) => ({ f, r: ret(g, f, i, m.look) }))
    .filter((x): x is { f: FundId; r: number } => x.r !== null)
    .sort((a, b) => b.r - a.r);
  if (ranked.length < Math.min(m.top, funds.length)) return null;
  const hurdle = m.abs ? (ret(g, m.safe, i, m.look) ?? 0) : -Infinity;
  const picks = ranked.slice(0, Math.max(1, Math.min(m.top, ranked.length)));
  for (const p of picks) add(p.r > hurdle ? p.f : m.safe, 1 / picks.length);
  return out;
}

// ── Simulation ──────────────────────────────────────────────────────────────

export type MScore = {
  days: number;
  /** Total return over the slice. */
  total: number;
  /** Yearly return, compounded. */
  cagr: number;
  vol: number;
  sharpe: number;
  maxDd: number;
  /** Share of the portfolio traded a year. */
  turnover: number;
  trades: number;
};

export type SimResult = { score: MScore; equity: number[] };

/**
 * Run a strategy over days [from, to): decide at each rebalance day's close,
 * fill at the next day's close, paying `cost` on what is traded, skipping
 * differences under BAND.
 */
export function simulate(g: Daily, m: MGenome, from: number, to: number, cost = COST_PER_TRADE): SimResult {
  const units: Weights = {};
  let cash = 1;
  let pending: Weights | null = null;
  let traded = 0;
  let trades = 0;
  const equity: number[] = [];
  const value = (i: number) => {
    let v = cash;
    for (const [f, u] of Object.entries(units) as [FundId, number][]) v += u * g.px[f]![i]!;
    return v;
  };
  for (let i = from; i < to; i++) {
    if (pending) {
      const v = value(i);
      for (const f of new Set([...Object.keys(units), ...Object.keys(pending)]) as Set<FundId>) {
        const p = g.px[f]![i]!;
        const now = ((units[f] ?? 0) * p) / v;
        const want = pending[f] ?? 0;
        if (Math.abs(want - now) < BAND && want > 0) continue;
        const delta = (want - now) * v;
        if (Math.abs(delta) < 1e-12) continue;
        units[f] = (units[f] ?? 0) + delta / p;
        if (units[f]! < 1e-12) delete units[f];
        cash -= delta + Math.abs(delta) * cost;
        traded += Math.abs(delta) / v;
        trades++;
      }
      pending = null;
    }
    equity.push(value(i));
    if ((i - from) % m.every === 0 && i < to - 1) pending = targetWeights(g, m, i);
  }
  return { score: scoreOf(equity, traded, trades), equity };
}

export function scoreOf(equity: number[], traded = 0, trades = 0): MScore {
  const n = equity.length;
  if (n < 2) return { days: n, total: 0, cagr: 0, vol: 0, sharpe: 0, maxDd: 0, turnover: 0, trades };
  let peak = equity[0]!;
  let maxDd = 0;
  let sum = 0;
  let sq = 0;
  for (let i = 1; i < n; i++) {
    const r = equity[i]! / equity[i - 1]! - 1;
    sum += r;
    sq += r * r;
    peak = Math.max(peak, equity[i]!);
    maxDd = Math.max(maxDd, (peak - equity[i]!) / peak);
  }
  const mean = sum / (n - 1);
  const sd = Math.sqrt(Math.max(0, sq / (n - 1) - mean * mean));
  const years = (n - 1) / DAYS_PER_YEAR;
  const total = equity[n - 1]! / equity[0]! - 1;
  const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
  return {
    days: n,
    total: r4(total),
    cagr: r4((1 + total) ** (1 / Math.max(years, 1 / DAYS_PER_YEAR)) - 1),
    vol: r4(sd * Math.sqrt(DAYS_PER_YEAR)),
    sharpe: sd > 0 ? Math.round(((mean * DAYS_PER_YEAR) / (sd * Math.sqrt(DAYS_PER_YEAR))) * 1000) / 1000 : 0,
    maxDd: r4(maxDd),
    turnover: r4(traded / Math.max(years, 1 / DAYS_PER_YEAR)),
    trades,
  };
}

// ── Baselines and the core ─────────────────────────────────────────────────

const base = (id: string, mode: MGenome["mode"], funds: FundId[], extra: Partial<MGenome> = {}): MGenome => ({
  id,
  gen: 0,
  mode,
  funds,
  sma: 200,
  look: 126,
  top: 2,
  abs: 1,
  safe: "SHY",
  every: 21,
  ...extra,
});

/** Hold US large companies. */
export const US_STOCKS = base("bench-us", "hold", ["SPY"]);
/** The classic 60/40: 60% shares, 40% bonds, rebalanced monthly (three US shares to two medium bonds). */
export const SIXTY_FORTY = base("bench-6040", "hold", ["SPY", "SPY", "SPY", "IEF", "IEF"]);
/**
 * The core rule (80% of the paper ISA): a well-documented trend rule —
 * US, UK and emerging shares, property, gold and bonds in equal shares, each
 * held only while above its 200-day average, cash-like bonds otherwise,
 * checked monthly.
 */
export const CORE = base("core-trend", "trend", ["SPY", "EWU", "EEM", "VNQ", "GLD", "IEF"], { sma: 200, safe: "SHY", every: 21 });

// ── The lab ─────────────────────────────────────────────────────────────────

export type MEntry = MGenome & {
  train: MScore;
  val: MScore;
  test: MScore;
  proven: boolean;
  /** How far ahead of 60/40 on validation and test (Sharpe points, the smaller of the two). */
  edge: number;
};

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

const EVERY = [5, 10, 21, 63];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
let serial = 0;
const newId = (r: () => number, mode: string) => {
  serial = (serial + 1) % 1296;
  return `m${mode.slice(0, 2)}-${Math.floor(r() * 36 ** 4).toString(36).padStart(4, "0")}${serial.toString(36).padStart(2, "0")}`;
};

export function fixM(m: MGenome): MGenome {
  const funds = [...new Set(m.funds)].filter((f) => FUND_IDS.includes(f)).sort();
  const out: MGenome = {
    ...m,
    funds: funds.length ? funds : ["SPY"],
    sma: Math.round(clamp(m.sma, 20, 250)),
    look: Math.round(clamp(m.look, 10, 252)),
    top: Math.round(clamp(m.top, 1, 5)),
    abs: m.abs ? 1 : 0,
    safe: SAFE_FUNDS.includes(m.safe) ? m.safe : "SHY",
    every: EVERY.includes(m.every) ? m.every : 21,
  };
  // Settings a mode doesn't use get one fixed value, so strategies that trade alike look alike.
  if (out.mode !== "trend") out.sma = 200;
  if (out.mode !== "momentum") Object.assign(out, { look: 126, top: 1, abs: 0 });
  if (out.mode === "hold") out.safe = "SHY";
  return out;
}

export function randomM(r: () => number): MGenome {
  const pool = RISK_FUNDS.filter(() => r() < 0.5);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  return fixM({
    id: newId(r, "x"),
    gen: 0,
    mode: pick(["hold", "trend", "trend", "momentum", "momentum"] as const),
    funds: pool.length >= 2 ? pool : ["SPY", "IEF"],
    sma: 20 + r() * 230,
    look: 10 + r() * 242,
    top: 1 + Math.floor(r() * 4),
    abs: r() < 0.6 ? 1 : 0,
    safe: pick(SAFE_FUNDS),
    every: pick(EVERY),
  });
}

/** A small adjustment: one or two settings nudged, a fund added or dropped. */
export function mutateM(r: () => number, m: MGenome): MGenome {
  const next: MGenome = { ...m, funds: [...m.funds], id: newId(r, m.mode), parent: m.id, gen: m.gen + 1 };
  const nudge = (x: number) => x * Math.exp((r() - 0.5) * 0.4);
  const changes = 1 + (r() < 0.4 ? 1 : 0);
  for (let k = 0; k < changes; k++) {
    const pick = Math.floor(r() * 8);
    if (pick === 0) next.sma = nudge(next.sma);
    else if (pick === 1) next.look = nudge(next.look);
    else if (pick === 2) next.top += r() < 0.5 ? -1 : 1;
    else if (pick === 3) next.abs = next.abs ? 0 : 1;
    else if (pick === 4) next.safe = SAFE_FUNDS[Math.floor(r() * SAFE_FUNDS.length)]!;
    else if (pick === 5) next.every = EVERY[Math.floor(r() * EVERY.length)]!;
    else if (pick === 6) {
      const f = RISK_FUNDS[Math.floor(r() * RISK_FUNDS.length)]!;
      next.funds = next.funds.includes(f) && next.funds.length > 1 ? next.funds.filter((x) => x !== f) : [...next.funds, f];
    } else if (r() < 0.2) next.mode = (["hold", "trend", "momentum"] as const)[Math.floor(r() * 3)]!;
  }
  return fixM(next);
}

export function crossM(r: () => number, a: MGenome, b: MGenome): MGenome {
  const pick = <T,>(x: T, y: T) => (r() < 0.5 ? x : y);
  return fixM({
    id: newId(r, a.mode),
    gen: Math.max(a.gen, b.gen) + 1,
    parent: a.id,
    mode: pick(a.mode, b.mode),
    funds: [...new Set([...a.funds, ...b.funds])].filter(() => r() < 0.7),
    sma: pick(a.sma, b.sma),
    look: pick(a.look, b.look),
    top: pick(a.top, b.top),
    abs: pick(a.abs, b.abs),
    safe: pick(a.safe, b.safe),
    every: pick(a.every, b.every),
  });
}

export const keyM = (m: MGenome) => JSON.stringify([m.mode, m.funds, m.sma, m.look, m.top, m.abs, m.safe, m.every]);

export function describeM(m: MGenome): string {
  const list = m.funds.join(", ");
  const when = m.every === 5 ? "weekly" : m.every === 10 ? "every two weeks" : m.every === 21 ? "monthly" : "quarterly";
  if (m.mode === "hold") return `Hold ${list} in equal shares, rebalanced ${when}`;
  if (m.mode === "trend") return `Hold ${list} while each is above its ${m.sma}-day average (else ${m.safe}), checked ${when}`;
  return `Hold the best ${m.top} of ${list} by ${m.look}-day return${m.abs ? `, only if beating ${m.safe} (else ${m.safe})` : ""}, checked ${when}`;
}

export type MSlices = { train: [number, number]; val: [number, number]; test: [number, number] };

export function mSlices(from: number, to: number): MSlices {
  const n = to - from;
  const a = from + Math.floor(n * 0.6);
  const b = from + Math.floor(n * 0.8);
  return { train: [from, a], val: [a, b], test: [b, to] };
}

/** The history every strategy needs before its first decision (the longest average or look-back allowed). */
export const WARMUP = 253;

export type MLabResult = {
  from: string;
  to: string;
  evaluated: number;
  generations: number;
  champion: MEntry | null;
  runnersUp: MEntry[];
  benchmarks: { name: string; genome: MGenome; train: MScore; val: MScore; test: MScore }[];
  curve: number[];
};

/** Breed merchant strategies on `g` and judge them honestly (see the top of this file). */
export function evolveMerchants(g: Daily, opts: { seed: number; population: number; generations: number; seeds?: MGenome[]; deadline?: number }): MLabResult {
  const r = rng(opts.seed);
  const from = Math.min(g.days.length, firstCommonDay(g, FUND_IDS) + WARMUP);
  const to = g.days.length;
  const sl = mSlices(from, to);
  const mid = Math.floor((sl.train[0] + sl.train[1]) / 2);
  const cache = new Map<string, { m: MGenome; fit: number }>();
  const judge = (m: MGenome) => {
    const k = keyM(m);
    let hit = cache.get(k);
    if (!hit) {
      // The worse half of the training data, so one lucky stretch can't carry it.
      const a = simulate(g, m, sl.train[0], mid).score;
      const b = simulate(g, m, mid, sl.train[1]).score;
      hit = { m, fit: Math.min(a.sharpe, b.sharpe) - 0.5 * Math.max(a.maxDd, b.maxDd) };
      cache.set(k, hit);
    }
    return hit;
  };
  let pop: MGenome[] = [CORE, SIXTY_FORTY, US_STOCKS, ...(opts.seeds ?? []).flatMap((s) => [fixM(s), mutateM(r, s)])];
  while (pop.length < opts.population) pop.push(randomM(r));
  const curve: number[] = [];
  let gens = 0;
  for (; gens < opts.generations; gens++) {
    const ranked = pop.map(judge).sort((a, b) => b.fit - a.fit);
    curve.push(Math.round(ranked[0]!.fit * 1000) / 1000);
    if (opts.deadline && Date.now() > opts.deadline) break;
    const next = ranked.slice(0, Math.max(2, Math.floor(opts.population / 4))).map((x) => x.m);
    const seen = new Set(next.map(keyM));
    const pickT = () => {
      const a = ranked[Math.floor(r() * ranked.length)]!;
      const b = ranked[Math.floor(r() * ranked.length)]!;
      return (a.fit >= b.fit ? a : b).m;
    };
    let tries = 0;
    while (next.length < opts.population && tries++ < opts.population * 10) {
      const x = r();
      const child = x < 0.55 ? mutateM(r, pickT()) : x < 0.85 ? mutateM(r, crossM(r, pickT(), pickT())) : randomM(r);
      if (seen.has(keyM(child))) continue;
      seen.add(keyM(child));
      next.push(child);
    }
    pop = next;
  }
  const scores = (m: MGenome) => ({ train: simulate(g, m, ...sl.train).score, val: simulate(g, m, ...sl.val).score, test: simulate(g, m, ...sl.test).score });
  const bench6040 = scores(SIXTY_FORTY);
  const benchmarks = [
    { name: "US shares, held", genome: US_STOCKS, ...scores(US_STOCKS) },
    { name: "60/40 shares and bonds", genome: SIXTY_FORTY, ...bench6040 },
    { name: "The core trend rule", genome: CORE, ...scores(CORE) },
  ];
  const benchKeys = new Set([keyM(US_STOCKS), keyM(SIXTY_FORTY)]);
  const finalists = [...cache.values()]
    .filter((x) => x.fit > 0 && !benchKeys.has(keyM(x.m)))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 6)
    .map((x) => ({ m: x.m, train: simulate(g, x.m, ...sl.train).score, val: simulate(g, x.m, ...sl.val).score }))
    .sort((a, b) => b.val.sharpe - a.val.sharpe);
  const entry = (x: (typeof finalists)[number]): MEntry => {
    const test = simulate(g, x.m, ...sl.test).score;
    const edge = Math.min(x.val.sharpe - bench6040.val.sharpe, test.sharpe - bench6040.test.sharpe);
    const proven = x.train.total > 0 && x.val.total > 0 && test.total > 0 && edge > 0;
    return { ...x.m, train: x.train, val: x.val, test, proven, edge: Math.round(edge * 1000) / 1000 };
  };
  const champion = finalists[0] ? entry(finalists[0]) : null;
  const runnersUp = finalists.slice(1).filter((x) => x.val.sharpe > bench6040.val.sharpe).slice(0, 3).map(entry);
  return { from: g.days[from] ?? "", to: g.days[to - 1] ?? "", evaluated: cache.size, generations: gens, champion, runnersUp, benchmarks, curve };
}

// ── The paper ISA ───────────────────────────────────────────────────────────

/** The share of the paper ISA that follows the core rule; the rest follows the guild's best proven strategy. */
export const CORE_SHARE = 0.8;
export const ISA_START = 10_000;
/** The yearly ISA allowance (UK), for the record. */
export const ISA_ALLOWANCE = 20_000;

export type IsaTrade = { d: string; fund: FundId; value: number; cost: number; why: string };

export type Isa = {
  started: string;
  cash: number;
  units: Weights;
  /** Targets decided at the last close, filled at the next. */
  pending?: { d: string; w: Weights; why: string };
  lastDay?: string;
  lastDecision?: string;
  satellite: { id: string; desc: string; proven: boolean };
  history: { d: string; v: number; us: number; sf: number }[];
  trades: IsaTrade[];
  /** The benchmarks held from the start: units of each. */
  bench: { us: Weights; sf: Weights };
  /** The latest close of each fund held (to value holdings). */
  lastPx?: Weights;
};

const HISTORY_KEPT = 2000;
const TRADES_KEPT = 200;

function valueOf(units: Weights, cash: number, price: (f: FundId) => number): number {
  let v = cash;
  for (const [f, u] of Object.entries(units) as [FundId, number][]) v += u * (price(f) || 0);
  return v;
}

function buyHold(w: Weights, amount: number, price: (f: FundId) => number): Weights {
  const out: Weights = {};
  for (const [f, x] of Object.entries(w) as [FundId, number][]) if (price(f) > 0) out[f] = ((x * amount) / price(f)) * (1 - COST_PER_TRADE);
  return out;
}

/** 80% the core's weights, 20% the satellite's. */
export function blend(core: Weights | null, sat: Weights | null): Weights | null {
  if (!core) return null;
  const out: Weights = {};
  for (const [f, w] of Object.entries(core) as [FundId, number][]) out[f] = (out[f] ?? 0) + w * CORE_SHARE;
  for (const [f, w] of Object.entries(sat ?? core) as [FundId, number][]) out[f] = (out[f] ?? 0) + w * (1 - CORE_SHARE);
  return out;
}

/**
 * One trading day for the paper ISA, at day i's close: fill the targets
 * decided at the previous close, value everything, and — on a rebalance day
 * — decide new targets (filled at the next close). Pure: returns the new
 * state and what was traded.
 */
export function stepIsa(prev: Isa | undefined, g: Daily, i: number, satellite: MEntry | null): { isa: Isa; traded: IsaTrade[] } {
  const d = g.days[i]!;
  const price = (f: FundId) => g.px[f]?.[i] ?? 0;
  const sat = satellite && satellite.proven ? satellite : null;
  let isa: Isa =
    prev ??
    ({
      started: d,
      cash: ISA_START,
      units: {},
      satellite: sat ? { id: sat.id, desc: describeM(sat), proven: true } : { id: CORE.id, desc: "the core rule (nothing proven yet)", proven: false },
      history: [],
      trades: [],
      bench: { us: buyHold({ SPY: 1 }, ISA_START, price), sf: buyHold({ SPY: 0.6, IEF: 0.4 }, ISA_START, price) },
    } satisfies Isa);
  if (isa.lastDay && isa.lastDay >= d) return { isa, traded: [] };
  const satInfo = sat ? { id: sat.id, desc: describeM(sat), proven: true } : { id: CORE.id, desc: "the core rule (nothing proven yet)", proven: false };
  isa = { ...isa, units: { ...isa.units }, satellite: satInfo };

  const traded: IsaTrade[] = [];
  if (isa.pending) {
    const v = valueOf(isa.units, isa.cash, price);
    const want = isa.pending.w;
    for (const f of new Set([...Object.keys(isa.units), ...Object.keys(want)]) as Set<FundId>) {
      const p = price(f);
      if (!(p > 0)) continue;
      const now = ((isa.units[f] ?? 0) * p) / v;
      const target = want[f] ?? 0;
      if (Math.abs(target - now) < BAND && target > 0) continue;
      const delta = (target - now) * v;
      if (Math.abs(delta) < 0.01) continue;
      const cost = Math.abs(delta) * COST_PER_TRADE;
      isa.units[f] = (isa.units[f] ?? 0) + delta / p;
      if (isa.units[f]! < 1e-9) delete isa.units[f];
      isa.cash -= delta + cost;
      traded.push({ d, fund: f, value: Math.round(delta * 100) / 100, cost: Math.round(cost * 100) / 100, why: isa.pending.why });
    }
    isa.pending = undefined;
  }

  const v = valueOf(isa.units, isa.cash, price);
  isa.history = [...isa.history, { d, v: Math.round(v * 100) / 100, us: Math.round(valueOf(isa.bench.us, 0, price) * 100) / 100, sf: Math.round(valueOf(isa.bench.sf, 0, price) * 100) / 100 }].slice(-HISTORY_KEPT);
  isa.trades = [...traded.reverse(), ...isa.trades].slice(0, TRADES_KEPT);
  isa.lastDay = d;
  isa.lastPx = Object.fromEntries(Object.keys(isa.units).map((f) => [f, price(f as FundId)]));

  // Decide on the first day, then every CORE.every trading days (or sooner, the satellite's own schedule).
  const every = Math.min(CORE.every, sat?.every ?? CORE.every);
  const since = isa.lastDecision ? g.days.indexOf(isa.lastDecision) : -1;
  if (since < 0 || i - since >= every) {
    const w = blend(targetWeights(g, CORE, i), sat ? targetWeights(g, sat, i) : null);
    if (w) {
      isa.pending = { d, w, why: sat ? `core rule 80%, ${sat.id} 20%` : "core rule" };
      isa.lastDecision = d;
    }
  }
  return { isa, traded };
}

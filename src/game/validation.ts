/**
 * Out-of-sample validation — pure, so it is easy to test. A strategy's
 * backtest on the data it was tuned on flatters it; these reports keep the
 * tuning away from the data it is judged on:
 *
 *   - hold-out: tune take-profit/stop-loss on the first DEV_SHARE of the
 *     data only, then judge the chosen settings once on the rest;
 *   - walk-forward: split the data into WF_SEGMENTS; for each later segment,
 *     tune on everything before it and judge on it, then chain the results;
 *   - cost sensitivity: the default settings with no costs, live costs and
 *     double costs;
 *   - parameter sensitivity: every grid setting on the whole data (labelled
 *     in-sample — for seeing how fragile a strategy is, never for choosing).
 * Every strategy is reported, including the ones that fail, next to the
 * baselines of holding cash and holding Bitcoin over the same bars.
 */
import { defaultFor, holdBaseline, runBacktest, thin, type Grid, type Metrics } from "./backtest.ts";
import { EST_HALF_SPREAD, EST_HALF_SPREAD_TOP } from "./execution.ts";
import { FEE_RATE, TRADING_COST_PCT } from "./risk.ts";
import { STRATEGY_INFO, STRATEGY_KINDS, type Strategy, type StrategyKind } from "./strategies.ts";

export const DEV_SHARE = 0.7;
export const WF_SEGMENTS = 5;
/** Take-profit and stop-loss multipliers tried when tuning. */
export const GRID_STEPS = [0.5, 1, 1.5];

export type Setting = { tp: number; sl: number };

export type KindReport = {
  kind: StrategyKind;
  label: string;
  /** Default settings over all the data (in-sample: nothing was tuned, but the defaults were chosen by hand). */
  full: Metrics;
  equity: number[];
  costSensitivity: { costs: number; totalReturn: number; trades: number }[];
  /** In-sample parameter sensitivity. */
  grid: (Setting & { totalReturn: number; maxDrawdown: number; trades: number })[];
  holdout: { chosen: Setting; dev: Metrics; validation: Metrics; defaultValidation: Metrics };
  walkForward: { folds: { from: number; to: number; chosen: Setting; test: Metrics }[]; oosReturn: number; worstDrawdown: number };
  /** Plain-English verdict on the out-of-sample evidence. */
  verdict: string;
};

export type BacktestReport = {
  bars: number;
  days: number;
  coins: number;
  baselines: { cash: Metrics; btc: Metrics | null; btcValidation: Metrics | null };
  btcEquity: number[];
  kinds: KindReport[];
};

function settings(kind: StrategyKind): Setting[] {
  const info = STRATEGY_INFO[kind];
  const out: Setting[] = [];
  for (const a of GRID_STEPS) for (const b of GRID_STEPS) out.push({ tp: +(info.tp * a).toFixed(2), sl: +(info.sl * b).toFixed(2) });
  return out;
}

const withSetting = (base: Strategy, s: Setting): Strategy => ({ ...base, takeProfitPct: s.tp, stopLossPct: s.sl });

/** Better: higher return; on a tie, the smaller drawdown. */
function better(a: Metrics, b: Metrics): boolean {
  if (a.totalReturn !== b.totalReturn) return a.totalReturn > b.totalReturn;
  return a.maxDrawdown < b.maxDrawdown;
}

/** The grid setting that did best on bars [from, to) — the only data it may look at. */
export function tune(g: Grid, base: Strategy, from: number, to: number, opts: { balance: number; stakeSats: number }): Setting {
  const defaults = { tp: base.takeProfitPct, sl: base.stopLossPct };
  let best: { s: Setting; m: Metrics } | null = null;
  for (const s of settings(base.kind)) {
    const m = runBacktest(g, { ...opts, strategy: withSetting(base, s), from, to }).metrics;
    if (!best || better(m, best.m)) best = { s, m };
  }
  // Nothing traded at all: keep the defaults rather than an arbitrary pick.
  return best && best.m.trades > 0 ? best.s : defaults;
}

export function reportKind(g: Grid, kind: StrategyKind, opts: { balance: number; stakeSats: number; btcValidation: Metrics | null }): KindReport {
  const n = g.t.length;
  const base = defaultFor(kind);
  const run = (strategy: Strategy, from = 0, to = n, costs = 1) => runBacktest(g, { balance: opts.balance, stakeSats: opts.stakeSats, strategy, from, to, costs });

  const full = run(base);
  const costSensitivity = [0, 1, 2].map((costs) => {
    const m = costs === 1 ? full.metrics : run(base, 0, n, costs).metrics;
    return { costs, totalReturn: m.totalReturn, trades: m.trades };
  });
  const grid = settings(kind).map((s) => {
    const m = run(withSetting(base, s)).metrics;
    return { ...s, totalReturn: m.totalReturn, maxDrawdown: m.maxDrawdown, trades: m.trades };
  });

  const split = Math.floor(n * DEV_SHARE);
  const chosen = tune(g, base, 0, split, opts);
  const holdout = {
    chosen,
    dev: run(withSetting(base, chosen), 0, split).metrics,
    validation: run(withSetting(base, chosen), split, n).metrics,
    defaultValidation: run(base, split, n).metrics,
  };

  const bounds = Array.from({ length: WF_SEGMENTS + 1 }, (_, k) => Math.floor((k * n) / WF_SEGMENTS));
  const folds = [];
  let chained = 1;
  let worst = 0;
  for (let k = 1; k < WF_SEGMENTS; k++) {
    const pick = tune(g, base, 0, bounds[k]!, opts);
    const test = run(withSetting(base, pick), bounds[k]!, bounds[k + 1]!).metrics;
    folds.push({ from: bounds[k]!, to: bounds[k + 1]!, chosen: pick, test });
    chained *= 1 + test.totalReturn;
    worst = Math.max(worst, test.maxDrawdown);
  }
  const oosReturn = chained - 1;

  return {
    kind,
    label: STRATEGY_INFO[kind].label,
    full: full.metrics,
    equity: thin(full.equity),
    costSensitivity,
    grid,
    holdout,
    walkForward: { folds, oosReturn, worstDrawdown: worst },
    verdict: verdictFor(holdout.validation, oosReturn, opts.btcValidation),
  };
}

function pct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

function verdictFor(validation: Metrics, oos: number, btc: Metrics | null): string {
  if (validation.trades < 5) return `Too few trades on unseen data (${validation.trades}) to judge — gather more history.`;
  const beatCash = validation.totalReturn > 0 && oos > 0;
  const beatBtc = btc ? validation.totalReturn > btc.totalReturn : false;
  if (beatCash && beatBtc) return `Made money on unseen data (${pct(validation.totalReturn)}; walk-forward ${pct(oos)}) and beat holding Bitcoin — promising, not proven.`;
  if (beatCash) return `Made money on unseen data (${pct(validation.totalReturn)}; walk-forward ${pct(oos)}) but did no better than holding Bitcoin.`;
  return `Lost money on unseen data (${pct(validation.totalReturn)}; walk-forward ${pct(oos)}) — failed; don't trust it with real money.`;
}

/** The whole report: every strategy against the baselines. */
export function fullReport(g: Grid, opts: { balance: number; stakeSats: number }, kinds: StrategyKind[] = STRATEGY_KINDS): BacktestReport {
  const n = g.t.length;
  const split = Math.floor(n * DEV_SHARE);
  const btc = holdBaseline(g, "BTC", opts.balance);
  const btcValidation = holdBaseline(g, "BTC", opts.balance, split, n)?.metrics ?? null;
  const cash = holdCash(opts.balance, n);
  return {
    bars: n,
    days: Math.round(((n * 5) / 1440) * 10) / 10,
    coins: Object.keys(g.px).length,
    baselines: { cash, btc: btc?.metrics ?? null, btcValidation },
    btcEquity: thin(btc?.equity ?? []),
    kinds: kinds.map((k) => reportKind(g, k, { ...opts, btcValidation })),
  };
}

function holdCash(balance: number, bars: number): Metrics {
  return {
    bars,
    days: Math.round(((bars * 5) / 1440) * 10) / 10,
    startBalance: balance,
    endBalance: balance,
    totalReturn: 0,
    maxDrawdown: 0,
    trades: 0,
    winRate: null,
    profitFactor: null,
    avgTrade: null,
    sharpe: null,
    fees: 0,
    costs: 0,
    exposure: 0,
  };
}

function hash(text: string, h = 5381): number {
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

/** Bump when the engine's behaviour changes, so old and new runs aren't compared as equals. */
export const ENGINE_VERSION = 1;

/** A fingerprint of everything that decides a result: the strategies, costs and method. */
export function strategyVersion(): string {
  const spec = JSON.stringify({ STRATEGY_INFO, FEE_RATE, TRADING_COST_PCT, EST_HALF_SPREAD, EST_HALF_SPREAD_TOP, GRID_STEPS, DEV_SHARE, WF_SEGMENTS, ENGINE_VERSION });
  return `v${ENGINE_VERSION}-${hash(spec).toString(16)}`;
}

/** Which data a run saw: its span, coins, how many prices, and a fingerprint of them. */
export function dataSnapshot(g: Grid): { from: number | null; to: number | null; bars: number; coins: string[]; prices: number; fingerprint: string } {
  let h = 5381;
  let prices = 0;
  for (const coin of Object.keys(g.px).sort()) {
    h = hash(coin, h);
    for (const v of g.px[coin]!) {
      if (!(v > 0)) continue;
      prices++;
      h = hash(v.toPrecision(10), h);
    }
  }
  return { from: g.t[0] ?? null, to: g.t[g.t.length - 1] ?? null, bars: g.t.length, coins: Object.keys(g.px).sort(), prices, fingerprint: h.toString(16) };
}

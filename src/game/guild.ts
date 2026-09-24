/**
 * The Merchant guild — how every villager invests, pure so it is easy to
 * test. Each villager is a merchant with its own paper stocks & shares ISA:
 * cash (its purse, in pence) and units of the guild's funds
 * (./merchant.ts FUNDS), run by one fund strategy (an MGenome: hold, trend
 * or momentum, checked weekly to quarterly).
 *
 * Every market day, after the close (`stepMerchant`):
 *   1. the orders decided at the previous close fill at today's close, each
 *      trade paying COST_PER_TRADE (sells first, so buys never overdraw);
 *   2. everything is valued at today's close;
 *   3. on a rebalance day, new target weights are decided from closes up to
 *      today only, to fill at the next close.
 * Money only moves through the ledger (./ledger.ts): buys to the market,
 * sales from it, costs to the fees account.
 */
import type { Temper } from "./trading.ts";
import { COST_PER_TRADE, BAND, CORE, fixM, mutateM, SIXTY_FORTY, targetWeights, US_STOCKS, type Daily, type FundId, type MEntry, type MGenome, type Weights } from "./merchant.ts";

export type Holdings = Partial<Record<FundId, number>>;

/** A villager's strategy: a fund strategy, where it came from, and its own note. */
export type GuildStrategy = {
  genome: MGenome;
  /** The preset it follows (./guild.ts PRESETS), or the lab genome it was trained in. */
  preset?: string;
  book?: string;
  note?: string;
};

/** One fill: + bought, - sold, in pence at the close. */
export type FundTrade = { t: number; d: string; id: string; name: string; fund: FundId; value: number; cost: number; why: string };

/** Everything a villager's investing needs (the rest of a Subject is the town). */
export type MerchantFields = {
  id: string;
  firstName: string;
  /** Cash in the purse, pence. */
  balance: number;
  holdings?: Holdings;
  /** Targets decided at a close, filled at the next. */
  pending?: { d: string; w: Weights; why: string };
  lastDecision?: string;
  strategy?: GuildStrategy;
  /** What it was staked, the market day it began, and the 60/40 index then (to judge it fairly). */
  track?: { start: number; startDay: string; bench: number; days: number };
  /** Cash plus holdings at the latest close, pence, and that close's day. */
  worth?: number;
  worthDay?: string;
};

// ── The strategies the guild teaches ────────────────────────────────────────

const preset = (id: string, g: Omit<MGenome, "id" | "gen">): MGenome => fixM({ id, gen: 0, ...g });

export const PRESETS: { id: string; label: string; about: string; genome: MGenome }[] = [
  { id: "sixty-forty", label: "Sixty-forty", about: "60% US shares, 40% government bonds, rebalanced monthly — the classic steady portfolio", genome: SIXTY_FORTY },
  { id: "us-shares", label: "US shares", about: "all in the S&P 500, held — the highest long-run return here, and the deepest falls", genome: US_STOCKS },
  { id: "trend", label: "Trend guard", about: "shares, property, gold and bonds, each held only while above its 200-day average, cash-like bonds otherwise", genome: CORE },
  {
    id: "world",
    label: "World spread",
    about: "US, UK and emerging shares, property, gold and bonds in equal shares, rebalanced quarterly",
    genome: preset("world", { mode: "hold", funds: ["SPY", "EWU", "EEM", "VNQ", "GLD", "IEF"], sma: 200, look: 126, top: 1, abs: 0, safe: "SHY", every: 63 }),
  },
  {
    id: "all-weather",
    label: "All-weather",
    about: "shares, long and medium bonds and gold in equal shares — built to ride out any season",
    genome: preset("all-weather", { mode: "hold", funds: ["SPY", "TLT", "IEF", "GLD"], sma: 200, look: 126, top: 1, abs: 0, safe: "SHY", every: 63 }),
  },
  {
    id: "momentum",
    label: "Momentum",
    about: "the two strongest funds over six months, each only if it beats cash — moves to where the money is going",
    genome: preset("momentum", { mode: "momentum", funds: ["SPY", "QQQ", "IWM", "EWU", "EEM", "VNQ", "GLD", "TLT"], sma: 200, look: 126, top: 2, abs: 1, safe: "SHY", every: 21 }),
  },
  {
    id: "dual-momentum",
    label: "Dual momentum",
    about: "the strongest of US, UK and emerging shares over a year, or cash-like bonds when none beats them",
    genome: preset("dual-momentum", { mode: "momentum", funds: ["SPY", "EWU", "EEM"], sma: 200, look: 252, top: 1, abs: 1, safe: "IEF", every: 21 }),
  },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/** Each temperament's natural strategy. */
export const TEMPER_PRESET: Record<Temper, string> = {
  cautious: "sixty-forty",
  steady: "world",
  trend: "trend",
  bold: "momentum",
  contrarian: "all-weather",
};

export function presetStrategy(id: string, note?: string): GuildStrategy {
  const p = PRESET_BY_ID.get(id) ?? PRESETS[0]!;
  return { genome: p.genome, preset: p.id, ...(note ? { note } : {}) };
}

/** A strategy's name for people: the preset's label, or the lab genome's id. */
export function strategyLabel(s: GuildStrategy | undefined): string {
  if (!s) return "no strategy";
  if (s.preset) return PRESET_BY_ID.get(s.preset)?.label ?? s.preset;
  return s.book ? `guild strategy ${s.book}` : "its own strategy";
}

/**
 * A newcomer's strategy: a slightly adjusted copy of the guild's best
 * proven lab strategy when there is one (so each newcomer explores near what
 * works), else its temperament's preset.
 */
export function strategyForNewcomer(temper: Temper, book: MEntry[], r: () => number): GuildStrategy {
  const best = book.find((e) => e.proven);
  if (best) return { genome: mutateM(r, best), book: best.id, note: "Trained in the guild's best proven strategy." };
  return presetStrategy(TEMPER_PRESET[temper]);
}

// ── Valuing and trading ─────────────────────────────────────────────────────

export function worthOf(s: Pick<MerchantFields, "balance" | "holdings">, price: (f: FundId) => number): number {
  let v = s.balance;
  for (const [f, u] of Object.entries(s.holdings ?? {}) as [FundId, number][]) v += u * (price(f) || 0);
  return Math.round(v);
}

/**
 * Fill target weights at today's close: sells first, then buys (scaled down
 * if the cash can't cover them and their costs). Differences under BAND are
 * left alone unless a fund is to be sold out entirely.
 */
export function fillTargets(
  s: Pick<MerchantFields, "balance" | "holdings">,
  want: Weights,
  price: (f: FundId) => number,
  cost = COST_PER_TRADE,
): { balance: number; holdings: Holdings; fills: { fund: FundId; value: number; cost: number }[] } {
  const holdings: Holdings = { ...(s.holdings ?? {}) };
  let cash = s.balance;
  const v = worthOf(s, price);
  const fills: { fund: FundId; value: number; cost: number }[] = [];
  if (!(v > 0)) return { balance: cash, holdings, fills };
  const deltas: { fund: FundId; value: number }[] = [];
  for (const f of new Set([...Object.keys(holdings), ...Object.keys(want)]) as Set<FundId>) {
    const p = price(f);
    if (!(p > 0)) continue;
    const now = ((holdings[f] ?? 0) * p) / v;
    const target = want[f] ?? 0;
    if (target > 0 && Math.abs(target - now) < BAND) continue;
    // Selling out: every unit; otherwise to the target, in whole pence.
    const value = target === 0 ? -Math.round((holdings[f] ?? 0) * p) : Math.round((target - now) * v);
    if (value) deltas.push({ fund: f, value });
  }
  for (const d of deltas.filter((x) => x.value < 0)) {
    const p = price(d.fund);
    const c = Math.round(-d.value * cost);
    const units = (holdings[d.fund] ?? 0) + d.value / p;
    if (units > 1e-9) holdings[d.fund] = units;
    else delete holdings[d.fund];
    cash += -d.value - c;
    fills.push({ fund: d.fund, value: d.value, cost: c });
  }
  const buys = deltas.filter((x) => x.value > 0);
  const need = buys.reduce((n, x) => n + x.value * (1 + cost), 0);
  const scale = need > cash ? Math.max(0, cash / need) : 1;
  for (const d of buys) {
    // Never more than the cash left, costs included (rounding can't overdraw the purse).
    const value = Math.min(Math.floor(d.value * scale), Math.floor((cash - 1) / (1 + cost)));
    if (value <= 0) continue;
    const c = Math.round(value * cost);
    holdings[d.fund] = (holdings[d.fund] ?? 0) + value / price(d.fund);
    cash -= value + c;
    fills.push({ fund: d.fund, value, cost: c });
  }
  return { balance: cash, holdings, fills };
}

/** One market day for one merchant (see the top of this file). */
export function stepMerchant<T extends MerchantFields>(s: T, g: Daily, i: number, now: number): { next: T; trades: FundTrade[] } {
  const d = g.days[i]!;
  const price = (f: FundId) => g.px[f]?.[i] ?? 0;
  if (s.worthDay && s.worthDay >= d) return { next: s, trades: [] };
  let next: T = { ...s };
  const trades: FundTrade[] = [];
  if (next.pending) {
    const out = fillTargets(next, next.pending.w, price);
    for (const f of out.fills) trades.push({ t: now, d, id: s.id, name: s.firstName, fund: f.fund, value: f.value, cost: f.cost, why: next.pending.why });
    next = { ...next, balance: out.balance, holdings: out.holdings, pending: undefined };
  }
  const worth = worthOf(next, price);
  next = { ...next, worth, worthDay: d, track: next.track ? { ...next.track, days: next.track.days + 1 } : next.track };
  const genome = next.strategy?.genome;
  if (genome) {
    const since = next.lastDecision ? g.days.indexOf(next.lastDecision) : -1;
    if (since < 0 || i - since >= genome.every) {
      const w = targetWeights(g, genome, i);
      if (w) next = { ...next, pending: { d, w, why: strategyLabel(next.strategy) }, lastDecision: d };
    }
  }
  return { next, trades };
}

/** Sell holdings pro rata at `price` until the purse holds `amount` in cash (or everything is sold). */
export function raiseCash<T extends MerchantFields>(s: T, amount: number, price: (f: FundId) => number): { next: T; fills: { fund: FundId; value: number; cost: number }[] } {
  if (s.balance >= amount) return { next: s, fills: [] };
  const v = worthOf(s, price);
  const invested = v - s.balance;
  if (!(invested > 0)) return { next: s, fills: [] };
  const short = amount - s.balance;
  const share = Math.min(1, (short * (1 + COST_PER_TRADE)) / invested);
  // BAND doesn't apply here: this must sell exactly.
  const fills: { fund: FundId; value: number; cost: number }[] = [];
  const holdings: Holdings = { ...(s.holdings ?? {}) };
  let cash = s.balance;
  for (const [f, u] of Object.entries(holdings) as [FundId, number][]) {
    const p = price(f);
    if (!(p > 0)) continue;
    const sellUnits = share >= 1 ? u : u * share;
    const value = Math.round(sellUnits * p);
    const c = Math.round(value * COST_PER_TRADE);
    const left = u - sellUnits;
    if (left > 1e-9) holdings[f] = left;
    else delete holdings[f];
    cash += value - c;
    fills.push({ fund: f, value: -value, cost: c });
  }
  return { next: { ...s, balance: cash, holdings }, fills };
}

// ── Judging a merchant ──────────────────────────────────────────────────────

/** A merchant's return since it began, and the same for the 60/40 over the same days. */
export function performance(s: Pick<MerchantFields, "worth" | "balance" | "track">, benchNow: number): { ret: number; bench: number; ahead: number } | null {
  const t = s.track;
  if (!t || !(t.start > 0) || !(t.bench > 0)) return null;
  const ret = (s.worth ?? s.balance) / t.start - 1;
  const bench = benchNow / t.bench - 1;
  return { ret, bench, ahead: ret - bench };
}

/** A purse whose worth falls below this share of its stake is ruined, and goes to the gallows. */
export const RUIN_SHARE = 0.5;

/** The guild's dues: a share of each merchant's gain over a season, paid to the treasury (ISAs pay no tax, but the guild has its dues). */
export const DUES_DEFAULT = 0.1;

/** Levels of the 60/40 and US-shares indexes (100 at the start of the guild), moved on by one day's closes. */
export function stepIndexes(prev: { sf: number; us: number } | undefined, g: Daily, i: number): { sf: number; us: number } {
  const base = prev ?? { sf: 100, us: 100 };
  if (i < 1) return base;
  const r = (f: FundId) => {
    const a = g.px[f]?.[i - 1];
    const b = g.px[f]?.[i];
    return a && b && a > 0 ? b / a - 1 : 0;
  };
  return {
    sf: Math.round(base.sf * (1 + 0.6 * r("SPY") + 0.4 * r("IEF")) * 10_000) / 10_000,
    us: Math.round(base.us * (1 + r("SPY")) * 10_000) / 10_000,
  };
}

/**
 * A merchant well behind the 60/40 after many market days is retrained:
 * the guild's best proven lab strategy if it isn't on it already, else the
 * trend guard, else the 60/40 itself. Null when it should keep its course.
 */
export function retrain(s: MerchantFields, bench: number, book: MEntry[]): { strategy: GuildStrategy; why: string } | null {
  const p = performance(s, bench);
  const days = s.track?.days ?? 0;
  if (!p || days < 60 || p.ahead > -0.05) return null;
  const why = `${(p.ahead * -100).toFixed(1)} points behind the 60/40 over ${days} market days`;
  const best = book.find((e) => e.proven);
  if (best && s.strategy?.book !== best.id) return { strategy: { genome: fixM(best), book: best.id, note: "Retrained by the guild." }, why };
  const next = s.strategy?.preset === "trend" ? "sixty-forty" : "trend";
  if (s.strategy?.preset === next) return null;
  return { strategy: presetStrategy(next, "Retrained by the guild."), why };
}

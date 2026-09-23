/**
 * Trading and the day's dues — pure, so they are easy to test.
 *
 * A villager holds one position: LONG / SHORT / FLAT on one asset, with part
 * of the purse (`size`) at risk. At every review the position is marked to
 * market (P&L from `entryUsd` to the new price) and re-entered at the new
 * price. At dawn the King taxes the day's *profit* only, upkeep is paid, and
 * anyone left below the floor hangs.
 */
import { SIZE_DEFAULT, SIZE_MIN, SIZE_WEAK_MAX, WEAK_PURSE_SHARE } from "./constants.ts";
import { ASSETS, type Asset, type Side } from "./dawn.ts";

export type Order = { side: Side; asset: Asset; size: number; note: string };
export type PriceSample = { t: number } & Record<Asset, number>;

/** P&L of a position from `entryUsd` to `nowUsd`. A position can lose at most what it put at risk. */
export function markToMarket(p: { balance: number; side?: Side; size?: number; entryUsd?: number; nowUsd: number }): number {
  if (!p.side || p.side === "flat" || p.balance <= 0) return 0;
  if (!(p.entryUsd && p.entryUsd > 0) || !(p.nowUsd > 0)) return 0;
  const atRisk = p.balance * clampSize(p.size);
  const move = (p.nowUsd - p.entryUsd) / p.entryUsd;
  const pnl = atRisk * move * (p.side === "long" ? 1 : -1);
  return Math.round(Math.max(pnl, -atRisk));
}

export function clampSize(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SIZE_DEFAULT;
  const frac = n > 1 ? n / 100 : n; // 40 or 0.4
  return Math.round(Math.min(1, Math.max(SIZE_MIN, frac)) * 100) / 100;
}

/** Weak purses may not bet big, whatever the order says. */
export function capSizeForPurse(size: number, balance: number, stake: number): number {
  return stake > 0 && balance < stake * WEAK_PURSE_SHARE ? Math.min(size, SIZE_WEAK_MAX) : size;
}

/** The day's dues: tax on today's profit (nothing on a losing day), then upkeep; below the floor hangs. */
export function settleDay(p: { balance: number; dayStart: number; taxRate: number; rent: number; floor: number }): {
  profit: number;
  tithe: number;
  rentPaid: number;
  balance: number;
  hanged: boolean;
} {
  let balance = Math.max(0, p.balance);
  const profit = balance - p.dayStart;
  const rate = Math.min(1, Math.max(0, p.taxRate));
  const tithe = Math.floor(Math.max(0, profit) * rate);
  balance -= tithe;
  const rentPaid = Math.min(Math.max(0, p.rent), balance);
  balance -= rentPaid;
  return { profit, tithe, rentPaid, balance, hanged: balance < p.floor };
}

/** % change of an asset across the kept history (oldest sample → now), or null if unknown. */
export function trendPct(history: PriceSample[], asset: Asset, nowUsd: number): number | null {
  const first = history.find((h) => h[asset] > 0);
  if (!first || !(nowUsd > 0)) return null;
  return ((nowUsd - first[asset]) / first[asset]) * 100;
}

/**
 * The King's fallback when no AI answers: follow the strongest clear trend
 * (over the kept history, else the 24h change) with a modest size; sit out
 * when nothing moves more than 1%.
 */
export function momentumOrder(
  assets: Record<Asset, { usd: number; change24h: number }>,
  history: PriceSample[],
): Order {
  let best: { asset: Asset; pct: number } | null = null;
  for (const a of ASSETS) {
    if (!(assets[a].usd > 0)) continue;
    const pct = trendPct(history, a, assets[a].usd) ?? assets[a].change24h;
    if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { asset: a, pct };
  }
  if (!best || Math.abs(best.pct) < 1) {
    return { side: "flat", asset: best?.asset ?? "BTC", size: SIZE_MIN, note: "The markets drift without purpose; sit this one out." };
  }
  const side: Side = best.pct > 0 ? "long" : "short";
  return {
    side,
    asset: best.asset,
    size: 0.3,
    note: `${best.asset} ${best.pct > 0 ? "climbs" : "falls"} ${Math.abs(best.pct).toFixed(1)}% — ride it ${side}, but modestly.`,
  };
}

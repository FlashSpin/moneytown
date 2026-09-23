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
import type { Asset, Side } from "./dawn.ts";

export type Order = { side: Side; asset: Asset; size: number; note: string };
/** One price snapshot per review. Older saves stored BTC/ETH/SOL as top-level fields. */
export type PriceSample = { t: number; prices?: Record<Asset, number>; BTC?: number; ETH?: number; SOL?: number };

export function samplePrice(h: PriceSample, asset: Asset): number {
  const legacy = (h as Record<string, unknown>)[asset];
  return h.prices?.[asset] ?? (typeof legacy === "number" ? legacy : 0);
}

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

/** History shorter than this says nothing a 24h change doesn't say better. */
export const TREND_MIN_SPAN_MS = 3 * 3_600_000;

/** % change of an asset across the kept history (oldest sample → now), or null if unknown or too short. */
export function trendPct(history: PriceSample[], asset: Asset, nowUsd: number, now = Date.now()): number | null {
  const first = history.find((h) => samplePrice(h, asset) > 0);
  if (!first || !(nowUsd > 0) || now - first.t < TREND_MIN_SPAN_MS) return null;
  const then = samplePrice(first, asset);
  return ((nowUsd - then) / then) * 100;
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
  for (const a of Object.keys(assets)) {
    if (!(assets[a]!.usd > 0)) continue;
    const pct = trendPct(history, a, assets[a]!.usd) ?? assets[a]!.change24h;
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

// ── Temperaments: each villager trades in its own way ───────────────────────

export type Temper = "trend" | "contrarian" | "cautious" | "bold" | "steady";
export const TEMPERS: Temper[] = ["trend", "contrarian", "cautious", "bold", "steady"];

export const TEMPER_DESCRIPTIONS: Record<Temper, string> = {
  trend: "a trend-follower who rides whatever is moving",
  contrarian: "a contrarian who bets against moves that look overdone",
  cautious: "a cautious trader who risks little and sits out doubtful markets",
  bold: "a bold trader who backs strong convictions with bigger stakes",
  steady: "a steady trader who holds positions and dislikes needless changes",
};

/** A stable temperament for villagers born before temperaments existed. */
export function temperOf(id: string): Temper {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEMPERS[h % TEMPERS.length]!;
}

/**
 * How a villager acts on advice when no AI speaks for it: the advice (the
 * King's, or the momentum rule's) filtered through its own temperament.
 */
export function temperDecide(
  temper: Temper,
  advice: Order,
  current: { side?: Side; asset?: Asset; size?: number },
): Order & { followsKing: boolean } {
  switch (temper) {
    case "contrarian":
      // Takes the other side of a strong call, but small.
      if (advice.side !== "flat" && advice.size >= 0.3) {
        return {
          side: advice.side === "long" ? "short" : "long",
          asset: advice.asset,
          size: SIZE_MIN * 2,
          note: `Everyone crowds this ${advice.asset} trade; I'll take the other side, lightly.`,
          followsKing: false,
        };
      }
      return { ...advice, followsKing: true };
    case "cautious":
      return {
        ...advice,
        size: Math.max(SIZE_MIN, Math.round((advice.size / 2) * 100) / 100),
        note: advice.side === "flat" ? advice.note : `I'll follow, but with half the stake.`,
        followsKing: true,
      };
    case "bold":
      return {
        ...advice,
        size: Math.min(0.6, Math.round(advice.size * 1.5 * 100) / 100),
        note: advice.side === "flat" ? advice.note : `A fine call — I'll back it harder.`,
        followsKing: true,
      };
    case "steady":
      // Keeps an open position unless the advice says to reverse it.
      if (current.side && current.side !== "flat" && current.asset && !(advice.asset === current.asset && advice.side !== current.side && advice.side !== "flat")) {
        return {
          side: current.side,
          asset: current.asset,
          size: current.size ?? SIZE_DEFAULT,
          note: "I hold my course; no reason to change it yet.",
          followsKing: advice.side === current.side && advice.asset === current.asset,
        };
      }
      return { ...advice, followsKing: true };
    case "trend":
    default:
      return { ...advice, followsKing: true };
  }
}

export function recordTrade(
  record: { wins: number; losses: number; pnl: number } | undefined,
  pnl: number,
): { wins: number; losses: number; pnl: number } {
  const r = record ?? { wins: 0, losses: 0, pnl: 0 };
  if (!pnl) return r;
  return { wins: r.wins + (pnl > 0 ? 1 : 0), losses: r.losses + (pnl < 0 ? 1 : 0), pnl: r.pnl + pnl };
}

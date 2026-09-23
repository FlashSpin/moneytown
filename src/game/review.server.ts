/**
 * The King's trading review — server-only. Shared by the dawn tick and the
 * reviews every few hours (/api/review):
 *   1. mark every open position to the live price (P&L into the purse),
 *   2. ask the King's council for each villager's next order (or fall back
 *      to the momentum rule when no AI answers),
 *   3. apply the orders: new position, entry price, size capped for weak
 *      purses, and a walk to that asset's building.
 */
import { ASSET_POI, LIVING_CAP, POI, PRICE_HISTORY } from "./constants";
import { heuristicTalks } from "./brains";
import { kingCouncil, type Council } from "./llm.server";
import { wanderPoint } from "./town";
import { capSizeForPurse, markToMarket, momentumOrder, type Order, type PriceSample } from "./trading";
import type { GameState, SpeechLine, Subject, Tape } from "./types";
import { formatGbp, satsToGbp, stakeSats, tapeGbp } from "./wallets";

export function isLiving(s: Subject): boolean {
  return s.state !== "condemned" && s.state !== "hanging";
}

/** Realise every open position's P&L at the new prices and re-enter it there. */
export function markParish(subjects: Subject[], tape: Tape): Subject[] {
  return subjects.map((s) => {
    if (!isLiving(s) || !s.side || s.side === "flat" || !s.asset) return s;
    const nowUsd = tape.dark ? 0 : tape.assets[s.asset].usd;
    const pnl = markToMarket({ balance: s.balance, side: s.side, size: s.size, entryUsd: s.entryUsd, nowUsd });
    return {
      ...s,
      balance: s.balance + pnl,
      lastPnl: pnl,
      entryUsd: nowUsd > 0 ? nowUsd : s.entryUsd,
    };
  });
}

export function appendHistory(history: PriceSample[] | undefined, tape: Tape, now: number): PriceSample[] {
  if (tape.dark) return history ?? [];
  const sample: PriceSample = { t: now, BTC: tape.assets.BTC.usd, ETH: tape.assets.ETH.usd, SOL: tape.assets.SOL.usd };
  return [...(history ?? []), sample].slice(-PRICE_HISTORY);
}

export type Review = {
  subjects: Subject[];
  council: Council | null;
  /** One-line summary for the chronicle. */
  summary: string;
  speech: SpeechLine[];
};

/**
 * Ask the King for orders and apply them to already-marked villagers. When the
 * AI answers but skips someone, their position is left alone (no churn); when
 * no AI answers at all, everyone gets the momentum rule's order.
 */
export async function councilAndOrders(
  state: GameState,
  marked: Subject[],
  tape: Tape,
  opts: { dawn: boolean; rng: () => number; history: PriceSample[] },
): Promise<Review> {
  const living = marked.filter(isLiving);
  const council = living.length
    ? await kingCouncil({
        day: state.day,
        dawn: opts.dawn,
        kingBalance: state.king.balance,
        taxRate: state.taxRate,
        favorAsset: state.king.favorAsset ?? "BTC",
        favorFixed: state.decree?.favorAsset !== undefined,
        taxFixed: state.decree?.taxRate !== undefined,
        tape,
        history: opts.history,
        souls: living.map((s) => ({
          id: s.id,
          firstName: s.firstName,
          balance: s.balance,
          dayStart: s.dayStart ?? s.balance,
          side: s.side,
          asset: s.asset,
          size: s.size,
          openPnl: s.lastPnl,
        })),
      })
    : null;

  const fallback = momentumOrder(tape.assets, opts.history);
  const stake = stakeSats(tape);
  const counts = new Map<string, number>();
  const subjects = marked.map((s) => {
    if (!isLiving(s)) return s;
    const order: Order | null = council ? (council.orders.get(s.id) ?? null) : fallback;
    if (!order) return s;
    const side = tape.dark ? "flat" : order.side;
    const size = capSizeForPurse(order.size, s.balance, stake);
    const label = side === "flat" ? "flat" : `${side} ${order.asset}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    const changed = side !== s.side || order.asset !== s.asset || size !== s.size;
    const dest = side !== "flat" ? POI[ASSET_POI[order.asset]] : wanderPoint(opts.rng);
    return {
      ...s,
      side,
      asset: order.asset,
      size,
      entryUsd: side !== "flat" ? tape.assets[order.asset].usd : undefined,
      advice: order.note || s.advice,
      ...(changed
        ? {
            destX: dest.x + (opts.rng() - 0.5) * 40,
            destY: dest.y + (opts.rng() - 0.5) * 28,
            state: "walk" as const,
          }
        : {}),
    };
  });

  const plan = [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ");
  const summary = council
    ? `The King reviews the parish's trades (${council.brain.label}): ${plan || "no souls to command"}.`
    : `No agent answered; the King follows the strongest trend: ${plan || "no souls to command"}.`;

  const kingSay = council?.say || fallback.note;
  const speech = council?.talks.length
    ? council.talks
    : heuristicTalks(
        opts.rng,
        kingSay,
        subjects.filter(isLiving).map((x) => ({ id: x.id, firstName: x.firstName, say: "" })),
      );
  return { subjects, council, summary, speech };
}

/** Human summary of the parish's wealth for the chronicle. */
export function wealthLine(subjects: Subject[], tape: Tape): string {
  const living = subjects.filter(isLiving);
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(tape)));
  const total = living.reduce((n, s) => n + s.balance, 0);
  const today = living.reduce((n, s) => n + (s.balance - (s.dayStart ?? s.balance)), 0);
  return `${living.length}/${LIVING_CAP} souls hold ${gbp(total)} (${today >= 0 ? "+" : "-"}${gbp(Math.abs(today))} today).`;
}


/**
 * The parish's trading review — server-only. Shared by the dawn tick and
 * the reviews every few hours (/api/review):
 *   1. mark every open position to the live price (P&L into the purse and
 *      each villager's track record),
 *   2. the King studies the markets and advises each villager,
 *   3. the villagers hold a council — debate the advice with each other and
 *      the King — and each decides its own trade,
 *   4. apply the decisions: new position, entry price, size capped for weak
 *      purses, and a walk to that asset's building.
 * With no AI, the momentum rule stands in for the King and each villager
 * applies its own temperament to his advice (src/game/trading.ts).
 */
import { ASSET_POI, LIVING_CAP, POI, PRICE_HISTORY } from "./constants";
import { heuristicTalks } from "./brains";
import { kingCouncil, parishCouncil, type Council, type CouncilSoul, type ParishCouncil } from "./llm.server";
import { wanderPoint } from "./town";
import {
  capSizeForPurse,
  markToMarket,
  momentumOrder,
  recordTrade,
  temperDecide,
  temperOf,
  type Order,
  type PriceSample,
} from "./trading";
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
      record: recordTrade(s.record, pnl),
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
  parish: ParishCouncil | null;
  /** One-line summary for the chronicle. */
  summary: string;
  speech: SpeechLine[];
  /** For the council transcript shown in the sidebar. */
  record: NonNullable<GameState["council"]>;
};

function soulFor(s: Subject): CouncilSoul {
  return {
    id: s.id,
    firstName: s.firstName,
    balance: s.balance,
    dayStart: s.dayStart ?? s.balance,
    side: s.side,
    asset: s.asset,
    size: s.size,
    openPnl: s.lastPnl,
    temper: s.temper ?? temperOf(s.id),
    plan: s.plan,
    record: s.record,
  };
}

/**
 * The King advises, the villagers debate and decide, and the decisions are
 * applied to already-marked villagers. A villager the council doesn't decide
 * for (no council, or it was skipped) applies its own temperament to the
 * King's advice — or to the momentum rule's, when there was no King either.
 */
export async function councilAndOrders(
  state: GameState,
  marked: Subject[],
  tape: Tape,
  opts: { dawn: boolean; rng: () => number; history: PriceSample[]; now: number },
): Promise<Review> {
  const living = marked.filter(isLiving);
  const souls = living.map(soulFor);
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
        souls,
      })
    : null;

  const fallback = momentumOrder(tape.assets, opts.history);
  const kingPlan = council?.say || fallback.note;
  const adviceFor = (id: string): Order => council?.orders.get(id) ?? fallback;
  const advice = new Map(living.map((s) => [s.id, adviceFor(s.id)]));

  const parish = living.length
    ? await parishCouncil({ day: state.day, tape, history: opts.history, kingPlan, advice, souls })
    : null;

  const stake = stakeSats(tape);
  const counts = new Map<string, number>();
  let followers = 0;
  let ownWay = 0;
  const subjects = marked.map((s) => {
    if (!isLiving(s)) return s;
    const temper = s.temper ?? temperOf(s.id);
    const told = advice.get(s.id)!;
    // The villager's own decision: the council's, else its temperament applied to the advice.
    const decided =
      parish?.decisions.get(s.id) ?? temperDecide(temper, told, { side: s.side, asset: s.asset, size: s.size });
    const side = tape.dark ? "flat" : decided.side;
    const size = capSizeForPurse(decided.size, s.balance, stake);
    const label = side === "flat" ? "flat" : `${side} ${decided.asset}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (decided.followsKing) followers++;
    else ownWay++;
    const changed = side !== s.side || decided.asset !== s.asset || size !== s.size;
    const dest = side !== "flat" ? POI[ASSET_POI[decided.asset]] : wanderPoint(opts.rng);
    return {
      ...s,
      temper,
      side,
      asset: decided.asset,
      size,
      entryUsd: side !== "flat" ? tape.assets[decided.asset].usd : undefined,
      advice: told.note || s.advice,
      plan: decided.note || s.plan,
      followsKing: decided.followsKing,
      ...(changed
        ? {
            destX: dest.x + (opts.rng() - 0.5) * 40,
            destY: dest.y + (opts.rng() - 0.5) * 28,
            state: "walk" as const,
          }
        : {}),
    };
  });

  const plan = [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ") || "no souls to trade";
  const mind = parish?.brain.label ?? council?.brain.label;
  const minds = `${council ? "the King advises" : "no King's agent; the strongest trend stands in"}, ${
    parish ? "the villagers debate and decide" : "each villager follows its own temperament"
  }${mind ? ` (${mind})` : ""}`;
  const summary = `Parish council — ${minds}: ${followers} follow the King, ${ownWay} go their own way. ${plan}.`;

  const speech = parish?.talks.length
    ? parish.talks
    : heuristicTalks(
        opts.rng,
        kingPlan,
        // Only villagers with a view of their own speak it; nobody parrots the King.
        subjects
          .filter(isLiving)
          .map((x) => ({ id: x.id, firstName: x.firstName, say: x.plan && x.plan !== kingPlan ? x.plan : "" })),
      );
  const record = {
    at: opts.now,
    day: state.day,
    kingPlan,
    lines: speech.map((l) => ({ fromId: l.fromId, toId: l.toId, text: l.text })),
  };
  return { subjects, council, parish, summary, speech, record };
}

/** Human summary of the parish's wealth for the chronicle. */
export function wealthLine(subjects: Subject[], tape: Tape): string {
  const living = subjects.filter(isLiving);
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(tape)));
  const total = living.reduce((n, s) => n + s.balance, 0);
  const today = living.reduce((n, s) => n + (s.balance - (s.dayStart ?? s.balance)), 0);
  return `${living.length}/${LIVING_CAP} souls hold ${gbp(total)} (${today >= 0 ? "+" : "-"}${gbp(Math.abs(today))} today).`;
}


/**
 * The parish's strategy review — server-only. Shared by the dawn tick and the
 * reviews every few hours (/api/review):
 *   1. the King studies the markets and each villager's trading, and advises
 *      each one on its day-trading strategy,
 *   2. the villagers hold a council — debate with each other and the King —
 *      and each chooses and tunes its own strategy and writes down a lesson
 *      from its trades (src/game/knowledge.ts),
 *   3. the strategies are stored; the 5-minute trading tick
 *      (src/game/trade.server.ts) trades them.
 * With no AI, each villager keeps its current strategy (or its temperament's
 * default, src/game/strategies.ts).
 */
import { LIVING_CAP } from "./constants";
import { priceOf } from "./dawn";
import { heuristicTalks } from "./brains";
import { kingCouncil, parishCouncil, type Choice, type Council, type ParishCouncil } from "./llm.server";
import { addLesson } from "./knowledge";
import { STRATEGY_INFO, unrealized } from "./strategies";
import { isLiving, soulFor, strategyOf } from "./trade.server";
import { temperOf } from "./trading";
import type { GameState, SpeechLine, Subject, Tape } from "./types";
import { formatGbp, satsToGbp, tapeGbp } from "./wallets";

export { isLiving };

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

const currentStrategy = strategyOf;

/**
 * The King advises, the villagers debate and choose, and each villager's new
 * strategy is stored. A villager the council doesn't decide for takes the
 * King's advice if there is some, else keeps what it has.
 */
export async function councilStrategies(
  state: GameState,
  subjectsIn: Subject[],
  tape: Tape,
  opts: { dawn: boolean; rng: () => number; now: number },
): Promise<Review> {
  const living = subjectsIn.filter(isLiving);
  const souls = living.map((s) => soulFor(s, tape));
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
        ticks: state.ticks,
        souls,
        book: state.lab?.pool,
      })
    : null;

  const kingPlan =
    council?.say || "The King holds his counsel; let every soul trade by its own strategy and mind its stops.";
  const advice = new Map<string, Choice>(souls.map((s) => [s.id, council?.advice.get(s.id) ?? s.strategy]));

  const parish = living.length
    ? await parishCouncil({ day: state.day, tape, ticks: state.ticks, kingPlan, advice, souls, book: state.lab?.pool })
    : null;

  const counts = new Map<string, number>();
  let followers = 0;
  let ownWay = 0;
  let changed = 0;
  const subjects = subjectsIn.map((s) => {
    if (!isLiving(s)) return s;
    const was = currentStrategy(s, tape);
    const told = advice.get(s.id)!;
    const chosen = parish?.decisions.get(s.id) ?? { ...told, followsKing: Boolean(council) };
    const { followsKing, lesson, ...strategy } = chosen;
    // The villager's own lesson, else the one the King drew for it.
    const learned = lesson || council?.advice.get(s.id)?.lesson;
    if (council) {
      if (followsKing !== false) followers++;
      else ownWay++;
    }
    if (strategy.kind !== was.kind || strategy.coins.join() !== was.coins.join()) changed++;
    counts.set(strategy.kind, (counts.get(strategy.kind) ?? 0) + 1);
    return {
      ...s,
      temper: s.temper ?? temperOf(s.id),
      strategy,
      advice: told.note || s.advice,
      plan: strategy.note || s.plan,
      followsKing: council ? followsKing !== false : undefined,
      knowledge: learned ? addLesson(s.knowledge, learned) : s.knowledge,
    };
  });

  const mix = [...counts.entries()].map(([k, n]) => `${n} ${STRATEGY_INFO[k as keyof typeof STRATEGY_INFO].label.toLowerCase()}`).join(", ");
  const mind = parish?.brain.label ?? council?.brain.label;
  const who = council
    ? `the King advises, the villagers debate and choose${mind ? ` (${mind})` : ""}: ${followers} follow him, ${ownWay} go their own way`
    : "no agent answered; every soul keeps its strategy";
  const summary = `Strategy council — ${who}. ${changed} change strategy. The parish now runs: ${mix || "nothing"}.`;

  const speech = parish?.talks.length
    ? parish.talks
    : heuristicTalks(
        opts.rng,
        kingPlan,
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

/** Human summary of the parish's wealth for the chronicle: purses plus open trades at current prices. */
export function wealthLine(subjects: Subject[], tape: Tape): string {
  const living = subjects.filter(isLiving);
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(tape)));
  const open = living.reduce((n, s) => n + (s.position ? unrealized(s.position, priceOf(tape, s.position.coin)) : 0), 0);
  const total = living.reduce((n, s) => n + s.balance, 0) + open;
  const today = living.reduce((n, s) => n + (s.balance - (s.dayStart ?? s.balance)), 0);
  const trading = living.filter((s) => s.position).length;
  return `${living.length}/${LIVING_CAP} souls hold ${gbp(total)} (${today >= 0 ? "+" : "-"}${gbp(Math.abs(today))} banked today; ${trading} in a trade).`;
}

/**
 * The guild's strategy council — server-only, held at dawn every
 * COUNCIL_EVERY days (src/game/tick.server.ts):
 *   1. the King studies the market board and each merchant's ISA, and
 *      advises each one on its investing strategy,
 *   2. the merchants hold a council — debate with each other and the King —
 *      and each chooses its own strategy and writes down a lesson,
 *   3. the new strategies take effect at the next market day's decision.
 * With no AI, each merchant keeps its current strategy.
 */
import { COUNCIL_EVERY, LIVING_CAP } from "./constants";
import { heuristicTalks } from "./brains";
import { performance, presetStrategy, strategyLabel, TEMPER_PRESET, type GuildStrategy } from "./guild";
import { kingCouncil, parishCouncil, type Choice, type Council, type CouncilSoul, type ParishCouncil } from "./llm.server";
import { temperOf } from "./trading";
import type { GameState, SpeechLine, Subject } from "./types";
import { money } from "./wallets";

export { COUNCIL_EVERY };

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

export const isLiving = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";

/** A merchant's strategy, or its temperament's for one that has none. */
export function strategyOf(s: Subject): GuildStrategy {
  return s.strategy ?? presetStrategy(TEMPER_PRESET[s.temper ?? temperOf(s.id)]);
}

/** "SPY 40%, IEF 30%, cash 30%", from the latest close. */
export function holdingsLine(s: Subject, state: Pick<GameState, "board">): string {
  const worth = s.worth ?? s.balance;
  if (!(worth > 0)) return "";
  const parts = Object.entries(s.holdings ?? {}).map(([f, u]) => {
    const close = state.board?.funds[f as keyof NonNullable<GameState["board"]>["funds"]]?.close ?? 0;
    return { f, v: (u ?? 0) * close };
  });
  parts.push({ f: "cash", v: s.balance });
  return parts
    .filter((p) => p.v / worth >= 0.01)
    .sort((a, b) => b.v - a.v)
    .map((p) => `${p.f} ${Math.round((p.v / worth) * 100)}%`)
    .join(", ");
}

export function soulFor(s: Subject, state: Pick<GameState, "board" | "bench">): CouncilSoul {
  const p = performance(s, state.bench?.sf ?? 100);
  return {
    id: s.id,
    firstName: s.firstName,
    temper: s.temper ?? temperOf(s.id),
    worth: s.worth ?? s.balance,
    start: s.track?.start ?? s.balance,
    ret: p && (s.track?.days ?? 0) > 0 ? p.ret : null,
    bench: p && (s.track?.days ?? 0) > 0 ? p.bench : null,
    days: s.track?.days ?? 0,
    strategy: strategyOf(s),
    holdings: holdingsLine(s, state),
    lessons: s.lessons,
  };
}

const sameStrategy = (a: GuildStrategy, b: GuildStrategy) => JSON.stringify(a.genome) === JSON.stringify(b.genome);

/**
 * The King advises, the merchants debate and choose, and each merchant's
 * strategy is stored. A merchant the council doesn't decide for takes the
 * King's advice if there is some, else keeps what it has.
 */
export async function councilStrategies(state: GameState, subjectsIn: Subject[], opts: { dawn: boolean; rng: () => number; now: number }): Promise<Review> {
  const living = subjectsIn.filter(isLiving);
  const souls = living.map((s) => soulFor(s, state));
  const council = living.length
    ? await kingCouncil({
        day: state.day,
        dawn: opts.dawn,
        kingBalance: state.king.balance,
        taxRate: state.taxRate,
        favorAsset: state.king.favorAsset ?? "SPY",
        favorFixed: state.decree?.favorAsset !== undefined,
        taxFixed: state.decree?.taxRate !== undefined,
        board: state.board,
        souls,
        book: state.book,
      })
    : null;

  const kingPlan = council?.say || "The King holds his counsel; let every merchant keep its course, spread its money and trade seldom.";
  const advice = new Map<string, GuildStrategy & { note?: string }>(
    souls.map((s) => {
      const a = council?.advice.get(s.id);
      return [s.id, a ? { ...a.strategy, ...(a.note ? { note: a.note } : {}) } : s.strategy];
    }),
  );

  const parish = living.length ? await parishCouncil({ day: state.day, board: state.board, kingPlan, advice, souls, book: state.book }) : null;

  const counts = new Map<string, number>();
  let followers = 0;
  let ownWay = 0;
  let changed = 0;
  const subjects = subjectsIn.map((s) => {
    if (!isLiving(s)) return s;
    const was = strategyOf(s);
    const told = advice.get(s.id)!;
    const chosen: Choice = parish?.decisions.get(s.id) ?? { strategy: told, note: told.note, followsKing: Boolean(council) };
    const learned = chosen.lesson || council?.advice.get(s.id)?.lesson;
    if (council) {
      if (chosen.followsKing !== false) followers++;
      else ownWay++;
    }
    const strategy: GuildStrategy = { ...chosen.strategy, ...(chosen.note ? { note: chosen.note } : {}) };
    if (!sameStrategy(strategy, was)) changed++;
    const label = strategyLabel(strategy);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return {
      ...s,
      temper: s.temper ?? temperOf(s.id),
      strategy,
      advice: told.note || s.advice,
      plan: chosen.note || s.plan,
      followsKing: council ? chosen.followsKing !== false : undefined,
      lessons: learned ? [...(s.lessons ?? []), learned].slice(-5) : s.lessons,
    };
  });

  const mix = [...counts.entries()].map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ");
  const mind = parish?.brain.label ?? council?.brain.label;
  const who = council
    ? `the King advises, the merchants debate and choose${mind ? ` (${mind})` : ""}: ${followers} follow him, ${ownWay} go their own way`
    : "no agent answered; every merchant keeps its strategy";
  const summary = `Guild council — ${who}. ${changed} change strategy. The guild now runs: ${mix || "nothing"}.`;

  const speech = parish?.talks.length
    ? parish.talks
    : heuristicTalks(
        opts.rng,
        kingPlan,
        subjects.filter(isLiving).map((x) => ({ id: x.id, firstName: x.firstName, say: x.plan && x.plan !== kingPlan ? x.plan : "" })),
      );
  const record = { at: opts.now, day: state.day, kingPlan, lines: speech.map((l) => ({ fromId: l.fromId, toId: l.toId, text: l.text })) };
  return { subjects, council, parish, summary, speech, record };
}

/** The guild's wealth for the chronicle: every merchant's worth at the latest close. */
export function wealthLine(subjects: Subject[]): string {
  const living = subjects.filter(isLiving);
  const total = living.reduce((n, s) => n + (s.worth ?? s.balance), 0);
  const staked = living.reduce((n, s) => n + (s.track?.start ?? s.balance), 0);
  return `${living.length}/${LIVING_CAP} merchants hold ${money(total)} in their ISAs (staked ${money(staked)}).`;
}

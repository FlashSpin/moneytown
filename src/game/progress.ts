/**
 * The guild's objective and progress — pure, so it is easy to test.
 *
 * Seasons: every SEASON_DAYS days the guild is judged on one goal — did the
 * parish's wealth (the treasury plus every merchant's ISA at the latest
 * close) grow more than a plain 60/40 portfolio did over the same days? At the
 * end of each season each merchant pays the guild's dues on its gain.
 * Beating the market is hard and never guaranteed: the goal is a challenge,
 * and the guild can fail it.
 *
 * Milestones: firsts and landmarks along the way, each recorded once with
 * when it happened and why it matters.
 */
import { KING_START, LIVING_CAP } from "./constants.ts";
import { rankOf, type Rank } from "./ranks.ts";
import type { GameState, Subject } from "./types.ts";

export const SEASON_DAYS = 28;
export const SEASONS_KEPT = 12;

export type Season = { n: number; startDay: number; startAt: number; startWealth: number; startBench: number; hanged: number };
export type SeasonResult = Season & {
  endDay: number;
  endAt: number;
  endWealth: number;
  endBench: number;
  change: number;
  benchChange: number;
  won: boolean;
};
/** What the last dawn moved (pence), for the Chronicle and milestones. */
export type DawnBook = { day: number; dues: number; stakes: number; gallows: number };

const living = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";

/** The treasury plus every living merchant's worth at the latest close. */
export function parishWealth(state: Pick<GameState, "king" | "subjects">): number {
  let total = state.king.balance;
  for (const s of state.subjects) if (living(s)) total += s.worth ?? s.balance;
  return total;
}

export function startSeason(n: number, day: number, at: number, wealth: number, bench: number): Season {
  return { n, startDay: day, startAt: at, startWealth: wealth, startBench: bench, hanged: 0 };
}

/**
 * At dawn: open the first season, or close one that has run its days and
 * open the next. `bench` is the 60/40 index now. Returns the season now
 * running, a result if one closed, and lines for the Chronicle.
 */
export function advanceSeason(
  season: Season | undefined,
  input: { day: number; at: number; wealth: number; bench: number; hangedToday: number },
): { season: Season; result?: SeasonResult; notes: string[] } {
  const notes: string[] = [];
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  if (!season) {
    const s = startSeason(1, input.day, input.at, input.wealth, input.bench);
    notes.push(`Season 1 begins. The guild must grow its wealth more than a 60/40 of shares and bonds does over the next ${SEASON_DAYS} days.`);
    return { season: s, notes };
  }
  const current = { ...season, hanged: season.hanged + input.hangedToday };
  if (input.day - current.startDay < SEASON_DAYS) return { season: current, notes };
  const change = current.startWealth > 0 ? input.wealth / current.startWealth - 1 : 0;
  const benchChange = current.startBench > 0 ? input.bench / current.startBench - 1 : 0;
  const won = change > benchChange;
  const result: SeasonResult = { ...current, endDay: input.day, endAt: input.at, endWealth: input.wealth, endBench: input.bench, change, benchChange, won };
  notes.push(
    won
      ? `Season ${current.n} is WON: the guild grew ${pct(change)} against the 60/40's ${pct(benchChange)}.`
      : `Season ${current.n} is lost: the guild moved ${pct(change)} against the 60/40's ${pct(benchChange)}.`,
  );
  const next = startSeason(current.n + 1, input.day, input.at, input.wealth, input.bench);
  notes.push(`Season ${next.n} begins: beat the 60/40 over the next ${SEASON_DAYS} days.`);
  return { season: next, result, notes };
}

// ── Milestones ──────────────────────────────────────────────────────────────

type Ctx = { state: GameState; ranks: Set<Rank>; living: number; days: number };

export const MILESTONES: { id: string; title: string; why: string; test: (c: Ctx) => boolean }[] = [
  { id: "first-order", title: "The first order", why: "a merchant put money into the funds", test: (c) => (c.state.trades?.length ?? 0) > 0 },
  { id: "first-month", title: "A month in the market", why: "twenty market days invested — long enough for results to start meaning something", test: (c) => c.days >= 20 },
  { id: "ten-souls", title: "Ten merchants", why: "ten villagers investing at once", test: (c) => c.living >= 10 },
  { id: "full-parish", title: "A full guild", why: `every one of the ${LIVING_CAP} places taken`, test: (c) => c.living >= LIVING_CAP },
  { id: "journeyman", title: "The first Journeyman", why: "a merchant twenty market days in and not losing", test: (c) => c.ranks.has("journeyman") || c.ranks.has("merchant") || c.ranks.has("master") },
  { id: "merchant", title: "The first true Merchant", why: "sixty market days in and ahead of the 60/40", test: (c) => c.ranks.has("merchant") || c.ranks.has("master") },
  { id: "master", title: "The first Master", why: "120 market days in and 2 points ahead of the 60/40", test: (c) => c.ranks.has("master") },
  { id: "treasury-grown", title: "The treasury grown by half", why: "the crown holds half as much again as it began with", test: (c) => c.state.king.balance >= 1.5 * KING_START },
  { id: "season-won", title: "A season won", why: "the guild beat the 60/40 over a season", test: (c) => (c.state.seasons ?? []).some((s) => s.won) },
];

/** Milestones reached for the first time: recorded with the time and day, and lines for the Chronicle. */
export function checkMilestones(state: GameState, now: number): { milestones: NonNullable<GameState["milestones"]>; notes: string[] } {
  const have = { ...(state.milestones ?? {}) };
  const alive = state.subjects.filter(living);
  const bench = state.bench?.sf ?? 100;
  const ctx: Ctx = {
    state,
    ranks: new Set(alive.map((s) => rankOf(s, bench))),
    living: alive.length,
    days: Math.max(0, ...alive.map((s) => s.track?.days ?? 0)),
  };
  const notes: string[] = [];
  for (const m of MILESTONES) {
    if (have[m.id] || !m.test(ctx)) continue;
    have[m.id] = { at: now, day: state.day };
    notes.push(`Milestone — ${m.title}: ${m.why}.`);
  }
  return { milestones: have, notes };
}


/**
 * The parish's objective and progress — pure, so it is easy to test.
 *
 * Seasons: every SEASON_DAYS days the parish is judged on one goal — grow its
 * total wealth (the treasury plus every living purse, open trades at today's
 * price) by the season's goal. A season won raises the next goal a step (up
 * to GOAL_MAX); a season lost keeps it. Profit is never guaranteed: the goal
 * is a challenge, and the parish can fail it.
 *
 * Milestones: firsts and landmarks along the way, each recorded once with
 * when it happened and why it matters.
 */
import { KING_START, LIVING_CAP } from "./constants.ts";
import { rankOf, type Rank } from "./ranks.ts";
import { unrealized } from "./strategies.ts";
import type { GameState, Subject } from "./types.ts";

export const SEASON_DAYS = 7;
export const GOAL_START = 0.03;
export const GOAL_STEP = 0.01;
export const GOAL_MAX = 0.15;
export const SEASONS_KEPT = 12;

export type Season = { n: number; startDay: number; startAt: number; startWealth: number; goal: number; hanged: number };
export type SeasonResult = Season & { endDay: number; endAt: number; endWealth: number; change: number; won: boolean };
/** What the last dawn moved (sats), for the Chronicle and milestones. */
export type DawnBook = { day: number; banked: number; tax: number; upkeep: number; stakes: number; gallows: number };

const living = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";

/** The treasury plus every living purse, open trades marked at `priceOf`. */
export function parishWealth(state: Pick<GameState, "king" | "subjects">, priceOf: (coin: string) => number): number {
  let total = state.king.balance;
  for (const s of state.subjects) {
    if (!living(s)) continue;
    total += s.balance + (s.position ? unrealized(s.position, priceOf(s.position.coin) || s.position.entryUsd) : 0);
  }
  return total;
}

export function startSeason(n: number, day: number, at: number, wealth: number, goal: number): Season {
  return { n, startDay: day, startAt: at, startWealth: wealth, goal, hanged: 0 };
}

/**
 * At dawn: open the first season, or close one that has run its days and
 * open the next. Returns the season now running, a result if one closed, and
 * lines for the Chronicle.
 */
export function advanceSeason(
  season: Season | undefined,
  input: { day: number; at: number; wealth: number; hangedToday: number; money: (sats: number) => string },
): { season: Season; result?: SeasonResult; notes: string[] } {
  const notes: string[] = [];
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  if (!season) {
    const s = startSeason(1, input.day, input.at, input.wealth, GOAL_START);
    notes.push(`Season 1 begins. The parish must grow its wealth by ${pct(s.goal)} within ${SEASON_DAYS} days, from ${input.money(input.wealth)}.`);
    return { season: s, notes };
  }
  const current = { ...season, hanged: season.hanged + input.hangedToday };
  if (input.day - current.startDay < SEASON_DAYS) return { season: current, notes };
  const change = current.startWealth > 0 ? input.wealth / current.startWealth - 1 : 0;
  const won = change >= current.goal;
  const result: SeasonResult = { ...current, endDay: input.day, endAt: input.at, endWealth: input.wealth, change, won };
  notes.push(
    won
      ? `Season ${current.n} is WON: the parish grew ${pct(change)} against a goal of ${pct(current.goal)}${current.hanged ? `, though ${current.hanged} went to the gallows` : ", with no one hanged"}.`
      : `Season ${current.n} is lost: the parish moved ${pct(change)} against a goal of ${pct(current.goal)}${current.hanged ? `; ${current.hanged} went to the gallows` : ""}.`,
  );
  const goal = won ? Math.min(GOAL_MAX, current.goal + GOAL_STEP) : current.goal;
  const next = startSeason(current.n + 1, input.day, input.at, input.wealth, goal);
  notes.push(`Season ${next.n} begins: grow the parish's wealth by ${pct(goal)} within ${SEASON_DAYS} days.`);
  return { season: next, result, notes };
}

// ── Milestones ──────────────────────────────────────────────────────────────

type Ctx = { state: GameState; closed: number; ranks: Set<Rank>; living: number };

export const MILESTONES: { id: string; title: string; why: string; test: (c: Ctx) => boolean }[] = [
  { id: "first-trade", title: "The first trade", why: "a villager put money to work", test: (c) => (c.state.trades?.length ?? 0) > 0 },
  { id: "first-win", title: "The first win", why: "a trade closed in profit after every cost", test: (c) => c.state.subjects.some((s) => (s.record?.wins ?? 0) > 0) },
  { id: "profitable-day", title: "A profitable day", why: "the parish banked more than it lost in a day", test: (c) => (c.state.lastDawn?.banked ?? 0) > 0 },
  { id: "hundred-trades", title: "A hundred trades", why: "enough closed trades for the records to start meaning something", test: (c) => c.closed >= 100 },
  { id: "ten-souls", title: "Ten souls", why: "ten villagers trading at once", test: (c) => c.living >= 10 },
  { id: "full-parish", title: "A full parish", why: `every one of the ${LIVING_CAP} places taken`, test: (c) => c.living >= LIVING_CAP },
  { id: "journeyman", title: "The first Journeyman", why: "a villager with ten trades and nothing lost overall", test: (c) => c.ranks.has("journeyman") || c.ranks.has("merchant") || c.ranks.has("master") },
  { id: "merchant", title: "The first Merchant", why: "a villager thirty trades in and in profit", test: (c) => c.ranks.has("merchant") || c.ranks.has("master") },
  { id: "master", title: "The first Master", why: "seventy-five trades, in profit, winning at least half", test: (c) => c.ranks.has("master") },
  { id: "treasury-doubled", title: "The treasury doubled", why: "the crown holds twice what it began with", test: (c) => c.state.king.balance >= 2 * KING_START },
  { id: "season-won", title: "A season won", why: "the parish met its growth goal for a season", test: (c) => (c.state.seasons ?? []).some((s) => s.won) },
];

/** Milestones reached for the first time: recorded with the time and day, and lines for the Chronicle. */
export function checkMilestones(state: GameState, now: number): { milestones: NonNullable<GameState["milestones"]>; notes: string[] } {
  const have = { ...(state.milestones ?? {}) };
  const alive = state.subjects.filter(living);
  const ctx: Ctx = {
    state,
    closed: state.subjects.reduce((n, s) => n + (s.record ? s.record.wins + s.record.losses : 0), 0),
    ranks: new Set(alive.map((s) => rankOf(s.record))),
    living: alive.length,
  };
  const notes: string[] = [];
  for (const m of MILESTONES) {
    if (have[m.id] || !m.test(ctx)) continue;
    have[m.id] = { at: now, day: state.day };
    notes.push(`Milestone — ${m.title}: ${m.why}.`);
  }
  return { milestones: have, notes };
}


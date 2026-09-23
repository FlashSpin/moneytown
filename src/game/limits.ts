/**
 * Server-side risk limits — pure, so they are easy to test. Checked by the
 * trading tick (src/game/trade.server.ts) before any new trade opens, for
 * the strategies and the villagers' own calls alike; closing a trade is
 * never blocked, since that only reduces risk. A blocked trade doesn't open
 * at all (no smaller "partial" trade), and every block is counted by reason.
 *
 *   halt        the seal-bearer stopped trading, TRADING_HALT is set, or the
 *               ledger didn't reconcile — nothing new opens until resumed
 *   parish      the whole parish is down PARISH_DAILY_LOSS on the day — new
 *               trades pause until dawn
 *   daily loss  one villager is down VILLAGER_DAILY_LOSS on the day
 *   stale       the coin has had no real price within MAX_GAP_MS
 *   exposure    the parish would have more than COIN_EXPOSURE of its money on one coin
 */
import { priceFresh, type Ticks } from "./indicators.ts";
import { unrealized } from "./strategies.ts";
import type { GameState, Subject } from "./types.ts";

export const VILLAGER_DAILY_LOSS = 0.1;
export const PARISH_DAILY_LOSS = 0.08;
export const COIN_EXPOSURE = 0.25;

export type Gate = (coin: string, stake: number) => string | null;

const living = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";

/** Why nothing may open at all right now, if anything: a halt. */
export function haltReason(state: Pick<GameState, "halt">, env: string | undefined): string | null {
  if (env && env.trim() && env.trim() !== "0" && env.trim().toLowerCase() !== "off") return "trading halted by TRADING_HALT";
  return state.halt ? `trading halted: ${state.halt.reason}` : null;
}

export type RiskBook = {
  /** The gate for one villager. */
  gateFor: (s: Subject) => Gate;
  /** Record a trade that did open (for the exposure cap). */
  opened: (coin: string, stake: number) => void;
  /** Record a block. */
  block: (reason: string) => void;
  blocked: Record<string, number>;
  /** Set when the parish's daily loss paused new trades (until dawn). */
  pausedToday?: { day: number; reason: string };
};

/**
 * The risk checks for one trading tick. `priceOf` marks open trades to the
 * current price for equity.
 */
export function riskBook(input: {
  state: Pick<GameState, "subjects" | "halt" | "risk" | "day">;
  ticks: Ticks | undefined;
  now: number;
  priceOf: (coin: string) => number;
  env?: string;
}): RiskBook {
  const { state, ticks, now, priceOf } = input;
  const blocked: Record<string, number> = {};
  const block = (reason: string) => {
    blocked[reason] = (blocked[reason] ?? 0) + 1;
  };

  const souls = state.subjects.filter(living);
  const equityOf = (s: Subject) => s.balance + (s.position ? unrealized(s.position, priceOf(s.position.coin)) : 0);
  const parishEquity = souls.reduce((n, s) => n + equityOf(s), 0);
  const parishStart = souls.reduce((n, s) => n + (s.dayStart ?? s.balance), 0);

  const exposure = new Map<string, number>();
  for (const s of souls) if (s.position) exposure.set(s.position.coin, (exposure.get(s.position.coin) ?? 0) + s.position.stake);

  let pausedToday = state.risk?.pausedToday?.day === state.day ? state.risk.pausedToday : undefined;
  if (!pausedToday && parishStart > 0 && parishEquity < parishStart * (1 - PARISH_DAILY_LOSS)) {
    pausedToday = { day: state.day, reason: `the parish is down over ${Math.round(PARISH_DAILY_LOSS * 100)}% today` };
  }
  const halt = haltReason(state, input.env);
  const everyone = halt ?? (pausedToday ? `paused until dawn: ${pausedToday.reason}` : null);

  const gateFor =
    (s: Subject): Gate =>
    (coin, stake) => {
      if (everyone) return everyone;
      const start = s.dayStart ?? s.balance;
      if (start > 0 && equityOf(s) < start * (1 - VILLAGER_DAILY_LOSS)) return "daily loss limit";
      if (!priceFresh(ticks, coin, now)) return "stale price";
      const cap = parishEquity * COIN_EXPOSURE;
      if (stake > 0 && (exposure.get(coin) ?? 0) + stake > cap) return "exposure cap";
      return null;
    };

  return {
    gateFor,
    opened: (coin, stake) => exposure.set(coin, (exposure.get(coin) ?? 0) + stake),
    block,
    blocked,
    pausedToday,
  };
}

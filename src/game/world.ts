/**
 * Pure world-construction helpers — building a fresh world, a King, a
 * villager, and the log — shared by the client's placeholder state (before
 * the first fetch resolves) and the server's daily-tick logic.
 */
import { FALLBACK_TAPE, KING_START, MEN_NAMES, POI, STAKE_GBP, TAX_DEFAULT, WOMEN_NAMES } from "./constants";
import type { GameState, King, LogEntry, Subject } from "./types";
import { wanderPoint } from "./town";
import { fakeWallet, mulberry32, pick, sumExchequer, uid } from "./wallets";

export function withTotals<T extends { king: King; subjects: Subject[] }>(
  s: T,
): T & { exchequer: number } {
  return { ...s, exchequer: sumExchequer(s.king, s.subjects) };
}

export function makeKing(rng: () => number): King {
  return {
    name: "His Majesty",
    wallet: fakeWallet(rng),
    balance: KING_START,
    x: POI.kingStand.x,
    y: POI.kingStand.y,
    destX: POI.kingStand.x,
    destY: POI.kingStand.y,
    dir: "down",
    frame: 0,
    frameT: 0,
    lastAction: "hold",
    lastFlavor: "The King waits upon the parish. His treasury opens new souls while the parish trades.",
    favorAsset: "BTC",
  };
}

export function makeSubject(rng: () => number, taken: Set<string>, grant: number, bornDay = 0): Subject {
  const female = rng() > 0.5;
  const pool = female ? WOMEN_NAMES : MEN_NAMES;
  const available = pool.filter((n) => !taken.has(n));
  const firstName = available.length ? pick(available, rng) : pick(pool, rng);
  taken.add(firstName);
  const start = wanderPoint(rng);
  return {
    id: uid("s", rng),
    firstName,
    wallet: fakeWallet(rng),
    balance: grant,
    dayStart: grant,
    lastPnl: 0,
    lastAction: "idle",
    lastFlavor: `${firstName} is staked £${STAKE_GBP}. Linked to an agent — trade well, or the tax hangs you.`,
    body: female ? "woman" : "man",
    x: start.x,
    y: start.y,
    destX: start.x,
    destY: start.y,
    dir: "down",
    frame: 0,
    frameT: 0,
    state: "idle",
    hangT: 0,
    bornDay,
  };
}

export function pushLog(state: { day: number; log: LogEntry[] }, kind: LogEntry["kind"], text: string): LogEntry[] {
  const entry: LogEntry = { id: uid("l", Math.random), day: state.day, text, kind };
  return [entry, ...state.log].slice(0, 80);
}

export function freshWorld(seed = Date.now() % 1_000_000): GameState {
  const rng = mulberry32(seed);
  const king = makeKing(rng);
  return withTotals({
    day: 0,
    exchequer: 0,
    king,
    subjects: [],
    taxRate: TAX_DEFAULT,
    tape: { ...FALLBACK_TAPE },
    log: [
      {
        id: "l-open",
        day: 0,
        text: "The parish of Ledgerford is founded. The King's treasury will open souls and link them to trading agents.",
        kind: "system",
      },
    ],
    seed,
    brain: { kind: "heuristic", label: "Heuristic (period English)" },
    speech: [],
  });
}

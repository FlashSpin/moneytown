/**
 * Pure world-construction helpers — building a fresh world, a King, a
 * villager, and the log — shared by the client's placeholder state (before
 * the first fetch resolves) and the server's daily-tick logic.
 */
import { KING_START, MEN_NAMES, POI, STAKE_GBP, TAX_DEFAULT, WOMEN_NAMES } from "./constants.ts";
import { presetStrategy, TEMPER_PRESET } from "./guild.ts";
import { balancesOf, GENESIS, Journal, KING, refoundPostings, villagerAccount, type Posting } from "./ledger.ts";
import type { GameState, King, LogEntry, Subject } from "./types.ts";
import { wanderPoint } from "./town.ts";
import { TEMPERS } from "./trading.ts";
import { fakeWallet, mulberry32, pick, sumExchequer, uid } from "./wallets.ts";

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
    lastFlavor: "The King waits upon the guild. His treasury stakes new merchants while the guild invests.",
    favorAsset: "SPY",
  };
}

/**
 * A new merchant, staked `grant` pence in cash, with its temperament's
 * strategy (the caller may train it in another). `bench` is the 60/40 index
 * when it begins, so it is judged against the market from its own first day.
 */
export function makeSubject(rng: () => number, taken: Set<string>, grant: number, bornDay = 0, bench = 100): Subject {
  const female = rng() > 0.5;
  const pool = female ? WOMEN_NAMES : MEN_NAMES;
  const available = pool.filter((n) => !taken.has(n));
  const firstName = available.length ? pick(available, rng) : pick(pool, rng);
  taken.add(firstName);
  const start = wanderPoint(rng);
  const temper = pick(TEMPERS, rng);
  return {
    id: uid("s", rng),
    firstName,
    wallet: fakeWallet(rng),
    balance: grant,
    worth: grant,
    seasonStart: grant,
    track: { start: grant, startDay: "", bench, days: 0 },
    temper,
    strategy: presetStrategy(TEMPER_PRESET[temper]),
    lastPnl: 0,
    lastAction: "idle",
    lastFlavor: `${firstName} is staked £${STAKE_GBP.toLocaleString("en-GB")} for a stocks & shares ISA — the King advises, the guild debates, and each merchant chooses how to invest.`,
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
  const entry: LogEntry = { id: uid("l", Math.random), day: state.day, at: Date.now(), text, kind };
  return [entry, ...state.log].slice(0, 80);
}

export function freshWorld(seed = Date.now() % 1_000_000): GameState {
  const rng = mulberry32(seed);
  const king = makeKing(rng);
  return withTotals({
    era: "guild",
    day: 0,
    exchequer: 0,
    king,
    subjects: [],
    taxRate: TAX_DEFAULT,
    bench: { sf: 100, us: 100 },
    log: [
      {
        id: "l-open",
        day: 0,
        text: "The Merchant guild of Ledgerford is founded. The King's treasury will stake merchants, each with a stocks & shares ISA to invest.",
        kind: "system",
      },
    ],
    seed,
    brain: { kind: "heuristic", label: "Heuristic (period English)" },
    speech: [],
  });
}

/**
 * Turn a parish from the crypto era into the Merchant guild: the old books
 * are closed back to genesis, the treasury opens at KING_START, and every
 * living villager keeps its name, face and temperament but starts afresh as a
 * merchant staked `grant` pence, with its temperament's strategy.
 */
export function refoundWorld(prev: GameState, ledger: Map<string, number> | null, grant: number, now: number): GameState {
  const rng = mulberry32(prev.seed + 4049);
  // Close everything the old books hold, including postings not yet saved
  // (a world whose books open on this very load carries its genesis here).
  const old = new Map(ledger ?? []);
  for (const [k, v] of balancesOf(prev.postings ?? [])) old.set(k, (old.get(k) ?? 0) + v);
  const postings: Posting[] = refoundPostings(old, now, prev.day);
  const j = new Journal({ at: now, day: prev.day }, "guild");
  const king: King = { ...makeKing(rng), x: prev.king.x, y: prev.king.y, destX: prev.king.destX, destY: prev.king.destY, balance: KING_START };
  j.transfer(GENESIS, KING, KING_START, "genesis", { memo: "the guild's treasury at its founding" });
  const alive = prev.subjects.filter((s) => s.state !== "condemned" && s.state !== "hanging");
  const subjects: Subject[] = alive.map((old) => {
    const temper = old.temper ?? pick(TEMPERS, rng);
    j.transfer(GENESIS, villagerAccount(old.id), grant, "genesis", { memo: `${old.firstName}'s ISA stake at the guild's founding` });
    return {
      id: old.id,
      firstName: old.firstName,
      wallet: fakeWallet(rng),
      balance: grant,
      worth: grant,
      seasonStart: grant,
      track: { start: grant, startDay: "", bench: 100, days: 0 },
      temper,
      strategy: presetStrategy(TEMPER_PRESET[temper]),
      lastPnl: 0,
      lastAction: "idle",
      lastFlavor: `${old.firstName} leaves the coin stalls for the Merchant guild, staked £${(grant / 100).toLocaleString("en-GB")} for an ISA.`,
      body: old.body,
      x: old.x,
      y: old.y,
      destX: old.destX,
      destY: old.destY,
      dir: old.dir,
      frame: 0,
      frameT: 0,
      state: "idle",
      hangT: 0,
      bornDay: old.bornDay,
    };
  });
  const log = pushLog(
    { day: prev.day, log: prev.log },
    "system",
    `The parish turns from the coin stalls to the Merchant guild. The treasury opens with £${(KING_START / 100).toLocaleString("en-GB")}, and ${subjects.length} merchants are staked £${(grant / 100).toLocaleString("en-GB")} each for a stocks & shares ISA.`,
  );
  return withTotals({
    era: "guild",
    day: prev.day,
    exchequer: 0,
    king,
    subjects,
    taxRate: TAX_DEFAULT,
    bench: { sf: 100, us: 100 },
    log,
    seed: prev.seed,
    brain: prev.brain,
    speech: [],
    petitions: prev.petitions,
    ledger: { since: prev.ledger?.since ?? now },
    postings: [...(prev.postings ?? []), ...postings, ...j.postings],
    milestones: {},
  });
}

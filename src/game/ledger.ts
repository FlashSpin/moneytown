/**
 * The parish ledger — pure, so it is easy to test. Every movement of money is
 * a balanced set of double-entry postings: one account's loss is another's
 * gain, and every event's postings sum to zero. Postings are append-only
 * (stored in the `ledger_entries` table in the same statement that saves the
 * world, src/lib/world.server.ts), so every purse can be rebuilt from them
 * and checked against the world (`reconcile`).
 *
 * Accounts:
 *   king          the royal treasury
 *   v:<id>        a villager's purse
 *   market        the other side of every trade: purchases go to it, sales come from it
 *   fees          the cost of every trade (spread and currency fee)
 *   genesis       where the money that existed before the ledger began came from
 * Amounts are integer pence (before the guild was founded, sats: the
 * re-founding closed every sats balance back to genesis first).
 */
import type { FundTrade } from "./guild.ts";
import type { GameState, Subject } from "./types.ts";

export type PostingKind =
  | "genesis"
  | "refound"
  | "stake"
  | "fee"
  | "buy"
  | "sell"
  | "pnl"
  | "tax"
  | "upkeep"
  | "gallows"
  | "banish";

export type Posting = {
  /** The event this leg belongs to; (event, seq) is unique. */
  event: string;
  seq: number;
  /** ms since epoch. */
  at: number;
  day: number;
  account: string;
  /** Signed pence (sats before the guild): + credits the account, - debits it. */
  amount: number;
  kind: PostingKind;
  coin?: string;
  memo?: string;
};

export const KING = "king";
export const MARKET = "market";
export const FEES = "fees";
export const GENESIS = "genesis";
export const villagerAccount = (id: string) => `v:${id}`;

type Ctx = { at: number; day: number };

/** A builder that numbers events uniquely within one save. */
export class Journal {
  readonly postings: Posting[] = [];
  private n = 0;
  private readonly ctx: Ctx;
  private readonly prefix: string;
  constructor(ctx: Ctx, prefix: string) {
    this.ctx = ctx;
    this.prefix = prefix;
  }

  private event(kind: string): string {
    return `${this.prefix}:${this.ctx.at}:${kind}:${this.n++}`;
  }

  /** Move `amount` from one account to another (a negative amount moves it back). */
  transfer(from: string, to: string, amount: number, kind: PostingKind, extra: { coin?: string; memo?: string } = {}): void {
    const amt = Math.round(amount);
    if (!amt) return;
    const event = this.event(kind);
    const base = { event, at: this.ctx.at, day: this.ctx.day, kind, ...extra };
    this.postings.push({ ...base, seq: 0, account: from, amount: -amt }, { ...base, seq: 1, account: to, amount: amt });
  }

  /** The postings for one fill: the money to the market (or from it, on a sale), and its cost to the fees account. */
  trade(e: FundTrade): void {
    const v = villagerAccount(e.id);
    const memo = `${e.value >= 0 ? "bought" : "sold"} ${e.fund}`;
    if (e.value >= 0) this.transfer(v, MARKET, e.value, "buy", { coin: e.fund, memo });
    else this.transfer(MARKET, v, -e.value, "sell", { coin: e.fund, memo });
    this.transfer(v, FEES, e.cost, "fee", { coin: e.fund, memo });
  }
}

/** Opening balances for a world that existed before the ledger: from `genesis` to every purse. */
export function genesisPostings(state: Pick<GameState, "king" | "subjects" | "day">, at: number): Posting[] {
  const j = new Journal({ at, day: state.day }, "genesis");
  j.transfer(GENESIS, KING, state.king.balance, "genesis", { memo: "treasury when the ledger opened" });
  for (const s of state.subjects) j.transfer(GENESIS, villagerAccount(s.id), s.balance, "genesis", { memo: `${s.firstName}'s purse when the ledger opened` });
  return j.postings;
}

/**
 * Close the old books: every account's balance goes back to genesis (the
 * crypto era's sats), so the guild's books open from zero in pence.
 */
export function refoundPostings(ledger: Map<string, number>, at: number, day: number): Posting[] {
  const j = new Journal({ at, day }, "refound");
  for (const [account, balance] of [...ledger.entries()].sort()) {
    if (account === GENESIS || !balance) continue;
    j.transfer(account, GENESIS, balance, "refound", { memo: "the crypto era's books closed when the guild was founded" });
  }
  return j.postings;
}

/** Per-account balances from postings. */
export function balancesOf(postings: Iterable<Pick<Posting, "account" | "amount">>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of postings) out.set(p.account, (out.get(p.account) ?? 0) + p.amount);
  return out;
}

/** Every event's legs sum to zero. Returns the events that don't. */
export function unbalancedEvents(postings: Posting[]): string[] {
  const sums = new Map<string, number>();
  for (const p of postings) sums.set(p.event, (sums.get(p.event) ?? 0) + p.amount);
  return [...sums.entries()].filter(([, s]) => s !== 0).map(([e]) => e);
}

export type Reconciliation = {
  ok: boolean;
  /** Accounts whose ledger balance differs from the world's purse. */
  diffs: { account: string; ledger: number; world: number }[];
  /** Sum over every account — zero when the books balance. */
  total: number;
  checkedAt: number;
};

/**
 * Check the world against the ledger: the treasury and every purse on the
 * roll must equal its ledger balance, and a villager no longer on the roll
 * must have nothing left in the ledger.
 */
export function reconcile(ledger: Map<string, number>, state: Pick<GameState, "king" | "subjects">, now: number): Reconciliation {
  const world = new Map<string, number>([[KING, state.king.balance]]);
  for (const s of state.subjects as Subject[]) world.set(villagerAccount(s.id), s.balance);
  const diffs: Reconciliation["diffs"] = [];
  const accounts = new Set([...world.keys(), ...[...ledger.keys()].filter((a) => a === KING || a.startsWith("v:"))]);
  for (const account of accounts) {
    const l = ledger.get(account) ?? 0;
    const w = world.get(account) ?? 0;
    if (l !== w) diffs.push({ account, ledger: l, world: w });
  }
  let total = 0;
  for (const v of ledger.values()) total += v;
  return { ok: diffs.length === 0 && total === 0, diffs, total, checkedAt: now };
}

/** The world with more postings to save alongside it. */
export function withPostings<T extends { postings?: Posting[] }>(state: T, more: Posting[]): T {
  return more.length ? { ...state, postings: [...(state.postings ?? []), ...more] } : state;
}

/**
 * Check the books before a tick: record the check on the world and, when the
 * ledger and the purses disagree, halt all new trading until the
 * seal-bearer has looked into it (a mismatch never clears itself).
 * `ledger` is null before the books have opened.
 */
export function withBookCheck<T extends Pick<GameState, "king" | "subjects" | "ledger" | "halt">>(state: T, ledger: Map<string, number> | null, now: number): T {
  if (!ledger || !state.ledger) return state;
  const check = reconcile(ledger, state, now);
  const next: T = { ...state, ledger: { ...state.ledger, check: { ...check, diffs: check.diffs.slice(0, 10) } } };
  if (!check.ok && !state.halt) {
    next.halt = { at: now, reason: "the ledger doesn't match the purses; no new orders until the books are checked", by: "ledger" };
  }
  return next;
}

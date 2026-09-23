import { balancesOf, genesisPostings, type Posting } from "@/game/ledger";
import type { GameState } from "@/game/types";
import { getSql } from "./db";

type Row = { day: number; state: GameState | string; updated_at: string; rev: number; ledger?: Record<string, number> | string | null };

export type WorldRow = { day: number; state: GameState; updated_at: string; rev: number };

function parseState(raw: GameState | string): GameState {
  return typeof raw === "string" ? (JSON.parse(raw) as GameState) : raw;
}

/**
 * A world saved before the ledger existed opens its books on first load: the
 * genesis postings ride along with the next save (and are rebuilt if that
 * save loses a race), so the ledger starts from the purses as they stood.
 */
function openBooks(state: GameState): GameState {
  if (state.ledger) return state;
  const now = Date.now();
  return { ...state, ledger: { since: now }, postings: [...genesisPostings(state, now), ...(state.postings ?? [])] };
}

/** The current shared world row — the single source of truth for every visitor and the cron tick. */
export async function loadWorldRow(): Promise<WorldRow> {
  const sql = await getSql();
  const rows = await sql<Row>`select day, state, updated_at, rev from world_state where id = 'default'`;
  const row = rows[0];
  if (!row) throw new Error("world_state has no 'default' row — did the migration run?");
  return { day: row.day, state: openBooks(parseState(row.state)), updated_at: row.updated_at, rev: Number(row.rev) };
}

/**
 * The world row and every account's ledger balance, read in one statement —
 * one consistent snapshot, so a save landing in between can't make them
 * disagree. `ledger` is null before the books have opened.
 */
export async function loadWorldAndLedger(): Promise<WorldRow & { ledger: Map<string, number> | null }> {
  const sql = await getSql();
  const rows = await sql<Row>`
    select w.day, w.state, w.updated_at, w.rev,
      (select jsonb_object_agg(account, total) from (
        select account, sum(amount)::bigint as total from ledger_entries group by account
      ) t) as ledger
    from world_state w where w.id = 'default'
  `;
  const row = rows[0];
  if (!row) throw new Error("world_state has no 'default' row — did the migration run?");
  const raw = typeof row.ledger === "string" ? (JSON.parse(row.ledger) as Record<string, number>) : row.ledger;
  const state = parseState(row.state);
  const ledger = state.ledger && raw ? new Map(Object.entries(raw).map(([k, v]) => [k, Number(v)])) : state.ledger ? new Map() : null;
  return { day: row.day, state: openBooks(state), updated_at: row.updated_at, rev: Number(row.rev), ledger };
}

/** Every posting, oldest first (for rebuilding purses and the audit trail). */
export async function loadPostings(limit = 5000): Promise<Posting[]> {
  const sql = await getSql();
  const rows = await sql<{ event: string; seq: number; at: string; day: number; account: string; amount: number; kind: Posting["kind"]; coin: string | null; memo: string | null }>`
    select event, seq, (extract(epoch from at) * 1000)::bigint as at, day, account, amount, kind, coin, memo
    from ledger_entries order by id desc limit ${limit}
  `;
  return rows.reverse().map((r) => ({ ...r, at: Number(r.at), amount: Number(r.amount), coin: r.coin ?? undefined, memo: r.memo ?? undefined }));
}

export { balancesOf };

/** Events whose legs don't sum to zero — there should never be any. */
export async function unbalancedLedgerEvents(): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ event: string }>`
    select event from ledger_entries group by event having sum(amount) <> 0 limit 20
  `;
  return rows.map((r) => r.event);
}

/** How many postings the ledger holds. */
export async function ledgerSize(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`select count(*)::int as n from ledger_entries`;
  return Number(rows[0]?.n ?? 0);
}

/** The world to store (postings go to the ledger, not into the world's JSON), and the postings. */
function split(state: GameState): { json: string; postings: string } {
  const { postings, ...world } = state;
  return { json: JSON.stringify(world), postings: JSON.stringify(postings ?? []) };
}

// The postings are inserted in the same statement as the world update, and
// only if that update matched — so the world and the ledger change together
// or not at all, and a lost race writes neither.
const INSERT_POSTINGS = `
  insert into ledger_entries (event, seq, at, day, account, amount, kind, coin, memo)
  select e.event, e.seq, to_timestamp(e.at / 1000.0), e.day, e.account, e.amount, e.kind, e.coin, e.memo
  from jsonb_to_recordset($POSTINGS::jsonb) as e(event text, seq int, at bigint, day int, account text, amount bigint, kind text, coin text, memo text)
  where exists (select 1 from w)
  returning 1`;

/**
 * The daily tick's save — a new day. Stamps updated_at (the tick's
 * once-a-day guard reads it) and lands only if nobody wrote since `rev` was
 * read and the row is still on the day before, so a day can never be
 * advanced twice. Returns false on a lost race.
 */
export async function saveNewDay(state: GameState, rev: number): Promise<boolean> {
  const sql = await getSql();
  const { json, postings } = split(state);
  const rows = await sql.query<{ saved: number }>(
    `with w as (
       update world_state set state = $1::jsonb, day = $2, updated_at = now(), rev = rev + 1
       where id = 'default' and rev = $3 and day = $4
       returning rev
     ), l as (${INSERT_POSTINGS.replace("$POSTINGS", "$5")})
     select count(*)::int as saved from w`,
    [json, state.day, rev, state.day - 1, postings],
  );
  return Number(rows[0]?.saved ?? 0) > 0;
}

/**
 * A mid-day save (a trade tick, a review, a petition). Only lands if nobody
 * else wrote since `rev` was read, and leaves updated_at alone so it never
 * delays the daily tick. Returns false on a lost race — the caller re-reads
 * and retries.
 */
export async function saveWorldIfUnchanged(state: GameState, rev: number): Promise<boolean> {
  const sql = await getSql();
  const { json, postings } = split(state);
  const rows = await sql.query<{ saved: number }>(
    `with w as (
       update world_state set state = $1::jsonb, rev = rev + 1
       where id = 'default' and rev = $2 and day = $3
       returning rev
     ), l as (${INSERT_POSTINGS.replace("$POSTINGS", "$4")})
     select count(*)::int as saved from w`,
    [json, rev, state.day, postings],
  );
  return Number(rows[0]?.saved ?? 0) > 0;
}

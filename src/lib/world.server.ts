import type { GameState } from "@/game/types";
import { getSql } from "./db";

type Row = { day: number; state: GameState | string; updated_at: string; rev: number };

export type WorldRow = { day: number; state: GameState; updated_at: string; rev: number };

/** The current shared world row — the single source of truth for every visitor and the cron tick. */
export async function loadWorldRow(): Promise<WorldRow> {
  const sql = await getSql();
  const rows = await sql<Row>`select day, state, updated_at, rev from world_state where id = 'default'`;
  const row = rows[0];
  if (!row) throw new Error("world_state has no 'default' row — did the migration run?");
  const state = typeof row.state === "string" ? (JSON.parse(row.state) as GameState) : row.state;
  return { day: row.day, state, updated_at: row.updated_at, rev: Number(row.rev) };
}

/** The daily tick's save — stamps updated_at, which the tick's once-a-day guard reads. */
export async function saveWorld(state: GameState): Promise<void> {
  const sql = await getSql();
  await sql`
    update world_state
    set state = ${JSON.stringify(state)}::jsonb, day = ${state.day}, updated_at = now(), rev = rev + 1
    where id = 'default'
  `;
}

/**
 * A mid-day save (a petition to the King). Only lands if nobody else wrote
 * since `rev` was read, and leaves updated_at alone so it never delays the
 * daily tick. Returns false on a lost race — the caller re-reads and retries.
 */
export async function saveWorldIfUnchanged(state: GameState, rev: number): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ rev: number }>`
    update world_state
    set state = ${JSON.stringify(state)}::jsonb, rev = rev + 1
    where id = 'default' and rev = ${rev} and day = ${state.day}
    returning rev
  `;
  return rows.length > 0;
}

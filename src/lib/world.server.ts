import type { GameState } from "@/game/types";
import { getSql } from "./db";

type Row = { day: number; state: GameState | string; updated_at: string };

/** The current shared world row — the single source of truth for every visitor and the cron tick. */
export async function loadWorldRow(): Promise<{ day: number; state: GameState; updated_at: string }> {
  const sql = await getSql();
  const rows = await sql<Row>`select day, state, updated_at from world_state where id = 'default'`;
  const row = rows[0];
  if (!row) throw new Error("world_state has no 'default' row — did the migration run?");
  const state = typeof row.state === "string" ? (JSON.parse(row.state) as GameState) : row.state;
  return { day: row.day, state, updated_at: row.updated_at };
}

export async function saveWorld(state: GameState): Promise<void> {
  const sql = await getSql();
  await sql`
    update world_state
    set state = ${JSON.stringify(state)}::jsonb, day = ${state.day}, updated_at = now()
    where id = 'default'
  `;
}

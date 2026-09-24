/**
 * The strategy lab's results — server-only. A lab run (scripts/strategy-lab.ts
 * on GitHub Actions) posts what it found; each run is kept in `lab_runs`,
 * and its genomes are folded into the guild book in the world
 * (src/game/lab.ts `mergePool`), where new villagers and the King's summons
 * draw on it and live results are added every trading tick.
 */
import { cleanEntry, mergePool, type PoolEntry, type Score } from "@/game/lab";
import { getSql } from "./db";
import { loadWorldRow, saveWorldIfUnchanged } from "./world.server";

export type LabRunSummary = {
  at: number;
  seed?: number;
  minutes?: number;
  data?: { coins: string[]; sources?: Record<string, string>; days5?: number; daysH?: number; bars?: Record<string, number> };
  niches?: { niche: string; evaluated: number; generations: number; curve: number[]; baseline: { train?: Score; val?: Score; test?: Score }; champion: string | null; proven: boolean }[];
};

export type LabRun = { id: number; createdAt: string; summary: LabRunSummary; found: PoolEntry[] };

const parse = <T,>(v: unknown) => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

/** Tidy a run posted by the lab: every genome is checked and its proof recomputed. */
export function cleanRun(body: unknown): { summary: LabRunSummary; found: PoolEntry[] } {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const at = typeof o.at === "number" && Number.isFinite(o.at) ? Math.min(o.at, Date.now()) : Date.now();
  const found = (Array.isArray(o.found) ? o.found : [])
    .slice(0, 120)
    .map(cleanEntry)
    .filter((e): e is PoolEntry => !!e)
    .map((e) => ({ ...e, at }));
  const niches = Array.isArray(o.niches) ? (o.niches as LabRunSummary["niches"])!.slice(0, 64) : [];
  const data = o.data && typeof o.data === "object" ? (o.data as LabRunSummary["data"]) : undefined;
  return {
    summary: { at, ...(typeof o.seed === "number" ? { seed: o.seed } : {}), ...(typeof o.minutes === "number" ? { minutes: o.minutes } : {}), ...(data ? { data } : {}), niches },
    found,
  };
}

/** Keep a run and fold it into the guild book (retrying if the world changes underneath). */
export async function saveLabRun(body: unknown): Promise<{ id: number; found: number; proven: number; book: number }> {
  const { summary, found } = cleanRun(body);
  if (JSON.stringify(summary).length > 400_000) throw new Error("run too large");
  const sql = await getSql();
  const rows = await sql.query<{ id: number }>(`insert into lab_runs (summary, found) values ($1::jsonb, $2::jsonb) returning id`, [
    JSON.stringify(summary),
    JSON.stringify(found),
  ]);
  const id = Number(rows[0]!.id);
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await loadWorldRow();
    const prev = row.state.lab;
    const pool = mergePool(prev?.pool ?? [], found, summary.at);
    const next = { ...row.state, lab: { at: summary.at, runs: (prev?.runs ?? 0) + 1, pool } };
    if (await saveWorldIfUnchanged(next, row.rev)) return { id, found: found.length, proven: found.filter((e) => e.proven).length, book: pool.length };
    await new Promise((r) => setTimeout(r, 300 + attempt * 400));
  }
  throw new Error("the world kept changing; the run is kept but not yet in the book");
}

export async function listLabRuns(limit = 20): Promise<{ id: number; createdAt: string; summary: LabRunSummary; found: number; proven: number }[]> {
  const sql = await getSql();
  const rows = await sql.query<{ id: number; created_at: string; summary: unknown; found: unknown }>(
    `select id, created_at, summary, found from lab_runs order by id desc limit $1`,
    [limit],
  );
  return rows.map((r) => {
    const found = parse<PoolEntry[]>(r.found) ?? [];
    return { id: Number(r.id), createdAt: new Date(r.created_at).toISOString(), summary: parse<LabRunSummary>(r.summary), found: found.length, proven: found.filter((e) => e.proven).length };
  });
}

export async function loadLabRun(id: number): Promise<LabRun | null> {
  const sql = await getSql();
  const rows = await sql.query<{ id: number; created_at: string; summary: unknown; found: unknown }>(`select id, created_at, summary, found from lab_runs where id = $1`, [id]);
  const r = rows[0];
  return r ? { id: Number(r.id), createdAt: new Date(r.created_at).toISOString(), summary: parse(r.summary), found: parse(r.found) } : null;
}

/**
 * Job runs — server-only. Every scheduled job goes through `recordRun`: it is
 * timed, logged as structured JSON with its request id, and stored in
 * `job_runs` (a failure to store never fails the job). `jobStats` summarises
 * the last day for the health check.
 */
import { getSql } from "./db";
import { log } from "./log.server";

export type JobKind = "trade" | "dawn" | "review" | "backtest";
export type Outcome = "ok" | "skipped" | "failed";

export async function recordRun<T>(
  kind: JobKind,
  ctx: { requestId: string; source: string },
  run: () => Promise<{ outcome: Outcome; summary?: Record<string, unknown>; result: T }>,
): Promise<T> {
  const started = Date.now();
  log("info", `${kind}.start`, { requestId: ctx.requestId, source: ctx.source });
  let outcome: Outcome = "failed";
  let summary: Record<string, unknown> | undefined;
  let error: string | undefined;
  try {
    const r = await run();
    outcome = r.outcome;
    summary = r.summary;
    return r.result;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const durationMs = Date.now() - started;
    log(outcome === "failed" ? "error" : "info", `${kind}.end`, { requestId: ctx.requestId, source: ctx.source, outcome, durationMs, error, ...summary });
    // Skips are frequent (a guard said "not yet") and say nothing; keep only real runs and failures.
    if (outcome !== "skipped") {
      await store(kind, ctx, started, durationMs, outcome, error, summary).catch((e: unknown) =>
        log("warn", "job_runs.store_failed", { requestId: ctx.requestId, error: e instanceof Error ? e.message : String(e) }),
      );
    }
  }
}

async function store(
  kind: JobKind,
  ctx: { requestId: string; source: string },
  started: number,
  durationMs: number,
  outcome: Outcome,
  error: string | undefined,
  summary: Record<string, unknown> | undefined,
): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into job_runs (kind, source, request_id, started_at, duration_ms, outcome, error, summary)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8::jsonb)`,
    [kind, ctx.source, ctx.requestId, started, durationMs, outcome, error?.slice(0, 500) ?? null, summary ? JSON.stringify(summary) : null],
  );
}

export type JobStats = Record<
  JobKind,
  { runs: number; failed: number; lastAt: number | null; lastOutcome: Outcome | null; lastError: string | null; p50Ms: number | null; p95Ms: number | null; bySource: Record<string, number> }
>;

/** The last `hours` of runs, per kind. */
export async function jobStats(hours = 24): Promise<JobStats> {
  const sql = await getSql();
  const rows = await sql.query<{ kind: JobKind; source: string; started: number; duration_ms: number; outcome: Outcome; error: string | null }>(
    `select kind, source, (extract(epoch from started_at) * 1000)::bigint as started, duration_ms, outcome, error
     from job_runs where started_at > now() - ($1 || ' hours')::interval order by started_at`,
    [String(hours)],
  );
  const kinds: JobKind[] = ["trade", "dawn", "review", "backtest"];
  const out = {} as JobStats;
  for (const k of kinds) {
    const mine = rows.filter((r) => r.kind === k);
    const d = mine.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
    const q = (p: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))]! : null);
    const last = mine[mine.length - 1];
    const bySource: Record<string, number> = {};
    for (const r of mine) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    out[k] = {
      runs: mine.length,
      failed: mine.filter((r) => r.outcome === "failed").length,
      lastAt: last ? Number(last.started) : null,
      lastOutcome: last?.outcome ?? null,
      lastError: mine.filter((r) => r.error).at(-1)?.error ?? null,
      p50Ms: q(0.5),
      p95Ms: q(0.95),
      bySource,
    };
  }
  return out;
}

/** Drop job history older than 30 days. */
export async function pruneJobRuns(): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from job_runs where started_at < now() - interval '30 days'`);
}

import { createFileRoute } from "@tanstack/react-router";

/**
 * Health check for uptime monitors and people: is the database up, are the
 * trading tick, the strategy review and the dawn running on time, do the
 * books reconcile, are there prices, and how have the jobs fared over the
 * last day (runs, failures, latency, what triggered them). 200 when healthy,
 * 503 when degraded or down — point a free uptime monitor at it to be
 * alerted. `?soft=1` always answers 200 (for dashboards).
 */
async function health(request: Request): Promise<Response> {
  const { getSql } = await import("@/lib/db");
  const { healthVerdict } = await import("@/lib/health");
  const now = Date.now();
  let dbOk = false;
  let dbMs: number | null = null;
  try {
    const sql = await getSql();
    const t0 = Date.now();
    await sql`select 1`;
    dbMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  let world: Record<string, unknown> = {};
  let jobs: unknown = null;
  let recentFailures = 0;
  let input = { lastMarketAt: null as number | null, lastDawnAt: null as number | null, halted: null as string | null, booksOk: null as boolean | null };
  if (dbOk) {
    const { loadWorldRow } = await import("@/lib/world.server");
    const { jobStats } = await import("@/lib/jobs.server");
    const row = await loadWorldRow();
    const s = row.state;
    input = {
      lastMarketAt: s.lastMarketAt ?? null,
      lastDawnAt: new Date(row.updated_at).getTime(),
      halted: s.halt?.reason ?? null,
      booksOk: s.ledger?.check ? s.ledger.check.ok : null,
    };
    world = {
      day: s.day,
      living: s.subjects.filter((x) => x.state !== "condemned" && x.state !== "hanging").length,
      era: s.era ?? "crypto (re-founded as the guild at the next dawn or market day)",
      lastMarketAt: input.lastMarketAt,
      lastMarketDay: s.lastMarketDay ?? null,
      lastDawnAt: input.lastDawnAt,
      books: input.booksOk === null ? "not checked yet" : input.booksOk ? "balanced" : "out of balance",
      halted: input.halted,
    };
    const stats = await jobStats(24).catch(() => null);
    const lastHour = await jobStats(1).catch(() => null);
    jobs = stats;
    recentFailures = lastHour ? Object.values(lastHour).reduce((n, k) => n + k.failed, 0) : 0;
  }
  const verdict = healthVerdict({ now, dbOk, recentFailures, ...input });
  const soft = new URL(request.url).searchParams.get("soft") === "1";
  return Response.json(
    { status: verdict.status, problems: verdict.problems, checkedAt: new Date(now).toISOString(), db: { ok: dbOk, ms: dbMs }, world, jobs },
    { status: soft || verdict.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) => health(request),
    },
  },
});

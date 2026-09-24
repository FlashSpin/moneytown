import { createFileRoute } from "@tanstack/react-router";

/**
 * The strategy lab. GET (public) returns the guild book — the genomes new
 * villagers are trained in, with their verdicts and live results — and the
 * recent lab runs (`?id=` for one run's findings). POST (behind CRON_SECRET)
 * is how a lab run (scripts/strategy-lab.ts, .github/workflows/strategy-lab.yml)
 * hands in what it found.
 */
async function read(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { listLabRuns, loadLabRun } = await import("@/lib/lab.server");
  const id = Number(url.searchParams.get("id"));
  if (id) {
    const run = await loadLabRun(id);
    return run ? Response.json(run) : Response.json({ error: "no such run" }, { status: 404 });
  }
  const { loadWorldRow } = await import("@/lib/world.server");
  const row = await loadWorldRow();
  const lab = row.state.lab;
  return Response.json({ at: lab?.at ?? null, runs: lab?.runs ?? 0, pool: lab?.pool ?? [], history: await listLabRuns(15) });
}

async function write(request: Request): Promise<Response> {
  const { bearerOk } = await import("@/lib/seal.server");
  if (!bearerOk(request)) return new Response("Unauthorized", { status: 401 });
  const text = await request.text();
  if (text.length > 2_000_000) return Response.json({ ok: false, error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "not JSON" }, { status: 400 });
  }
  const { saveLabRun } = await import("@/lib/lab.server");
  const { recordRun } = await import("@/lib/jobs.server");
  const { requestIdOf } = await import("@/lib/log.server");
  try {
    const saved = await recordRun("lab", { requestId: requestIdOf(request), source: "cron" }, async () => {
      const r = await saveLabRun(body);
      return { outcome: "ok", summary: r, result: r };
    });
    return Response.json({ ok: true, ...saved });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 422 });
  }
}

export const Route = createFileRoute("/api/lab")({
  server: {
    handlers: {
      GET: ({ request }) => read(request),
      POST: ({ request }) => write(request),
    },
  },
});

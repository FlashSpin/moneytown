import { createFileRoute } from "@tanstack/react-router";
import { REVIEW_MIN_HOURS } from "@/game/constants";

/**
 * The King's trading review between dawns: re-mark every position at the
 * live price and give each villager new orders. Called every few hours by
 * the GitHub Actions schedule in .github/workflows/king-review.yml with
 * `Authorization: Bearer <CRON_SECRET>` (the same secret as /api/tick).
 * `?force=1` (still behind the secret) skips the too-soon guard.
 */
async function review(request: Request): Promise<Response> {
  const { env } = await import("@/lib/env.server");
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { loadWorldRow, saveWorldIfUnchanged } = await import("@/lib/world.server");
  const { runReview } = await import("@/game/tick.server");
  const { recordRun } = await import("@/lib/jobs.server");
  const { requestIdOf } = await import("@/lib/log.server");
  const requestId = requestIdOf(request);
  const forced = new URL(request.url).searchParams.get("force") === "1";
  const source = request.headers.get("x-source") ?? "cron";

  const result = await recordRun<{ status: number; body: Record<string, unknown> }>("review", { requestId, source }, async () => {
    let row = await loadWorldRow();
    const hoursSince = (Date.now() - (row.state.lastReviewAt ?? 0)) / 3_600_000;
    if (hoursSince < REVIEW_MIN_HOURS && !forced) {
      return { outcome: "skipped", result: { status: 200, body: { ok: true, skipped: true, hoursSince: Math.round(hoursSince * 10) / 10 } } };
    }
    // A petition may land while the King deliberates; re-read and retry rather
    // than overwrite it. Each attempt re-marks from the fresh row, so nothing
    // is counted twice.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) row = await loadWorldRow();
      const next = await runReview(row.state);
      if (await saveWorldIfUnchanged(next, row.rev)) {
        const positions = next.subjects.filter((s) => s.position).length;
        return {
          outcome: "ok",
          summary: { brain: next.brain.label, attempts: attempt + 1 },
          result: { status: 200, body: { ok: true, day: next.day, brain: next.brain.label, positions, souls: next.subjects.length } },
        };
      }
    }
    throw new Error("world kept changing; try again");
  }).catch((e: unknown) => ({ status: 409, body: { ok: false, error: e instanceof Error ? e.message : "failed" } }));
  return Response.json({ ...result.body, requestId }, { status: result.status, headers: { "x-request-id": requestId } });
}

export const Route = createFileRoute("/api/review")({
  server: {
    handlers: {
      GET: ({ request }) => review(request),
      POST: ({ request }) => review(request),
    },
  },
});

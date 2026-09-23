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

  let row = await loadWorldRow();
  const forced = new URL(request.url).searchParams.get("force") === "1";
  const hoursSince = (Date.now() - (row.state.lastReviewAt ?? 0)) / 3_600_000;
  if (hoursSince < REVIEW_MIN_HOURS && !forced) {
    return Response.json({ ok: true, skipped: true, hoursSince: Math.round(hoursSince * 10) / 10 });
  }

  // A petition may land while the King deliberates; re-read and retry rather
  // than overwrite it. Each attempt re-marks from the fresh row, so nothing
  // is counted twice.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) row = await loadWorldRow();
    const next = await runReview(row.state);
    if (await saveWorldIfUnchanged(next, row.rev)) {
      const orders = next.subjects.filter((s) => s.side && s.side !== "flat").length;
      return Response.json({ ok: true, day: next.day, brain: next.brain.label, positions: orders, souls: next.subjects.length });
    }
  }
  return Response.json({ ok: false, error: "world kept changing; try again" }, { status: 409 });
}

export const Route = createFileRoute("/api/review")({
  server: {
    handlers: {
      GET: ({ request }) => review(request),
      POST: ({ request }) => review(request),
    },
  },
});

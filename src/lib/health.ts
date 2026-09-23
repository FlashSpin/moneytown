/**
 * The health verdict — pure, so it is easy to test. Given how stale each job
 * is and what the last checks said, decide ok / degraded / down and say why.
 */
export type HealthInput = {
  now: number;
  dbOk: boolean;
  lastTickAt: number | null;
  lastReviewAt: number | null;
  lastDawnAt: number | null;
  halted: string | null;
  booksOk: boolean | null;
  pricesDark: boolean;
  recentFailures: number;
};

export const LIMITS = {
  tickMs: 15 * 60_000,
  reviewMs: 6 * 3_600_000,
  dawnMs: 26 * 3_600_000,
};

export function healthVerdict(h: HealthInput): { status: "ok" | "degraded" | "down"; problems: string[] } {
  if (!h.dbOk) return { status: "down", problems: ["the database is unreachable"] };
  const problems: string[] = [];
  const late = (what: string, t: number | null, limit: number) => {
    if (!t) problems.push(`no ${what} yet`);
    else if (h.now - t > limit) problems.push(`no ${what} for ${Math.round((h.now - t) / 60_000)} min`);
  };
  late("trading tick", h.lastTickAt, LIMITS.tickMs);
  late("strategy review", h.lastReviewAt, LIMITS.reviewMs);
  late("dawn", h.lastDawnAt, LIMITS.dawnMs);
  if (h.halted) problems.push(`trading halted: ${h.halted}`);
  if (h.booksOk === false) problems.push("the books don't reconcile");
  if (h.pricesDark) problems.push("no market prices");
  if (h.recentFailures > 0) problems.push(`${h.recentFailures} failed job runs in the last hour`);
  return { status: problems.length ? "degraded" : "ok", problems };
}

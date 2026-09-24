/**
 * The health verdict — pure, so it is easy to test. Given how stale each job
 * is and what the last checks said, decide ok / degraded / down and say why.
 */
export type HealthInput = {
  now: number;
  dbOk: boolean;
  /** When the guild last stepped through a market day (the merchant workflow's post after each close). */
  lastMarketAt: number | null;
  lastDawnAt: number | null;
  halted: string | null;
  booksOk: boolean | null;
  recentFailures: number;
};

export const LIMITS = {
  /** Weekends and holidays: four days without a close is too many. */
  marketMs: 4 * 86_400_000,
  dawnMs: 26 * 3_600_000,
};

export function healthVerdict(h: HealthInput): { status: "ok" | "degraded" | "down"; problems: string[] } {
  if (!h.dbOk) return { status: "down", problems: ["the database is unreachable"] };
  const problems: string[] = [];
  const late = (what: string, t: number | null, limit: number) => {
    if (!t) problems.push(`no ${what} yet`);
    else if (h.now - t > limit) problems.push(`no ${what} for ${Math.round((h.now - t) / 3_600_000)} hours`);
  };
  late("market day", h.lastMarketAt, LIMITS.marketMs);
  late("dawn", h.lastDawnAt, LIMITS.dawnMs);
  if (h.halted) problems.push(`orders halted: ${h.halted}`);
  if (h.booksOk === false) problems.push("the books don't reconcile");
  if (h.recentFailures > 0) problems.push(`${h.recentFailures} failed job runs in the last hour`);
  return { status: problems.length ? "degraded" : "ok", problems };
}

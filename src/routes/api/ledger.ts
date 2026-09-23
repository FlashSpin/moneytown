import { createFileRoute } from "@tanstack/react-router";

/**
 * The parish's books, for anyone to audit: every account's balance rebuilt
 * from the append-only ledger, checked against the purses in the world
 * (src/game/ledger.ts), plus any event whose legs don't balance and the
 * latest postings. Read-only; purses are public in the town anyway.
 */
async function ledger(request: Request): Promise<Response> {
  const { loadWorldAndLedger, loadPostings, unbalancedLedgerEvents, ledgerSize } = await import("@/lib/world.server");
  const { reconcile } = await import("@/game/ledger");
  const row = await loadWorldAndLedger();
  if (!row.ledger) {
    return Response.json({ ok: true, opened: false, note: "The books open with the next save of the world." });
  }
  const limit = Math.min(500, Math.max(0, Number(new URL(request.url).searchParams.get("recent") ?? 50) || 0));
  const [unbalanced, size, recent] = await Promise.all([unbalancedLedgerEvents(), ledgerSize(), limit ? loadPostings(limit) : []]);
  const check = reconcile(row.ledger, row.state, Date.now());
  return Response.json({
    ok: check.ok && unbalanced.length === 0,
    opened: true,
    since: row.state.ledger?.since ?? null,
    postings: size,
    balances: Object.fromEntries([...row.ledger.entries()].sort()),
    reconciliation: check,
    unbalancedEvents: unbalanced,
    halted: row.state.halt ?? null,
    recent: recent.reverse(),
  });
}

export const Route = createFileRoute("/api/ledger")({
  server: {
    handlers: {
      GET: ({ request }) => ledger(request),
    },
  },
});

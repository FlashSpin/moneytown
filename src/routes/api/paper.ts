import { createFileRoute } from "@tanstack/react-router";

/**
 * The paper-trading report as JSON: every approach's live paper results,
 * how they compare with the latest backtest, the gates before any real
 * money, recent orders (filled and rejected) and strategy changes.
 * Read-only; the /paper page shows the same.
 */
export const Route = createFileRoute("/api/paper")({
  server: {
    handlers: {
      GET: async () => {
        const { paperReport } = await import("@/lib/paper.server");
        return Response.json(await paperReport(), { headers: { "cache-control": "no-store" } });
      },
    },
  },
});

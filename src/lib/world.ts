import { createServerFn } from "@tanstack/react-start";
import type { GameState } from "@/game/types";

/**
 * Read-only: the current shared world, as the browser needs it. The price
 * history behind the strategies (24h of every coin) stays on the server.
 */
export const getWorldState = createServerFn({ method: "POST" }).handler(async (): Promise<GameState> => {
  const { loadWorldRow } = await import("./world.server");
  const row = await loadWorldRow();
  return { ...row.state, ticks: undefined, postings: undefined };
});

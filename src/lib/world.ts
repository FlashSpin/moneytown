import { createServerFn } from "@tanstack/react-start";
import type { GameState } from "@/game/types";

/**
 * Read-only: the current shared world, as the browser needs it (a parish
 * still from the crypto era is shown as the guild it becomes at the next save).
 */
export const getWorldState = createServerFn({ method: "POST" }).handler(async (): Promise<GameState> => {
  const { loadGuildWorld } = await import("./world.server");
  const row = await loadGuildWorld();
  return { ...row.state, postings: undefined };
});

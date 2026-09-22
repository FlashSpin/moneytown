import { createServerFn } from "@tanstack/react-start";
import type { GameState } from "@/game/types";

/** Read-only: the current shared world. There is no mutating counterpart — only the daily cron writes. */
export const getWorldState = createServerFn({ method: "POST" }).handler(async (): Promise<GameState> => {
  const { loadWorldRow } = await import("./world.server");
  const row = await loadWorldRow();
  return row.state;
});

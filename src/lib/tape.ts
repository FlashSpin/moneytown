import { createServerFn } from "@tanstack/react-start";
import type { Tape } from "@/game/types";

export const fetchTape = createServerFn({ method: "POST" }).handler(async (): Promise<Tape> => {
  const { loadTape } = await import("./tape.server");
  return loadTape();
});

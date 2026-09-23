import { useGame } from "./store";
import type { Tape } from "./types";

/** The freshest prices the page has: the minute-by-minute feed, else the world's. */
export function useBestTape(): Tape {
  const world = useGame((s) => s.tape);
  const live = useGame((s) => s.liveTape);
  return live && !live.dark ? live : world;
}

export function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

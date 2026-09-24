import { createServerFn } from "@tanstack/react-start";
import type { PoolEntry } from "@/game/lab";
import type { LabRunSummary } from "./lab.server";

export type LabBook = {
  at: number | null;
  runs: number;
  pool: PoolEntry[];
  history: { id: number; createdAt: string; summary: LabRunSummary; found: number; proven: number }[];
  gbpPerSat: number;
};

/** The guild book and recent lab runs, for the /lab page (null if they can't be read). */
export const getLabBook = createServerFn({ method: "GET" }).handler(async (): Promise<LabBook | null> => {
  try {
    const { loadWorldRow } = await import("./world.server");
    const { listLabRuns } = await import("./lab.server");
    const { satsToGbp, tapeGbp } = await import("@/game/wallets");
    const row = await loadWorldRow();
    const lab = row.state.lab;
    return {
      at: lab?.at ?? null,
      runs: lab?.runs ?? 0,
      pool: lab?.pool ?? [],
      history: await listLabRuns(10),
      gbpPerSat: satsToGbp(1, tapeGbp(row.state.tape)),
    };
  } catch {
    return null;
  }
});

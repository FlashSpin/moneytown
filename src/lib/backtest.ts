import { createServerFn } from "@tanstack/react-start";
import type { BacktestRun } from "./backtest.server";

/** The latest saved backtest run, for the /backtest page (null before the first run). */
export const getLatestBacktest = createServerFn({ method: "GET" }).handler(async (): Promise<BacktestRun | null> => {
  const { loadBacktestRun } = await import("./backtest.server");
  return loadBacktestRun().catch(() => null);
});

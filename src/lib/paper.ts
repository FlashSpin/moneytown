import { createServerFn } from "@tanstack/react-start";
import type { PaperReport } from "./paper.server";

/** The paper-trading report for the /paper page (null if it can't be built yet). */
export const getPaperReport = createServerFn({ method: "GET" }).handler(async (): Promise<PaperReport | null> => {
  const { paperReport } = await import("./paper.server");
  return paperReport().catch(() => null);
});

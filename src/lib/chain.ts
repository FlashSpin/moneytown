import { createServerFn } from "@tanstack/react-start";

export type ChainBalance =
  | { ok: true; sats: number; source: string }
  | { ok: false; error: string };

export const fetchChainBalance = createServerFn({ method: "POST" })
  .validator((input: { address: string }) => input)
  .handler(async ({ data }): Promise<ChainBalance> => {
    const { loadChainBalance } = await import("./chain.server");
    return loadChainBalance(data.address);
  });

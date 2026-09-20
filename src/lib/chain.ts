import { createServerFn } from "@tanstack/react-start";

export type ChainBalance =
  { ok: true; sats: number; source: string } | { ok: false; error: string };

export const fetchChainBalance = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const address = (input as { address?: unknown } | null)?.address;
    if (typeof address !== "string" || address.length > 100) throw new Error("Bad request");
    return { address };
  })
  .handler(async ({ data }): Promise<ChainBalance> => {
    const { loadChainBalance } = await import("./chain.server");
    return loadChainBalance(data.address);
  });

import { createServerFn } from "@tanstack/react-start";
import type { MerchantState } from "./merchant.server";

/** The Merchant guild's paper ISA and latest lab verdict, for the /isa page (null if unreadable). */
export const getMerchant = createServerFn({ method: "GET" }).handler(async (): Promise<MerchantState | null> => {
  try {
    const { loadMerchant } = await import("./merchant.server");
    return await loadMerchant();
  } catch {
    return null;
  }
});

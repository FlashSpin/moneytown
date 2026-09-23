import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PETITION_MAX_CHARS } from "@/game/constants";
import type { PetitionResult } from "@/game/petition.server";

const PetitionInput = z.object({
  message: z.string().trim().min(1).max(PETITION_MAX_CHARS),
  history: z
    .array(z.object({ from: z.enum(["you", "king"]), text: z.string().max(600) }))
    .max(6)
    .default([]),
  /** The royal seal passphrase, if this visitor holds it. Checked server-side on every call. */
  seal: z.string().max(200).optional(),
});

// Best-effort per-visitor throttle (per warm serverless instance). It also
// slows guessing at the royal seal. The hard ceilings — petitions and summons
// per day — live in the shared world row.
const WINDOW_MS = 60_000;
const PER_WINDOW = 6;
const recent = new Map<string, number[]>();

function throttled(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.size > 5_000) recent.clear();
  if (hits.length >= PER_WINDOW) {
    recent.set(key, hits);
    return true;
  }
  hits.push(now);
  recent.set(key, hits);
  return false;
}

async function visitorKey(): Promise<string> {
  const { getRequestIP } = await import("@tanstack/react-start/server");
  return getRequestIP({ xForwardedFor: true }) ?? "unknown";
}

/** Speak to the King. He answers, and may act on the petition within the crown's rules. */
export const petitionTheKing = createServerFn({ method: "POST" })
  .validator((data: unknown) => PetitionInput.parse(data))
  .handler(async ({ data }): Promise<PetitionResult | { throttled: true }> => {
    const { holdsSeal } = await import("./seal.server");
    const sovereign = holdsSeal(data.seal);
    // The seal-bearer isn't throttled; everyone else (wrong-seal guesses included) is.
    if (!sovereign && throttled(await visitorKey())) return { throttled: true };
    const { petitionKing } = await import("@/game/petition.server");
    return petitionKing(data.message, data.history, sovereign);
  });

/** Check a royal seal passphrase without speaking to the King. */
export const presentSeal = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ seal: z.string().max(200) }).parse(data))
  .handler(async ({ data }): Promise<{ sovereign: boolean; throttled?: true }> => {
    if (throttled(await visitorKey())) return { sovereign: false, throttled: true };
    const { holdsSeal } = await import("./seal.server");
    return { sovereign: holdsSeal(data.seal) };
  });

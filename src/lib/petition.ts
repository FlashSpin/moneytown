import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PETITION_MAX_CHARS } from "@/game/constants";
import type { PetitionResult } from "@/game/petition.server";

const PetitionInput = z.object({
  message: z.string().trim().min(1).max(PETITION_MAX_CHARS),
  history: z
    .array(z.object({ from: z.enum(["you", "king"]), text: z.string().max(400) }))
    .max(6)
    .default([]),
});

// Best-effort per-visitor throttle (per warm serverless instance). The hard
// ceilings — petitions and summons per day — live in the shared world row.
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

/** Speak to the King. He answers, and may summon souls from his treasury within the crown's rules. */
export const petitionTheKing = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => PetitionInput.parse(data))
  .handler(async ({ data }): Promise<PetitionResult | { throttled: true }> => {
    const { getRequestIP } = await import("@tanstack/react-start/server");
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    if (throttled(ip)) return { throttled: true };
    const { petitionKing } = await import("@/game/petition.server");
    return petitionKing(data.message, data.history);
  });

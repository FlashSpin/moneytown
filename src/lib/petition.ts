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

/**
 * Check what a visitor offered as the seal: a signed token (checked, never
 * counted as a guess), or the passphrase (refused while this address or the
 * whole site is locked out; a wrong one is recorded). Nothing offered is
 * simply a commoner.
 */
async function checkSeal(offered: string | undefined): Promise<{ sovereign: boolean; locked?: string }> {
  if (!offered) return { sovereign: false };
  const { holdsSeal, holdsSealToken, looksLikeToken } = await import("./seal.server");
  if (looksLikeToken(offered)) return { sovereign: holdsSealToken(offered) };
  const { keyFor, lockedOut, recordFailure } = await import("./lockout.server");
  const key = keyFor(await visitorKey());
  const locked = await lockedOut(key);
  if (locked) return { sovereign: false, locked };
  const ok = holdsSeal(offered);
  if (!ok) await recordFailure(key);
  return { sovereign: ok };
}

/** Speak to the King. He answers, and may act on the petition within the crown's rules. */
export const petitionTheKing = createServerFn({ method: "POST" })
  .validator((data: unknown) => PetitionInput.parse(data))
  .handler(async ({ data }): Promise<PetitionResult | { throttled: true }> => {
    const { sovereign } = await checkSeal(data.seal);
    // The seal-bearer isn't throttled; everyone else (wrong-seal guesses included) is.
    if (!sovereign && throttled(await visitorKey())) return { throttled: true };
    const { petitionKing } = await import("@/game/petition.server");
    return petitionKing(data.message, data.history, sovereign);
  });

/**
 * Present the royal seal (the passphrase once, or a token from before).
 * Answers with a fresh signed token to keep instead of the passphrase.
 */
export const presentSeal = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ seal: z.string().max(200) }).parse(data))
  .handler(async ({ data }): Promise<{ sovereign: boolean; token?: string; throttled?: true; reason?: string }> => {
    if (throttled(await visitorKey())) return { sovereign: false, throttled: true };
    const res = await checkSeal(data.seal);
    if (res.locked) return { sovereign: false, throttled: true, reason: res.locked };
    if (!res.sovereign) return { sovereign: false };
    const { sealToken } = await import("./seal.server");
    return { sovereign: true, token: sealToken() ?? undefined };
  });

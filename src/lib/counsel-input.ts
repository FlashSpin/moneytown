export type CounselPrefer = "grok" | "pollinations" | "any";

export const MAX_PROMPT_CHARS = 6000;

/** Runtime validation: the server function is public, so never trust the shape or size of the input. */
export function parseCounselInput(input: unknown): { prompt: string; prefer: CounselPrefer } {
  if (!input || typeof input !== "object") throw new Error("Bad request");
  const { prompt, prefer } = input as { prompt?: unknown; prefer?: unknown };
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error("Bad request");
  }
  const p: CounselPrefer = prefer === "grok" || prefer === "pollinations" ? prefer : "any";
  return { prompt, prefer: p };
}

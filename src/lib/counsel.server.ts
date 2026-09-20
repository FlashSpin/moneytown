import { getRequest } from "@tanstack/react-start/server";
import type { CounselPrefer } from "./counsel";
import { takeToken } from "./rate-limit";

const LIMIT_PER_MIN = 20;

function clientKey(): string {
  const h = getRequest()?.headers;
  const fwd = h?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h?.get("x-real-ip") || "unknown";
}

/** Public entry point: rate limited per client so strangers cannot spend the XAI key. */
export async function askGrokCounselLimited(
  prompt: string,
  prefer: CounselPrefer = "any",
): Promise<Awaited<ReturnType<typeof askGrokCounsel>>> {
  if (!takeToken(`counsel:${clientKey()}`, LIMIT_PER_MIN, 60_000)) {
    return { ok: false, error: "Too many requests. Try again shortly." };
  }
  return askGrokCounsel(prompt, prefer);
}

export async function askGrokCounsel(
  prompt: string,
  prefer: CounselPrefer = "any",
): Promise<
  | {
      ok: true;
      text: string;
      source: "grok" | "pollinations";
    }
  | { ok: false; error: string }
> {
  if (prefer === "pollinations") {
    const poll = await tryPollinations(prompt);
    if (poll) return { ok: true, text: poll, source: "pollinations" };
    return { ok: false, error: "Free online wits did not answer" };
  }
  if (prefer === "grok") {
    const grok = await tryGrok(prompt);
    if (grok) return { ok: true, text: grok, source: "grok" };
    return { ok: false, error: "Grok did not answer" };
  }
  const grok = await tryGrok(prompt);
  if (grok) return { ok: true, text: grok, source: "grok" };
  const poll = await tryPollinations(prompt);
  if (poll) return { ok: true, text: poll, source: "pollinations" };
  return { ok: false, error: "AI is not available" };
}

async function tryGrok(prompt: string): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.75,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are the wits of a 16th-century English market town. Reply with JSON only. No markdown. No jobs. No keys.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function tryPollinations(prompt: string): Promise<string | null> {
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "JSON only. 16th-century English market town wits. No jobs. No keys.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

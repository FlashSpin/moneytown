/**
 * Grok, falling back to free Pollinations — both plain server-to-server HTTPS
 * calls. Called from the daily-tick cron path (src/game/llm.server.ts) and
 * from petitions to the King (src/lib/petition.ts), which is rate-limited
 * per visitor and capped per day there.
 */
export async function askGrokCounsel(prompt: string): Promise<
  | { ok: true; text: string; source: "grok" | "pollinations" }
  | { ok: false; error: string }
> {
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

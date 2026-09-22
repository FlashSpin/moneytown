import Anthropic from "@anthropic-ai/sdk";

/**
 * The town's AI cascade: Claude (when ANTHROPIC_API_KEY is set), then Grok
 * (when XAI_API_KEY is set), then free Pollinations — all server-to-server.
 * Called from the daily-tick cron path (src/game/llm.server.ts) and from
 * petitions to the King (src/lib/petition.ts), which is rate-limited per
 * visitor and capped per day there.
 */
export async function askCounsel(prompt: string): Promise<
  | { ok: true; text: string; source: "claude" | "grok" | "pollinations" }
  | { ok: false; error: string }
> {
  const claude = await tryClaude(prompt);
  if (claude) return { ok: true, text: claude, source: "claude" };
  const grok = await tryGrok(prompt);
  if (grok) return { ok: true, text: grok, source: "grok" };
  const poll = await tryPollinations(prompt);
  if (poll) return { ok: true, text: poll, source: "pollinations" };
  return { ok: false, error: "AI is not available" };
}

let claudeClient: Anthropic | null = null;

async function tryClaude(prompt: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  claudeClient ??= new Anthropic({ timeout: 40_000, maxRetries: 1 });
  try {
    const response = await claudeClient.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      // Short in-character replies and simple trading picks: low effort keeps
      // the King quick to answer without giving up the model's judgment.
      output_config: { effort: "low" },
      // On a policy decline, the API re-runs the request on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You are the wits of a 16th-century English market town. Reply with JSON only. No markdown. No jobs. No keys.",
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return text || null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("[counsel] ANTHROPIC_API_KEY was rejected — falling back.");
    } else if (error instanceof Anthropic.RateLimitError) {
      console.warn("[counsel] Claude rate-limited — falling back.");
    } else if (error instanceof Anthropic.APIError) {
      console.warn(`[counsel] Claude API error ${error.status} — falling back.`);
    } else {
      console.warn("[counsel] Claude unreachable — falling back.");
    }
    return null;
  }
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

import Anthropic from "@anthropic-ai/sdk";

export type CounselSource = "gemini" | "groq" | "claude" | "grok" | "pollinations";

const SYSTEM =
  "You are the wits of a 16th-century English market town. Reply with JSON only. No markdown. No jobs. No keys.";

/**
 * The town's AI cascade, free providers first so a paid key is only spent
 * once the free quota runs out: Gemini (GEMINI_API_KEY, free tier), Groq
 * (GROQ_API_KEY, free tier), Claude (ANTHROPIC_API_KEY), Grok (XAI_API_KEY),
 * then keyless Pollinations. Each step is skipped when its key is unset.
 * Called from the daily-tick cron path (src/game/llm.server.ts) and from
 * petitions to the King (src/lib/petition.ts), which is rate-limited per
 * visitor and capped per day there.
 */
export async function askCounsel(prompt: string): Promise<
  | { ok: true; text: string; source: CounselSource }
  | { ok: false; error: string }
> {
  const gemini = await tryGemini(prompt);
  if (gemini) return { ok: true, text: gemini, source: "gemini" };
  const groq = await tryGroq(prompt);
  if (groq) return { ok: true, text: groq, source: "groq" };
  const claude = await tryClaude(prompt);
  if (claude) return { ok: true, text: claude, source: "claude" };
  const grok = await tryGrok(prompt);
  if (grok) return { ok: true, text: grok, source: "grok" };
  const poll = await tryPollinations(prompt);
  if (poll) return { ok: true, text: poll, source: "pollinations" };
  return { ok: false, error: "AI is not available" };
}

function key(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/** Google Gemini, free tier via an AI Studio key. GEMINI_MODEL overrides the model. */
async function tryGemini(prompt: string): Promise<string | null> {
  const apiKey = key("GEMINI_API_KEY");
  if (!apiKey) return null;
  const model = key("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 2048, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) {
      // 429 = the free daily/minute quota is spent; the cascade moves on.
      console.warn(`[counsel] Gemini HTTP ${res.status} — falling back.`);
      return null;
    }
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    };
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return text || null;
  } catch {
    console.warn("[counsel] Gemini unreachable — falling back.");
    return null;
  }
}

/**
 * Groq, free tier. OpenAI-style endpoint; no response_format because Groq's
 * JSON modes are unreliable on gpt-oss — the callers' parsers are tolerant.
 * GROQ_MODEL overrides the model.
 */
async function tryGroq(prompt: string): Promise<string | null> {
  const apiKey = key("GROQ_API_KEY");
  if (!apiKey) return null;
  const model = key("GROQ_MODEL") ?? "openai/gpt-oss-120b";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        max_completion_tokens: 2048,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[counsel] Groq HTTP ${res.status} — falling back.`);
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    return text || null;
  } catch {
    console.warn("[counsel] Groq unreachable — falling back.");
    return null;
  }
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
      system: SYSTEM,
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

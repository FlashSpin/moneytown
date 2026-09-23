import Anthropic from "@anthropic-ai/sdk";

export type CounselSource = "gemini" | "groq" | "claude" | "grok" | "pollinations";

const SYSTEM =
  "You are the wits of a 16th-century English market town. Reply with JSON only. No markdown. No jobs. No keys.";

/**
 * The town's AI cascade, free providers first so a paid key is only spent
 * once the free quota runs out: Gemini (GEMINI_API_KEY, free tier), Groq
 * (GROQ_API_KEY, free tier), Claude (ANTHROPIC_API_KEY), Grok (XAI_API_KEY),
 * then keyless Pollinations. Each step is skipped when its key is unset.
 * Called from the councils and the trading desk (src/game/llm.server.ts) and from
 * petitions to the King (src/lib/petition.ts), which is rate-limited per
 * visitor and capped per day there.
 */
export async function askCounsel(
  prompt: string,
  opts: { freeOnly?: boolean } = {},
): Promise<{ ok: true; text: string; source: CounselSource } | { ok: false; error: string }> {
  const gemini = await tryGemini(prompt);
  if (gemini) return { ok: true, text: gemini, source: "gemini" };
  const groq = await tryGroq(prompt);
  if (groq) return { ok: true, text: groq, source: "groq" };
  // Frequent callers (the trading desk, every few minutes) never spend a paid key.
  if (opts.freeOnly) return { ok: false, error: "no free AI answered" };
  if (key("ANTHROPIC_API_KEY")) {
    const claude = await tryClaude(prompt);
    lastResult.set("claude", claude ? "ok" : "failed (see server log)");
    if (claude) return { ok: true, text: claude, source: "claude" };
  }
  if (key("XAI_API_KEY")) {
    const grok = await tryGrok(prompt);
    lastResult.set("grok", grok ? "ok" : "failed");
    if (grok) return { ok: true, text: grok, source: "grok" };
  }
  const poll = await tryPollinations(prompt);
  lastResult.set("pollinations", poll ? "ok" : "failed");
  if (poll) return { ok: true, text: poll, source: "pollinations" };
  return { ok: false, error: "AI is not available" };
}

function key(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/** What happened on each provider's latest attempt in this server instance — shown to the seal-bearer. */
export type ProviderReport = { provider: CounselSource; configured: boolean; last: string | null };
const lastResult = new Map<CounselSource, string>();

export function counselDiagnostics(): ProviderReport[] {
  const configured: Record<CounselSource, boolean> = {
    gemini: Boolean(key("GEMINI_API_KEY")),
    groq: Boolean(key("GROQ_API_KEY")),
    claude: Boolean(key("ANTHROPIC_API_KEY")),
    grok: Boolean(key("XAI_API_KEY")),
    pollinations: true,
  };
  return (Object.keys(configured) as CounselSource[]).map((provider) => ({
    provider,
    configured: configured[provider],
    last: lastResult.get(provider) ?? null,
  }));
}

/** A short, key-free description of a failed HTTP call, from the provider's own error message. */
async function describeFailure(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message ?? "");
  } catch {
    // Not JSON — the status alone will do.
  }
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 160);
  return `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
}

/** Whether a failed call is worth retrying on the provider's next model (not for a bad key or a bad request). */
export function tryNextModel(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

/** Tried in order when the one before is unknown to the API (404) — model names move fast. */
const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.6-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash-lite"];

/** Google Gemini, free tier via an AI Studio key. GEMINI_MODEL overrides the model. */
async function tryGemini(prompt: string): Promise<string | null> {
  const apiKey = key("GEMINI_API_KEY");
  if (!apiKey) return null;
  const override = key("GEMINI_MODEL");
  for (const model of override ? [override] : GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              // Gemini counts its thinking against this, so leave room for the reply too.
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
              // Gemini 3 models take a thinking level; keep it low for quick answers.
              ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
            },
          }),
          signal: AbortSignal.timeout(25_000),
        },
      );
      if (!res.ok) {
        // 404 = model unknown, 429 = that model's free quota is spent (quotas are per model),
        // 5xx = that model is overloaded → try the next one. A bad key (401/403) stops here.
        lastResult.set("gemini", `${model}: ${await describeFailure(res)}`);
        console.warn(`[counsel] Gemini ${lastResult.get("gemini")} — falling back.`);
        if (tryNextModel(res.status) && !override) continue;
        return null;
      }
      const body = (await res.json()) as {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        promptFeedback?: { blockReason?: string };
      };
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) {
        const why = body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason ?? "no candidates";
        lastResult.set("gemini", `${model}: empty reply (${why})`);
        return null;
      }
      lastResult.set("gemini", `${model}: ok`);
      return text;
    } catch (error) {
      const why = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "unreachable";
      lastResult.set("gemini", `${model}: ${why}`);
      console.warn(`[counsel] Gemini ${model} ${why} — falling back.`);
      if (!override) continue;
      return null;
    }
  }
  return null;
}

const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

/**
 * Groq, free tier. OpenAI-style endpoint; no response_format because Groq's
 * JSON modes are unreliable on gpt-oss — the callers' parsers are tolerant.
 * GROQ_MODEL overrides the model.
 */
async function tryGroq(prompt: string): Promise<string | null> {
  const apiKey = key("GROQ_API_KEY");
  if (!apiKey) return null;
  const override = key("GROQ_MODEL");
  for (const model of override ? [override] : GROQ_MODELS) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.8,
          max_completion_tokens: 4096,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        lastResult.set("groq", `${model}: ${await describeFailure(res)}`);
        console.warn(`[counsel] Groq ${lastResult.get("groq")} — falling back.`);
        if (tryNextModel(res.status) && !override) continue;
        return null;
      }
      const body = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        lastResult.set("groq", `${model}: empty reply (${body.choices?.[0]?.finish_reason ?? "no choices"})`);
        return null;
      }
      lastResult.set("groq", `${model}: ok`);
      return text;
    } catch (error) {
      const why = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "unreachable";
      lastResult.set("groq", `${model}: ${why}`);
      console.warn(`[counsel] Groq ${model} ${why} — falling back.`);
      return null;
    }
  }
  return null;
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

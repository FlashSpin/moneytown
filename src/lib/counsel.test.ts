import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { askCounsel, counselDiagnostics } from "./counsel.server.ts";

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
const KEYS = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL", "ANTHROPIC_API_KEY", "XAI_API_KEY"];
let calls: Call[] = [];

function mockFetch(route: (url: string) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return route(url);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const geminiReply = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] });
const groqReply = (text: string) => json({ choices: [{ message: { content: text } }] });

describe("the King's AI cascade", () => {
  beforeEach(() => {
    calls = [];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of KEYS) delete process.env[k];
  });

  it("asks Gemini first, with the free Flash-Lite model and JSON output", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    mockFetch(() => geminiReply('{"say":"Hark"}'));
    const res = await askCounsel("prompt");
    assert.deepEqual(res, { ok: true, text: '{"say":"Hark"}', source: "gemini" });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-lite:generateContent$/);
    assert.equal((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"], "g-key");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.contents[0].parts[0].text, "prompt");
  });

  it("falls back to Groq when every Gemini model's free quota is spent", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.GROQ_API_KEY = "q-key";
    mockFetch((url) => (url.includes("googleapis") ? json({ error: "quota" }, 429) : groqReply('{"say":"Aye"}')));
    const res = await askCounsel("prompt");
    assert.deepEqual(res, { ok: true, text: '{"say":"Aye"}', source: "groq" });
    assert.equal(calls.filter((c) => c.url.includes("googleapis")).length, 3, "each Gemini model has its own quota");
    const groq = calls[3]!;
    assert.equal(groq.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal((groq.init.headers as Record<string, string>).Authorization, "Bearer q-key");
    assert.equal(JSON.parse(String(groq.init.body)).model, "openai/gpt-oss-120b");
  });

  it("tries older Gemini models when a model name is unknown (404)", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    mockFetch((url) =>
      url.includes("gemini-3.1-flash-lite") ? json({ error: { message: "models/x is not found" } }, 404) : geminiReply('{"say":"Hark"}'),
    );
    const res = await askCounsel("prompt");
    assert.equal(res.ok && res.source, "gemini");
    assert.match(calls[1]!.url, /models\/gemini-2\.5-flash-lite:generateContent$/);
    // Gemini 2.5 takes no thinkingLevel; Gemini 3 does.
    assert.equal(JSON.parse(String(calls[0]!.init.body)).generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.equal(JSON.parse(String(calls[1]!.init.body)).generationConfig.thinkingConfig, undefined);
  });

  it("tries the next Gemini model when one is overloaded (503) or out of quota (429)", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    mockFetch((url) =>
      url.includes("gemini-3.1-flash-lite")
        ? json({ error: { message: "high demand" } }, 503)
        : url.includes("gemini-2.5-flash-lite")
          ? json({ error: { message: "quota" } }, 429)
          : geminiReply('{"say":"Hark"}'),
    );
    const res = await askCounsel("prompt");
    assert.equal(res.ok && res.source, "gemini");
    assert.equal(calls.length, 3);
    assert.match(calls[2]!.url, /models\/gemini-2\.5-flash:generateContent$/);
  });

  it("stops at a bad key rather than trying every model", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    mockFetch(() => json({ error: { message: "API key not valid" } }, 400));
    const res = await askCounsel("prompt", { freeOnly: true });
    assert.equal(res.ok, false);
    assert.equal(calls.filter((c) => c.url.includes("googleapis")).length, 1);
  });

  it("reports why each provider failed, without leaking keys", async () => {
    process.env.GEMINI_API_KEY = "g-secret-key";
    process.env.GROQ_API_KEY = "q-secret-key";
    mockFetch((url) =>
      url.includes("googleapis")
        ? json({ error: { message: "API key not valid. Please pass a valid API key." } }, 400)
        : url.includes("groq")
          ? json({ choices: [{ finish_reason: "length", message: { content: "" } }] })
          : json({}, 503),
    );
    const res = await askCounsel("prompt");
    assert.equal(res.ok, false);
    const report = Object.fromEntries(counselDiagnostics().map((r) => [r.provider, r]));
    assert.equal(report.gemini!.last, "gemini-3.1-flash-lite: HTTP 400: API key not valid. Please pass a valid API key.");
    assert.equal(report.groq!.last, "openai/gpt-oss-120b: empty reply (length)");
    assert.equal(report.pollinations!.last, "failed");
    assert.equal(report.claude!.configured, false);
    assert.doesNotMatch(JSON.stringify(report), /secret/);
  });

  it("honours model overrides", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.GEMINI_MODEL = "gemini-2.5-flash-lite";
    mockFetch(() => geminiReply("{}"));
    await askCounsel("prompt");
    assert.match(calls[0]!.url, /models\/gemini-2\.5-flash-lite:generateContent$/);
  });

  it("skips providers without keys and reports failure when nothing answers", async () => {
    mockFetch(() => json({}, 503));
    const res = await askCounsel("prompt");
    assert.equal(res.ok, false);
    // Only the keyless Pollinations fallback was tried.
    assert.deepEqual(calls.map((c) => new URL(c.url).host), ["text.pollinations.ai"]);
  });
});

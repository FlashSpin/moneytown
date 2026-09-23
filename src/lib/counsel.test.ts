import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { askCounsel } from "./counsel.server.ts";

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

  it("falls back to Groq when Gemini's free quota is spent", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.GROQ_API_KEY = "q-key";
    mockFetch((url) => (url.includes("googleapis") ? json({ error: "quota" }, 429) : groqReply('{"say":"Aye"}')));
    const res = await askCounsel("prompt");
    assert.deepEqual(res, { ok: true, text: '{"say":"Aye"}', source: "groq" });
    assert.equal(calls[1]!.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal((calls[1]!.init.headers as Record<string, string>).Authorization, "Bearer q-key");
    assert.equal(JSON.parse(String(calls[1]!.init.body)).model, "openai/gpt-oss-120b");
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

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bearerOk, holdsSeal, holdsSealToken, isSovereign, looksLikeToken, sealToken } from "./seal.server.ts";
import { redact } from "./log.server.ts";
import { disabledSources } from "./tape-sources.ts";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("the royal seal", () => {
  it("accepts the passphrase and a signed token, never anything else", () => {
    process.env.KING_SEAL = "a-long-royal-seal-passphrase";
    assert.equal(holdsSeal("a-long-royal-seal-passphrase"), true);
    assert.equal(holdsSeal("wrong"), false);
    const token = sealToken()!;
    assert.ok(looksLikeToken(token));
    assert.ok(!token.includes("a-long-royal-seal-passphrase"), "the token doesn't carry the passphrase");
    assert.equal(holdsSealToken(token), true);
    assert.equal(isSovereign(token), true);
    assert.equal(holdsSealToken(token.slice(0, -2) + "xx"), false, "a tampered signature");
    assert.equal(holdsSealToken(token.replace(/seal1\.\d+/, `seal1.${Date.now() + 999 * 86_400_000}`)), false, "a stretched expiry");
  });

  it("tokens expire, and changing the seal voids them", () => {
    process.env.KING_SEAL = "first-seal-passphrase";
    const token = sealToken(0)!;
    assert.equal(holdsSealToken(token, 29 * 86_400_000), true);
    assert.equal(holdsSealToken(token, 31 * 86_400_000), false);
    const fresh = sealToken()!;
    process.env.KING_SEAL = "second-seal-passphrase";
    assert.equal(holdsSealToken(fresh), false);
  });

  it("without a seal set, nobody holds it", () => {
    delete process.env.KING_SEAL;
    assert.equal(sealToken(), null);
    assert.equal(isSovereign(""), false);
    assert.equal(isSovereign("anything"), false);
  });
});

describe("the scheduler secret", () => {
  const req = (auth?: string) => new Request("http://x/api/trade", { headers: auth ? { authorization: auth } : {} });
  it("needs the exact bearer secret", () => {
    process.env.CRON_SECRET = "cron-secret-value";
    assert.equal(bearerOk(req("Bearer cron-secret-value")), true);
    assert.equal(bearerOk(req("Bearer cron-secret-valuex")), false);
    assert.equal(bearerOk(req("cron-secret-value")), false);
    assert.equal(bearerOk(req()), false);
    delete process.env.CRON_SECRET;
    assert.equal(bearerOk(req("Bearer ")), false, "no secret set: nobody gets in");
  });
});

describe("logs", () => {
  it("never carry a secret's value", () => {
    const line = redact('{"error":"bad key sk-abcdef123456 for postgres://u:p@h/db"}', {
      GEMINI_API_KEY: "sk-abcdef123456",
      DATABASE_URL: "postgres://u:p@h/db",
      CRON_SECRET: "abc",
    });
    assert.equal(line, '{"error":"bad key [redacted] for [redacted]"}');
  });
});

describe("switching off a market source", () => {
  it("reads the list", () => {
    assert.deepEqual([...disabledSources(" Kraken, trending ,")], ["kraken", "trending"]);
    assert.equal(disabledSources(undefined).size, 0);
  });
});

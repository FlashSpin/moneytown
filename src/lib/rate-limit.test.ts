import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetRateLimits, takeToken } from "./rate-limit.ts";

describe("rate limit", () => {
  it("allows up to the limit per window, then blocks, then resets", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) assert.equal(takeToken("a", 3, 1000, 0), true);
    assert.equal(takeToken("a", 3, 1000, 10), false);
    assert.equal(takeToken("b", 3, 1000, 10), true);
    assert.equal(takeToken("a", 3, 1000, 1001), true);
  });
});

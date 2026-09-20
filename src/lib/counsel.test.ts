import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PROMPT_CHARS, parseCounselInput } from "./counsel-input.ts";

describe("counsel input validation", () => {
  it("accepts a normal prompt and defaults prefer", () => {
    assert.deepEqual(parseCounselInput({ prompt: "hi" }), { prompt: "hi", prefer: "any" });
  });
  it("rejects non-objects, non-strings, empty and oversized prompts", () => {
    assert.throws(() => parseCounselInput(null));
    assert.throws(() => parseCounselInput({ prompt: 5 }));
    assert.throws(() => parseCounselInput({ prompt: "   " }));
    assert.throws(() => parseCounselInput({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }));
  });
  it("coerces unknown prefer values to any", () => {
    assert.equal(parseCounselInput({ prompt: "hi", prefer: "evil" }).prefer, "any");
  });
});

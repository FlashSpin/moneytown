import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { temperOf } from "./trading.ts";

describe("temperaments", () => {
  it("gives every old villager a stable one", () => {
    assert.equal(temperOf("s-abc"), temperOf("s-abc"));
    assert.ok(["trend", "contrarian", "cautious", "bold", "steady"].includes(temperOf("s-xyz")));
  });
});

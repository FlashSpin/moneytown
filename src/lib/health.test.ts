import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { healthVerdict, LIMITS } from "./health.ts";

const NOW = 10_000_000_000;
const fine = {
  now: NOW,
  dbOk: true,
  lastTickAt: NOW - 60_000,
  lastReviewAt: NOW - 3_600_000,
  lastDawnAt: NOW - 3_600_000,
  halted: null,
  booksOk: true,
  pricesDark: false,
  recentFailures: 0,
};

describe("the health verdict", () => {
  it("is ok when everything runs on time", () => {
    assert.deepEqual(healthVerdict(fine), { status: "ok", problems: [] });
  });
  it("is down without the database", () => {
    assert.equal(healthVerdict({ ...fine, dbOk: false }).status, "down");
  });
  it("names every problem", () => {
    const v = healthVerdict({
      ...fine,
      lastTickAt: NOW - LIMITS.tickMs - 60_000,
      lastReviewAt: null,
      halted: "by royal command",
      booksOk: false,
      pricesDark: true,
      recentFailures: 2,
    });
    assert.equal(v.status, "degraded");
    assert.deepEqual(v.problems, [
      "no trading tick for 16 min",
      "no strategy review yet",
      "trading halted: by royal command",
      "the books don't reconcile",
      "no market prices",
      "2 failed job runs in the last hour",
    ]);
  });
  it("doesn't count books not yet checked as a problem", () => {
    assert.equal(healthVerdict({ ...fine, booksOk: null }).status, "ok");
  });
});

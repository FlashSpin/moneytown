import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendTick } from "./indicators.ts";
import { haltReason, riskBook } from "./limits.ts";
import type { Subject } from "./types.ts";

const soul = (id: string, balance: number, dayStart = balance, position?: Subject["position"]) =>
  ({ id, firstName: id, balance, dayStart, position, state: "idle" }) as Subject;
const NOW = 10_000_000;
const ticks = appendTick(appendTick(undefined, NOW - 300_000, { SOL: 100, ETH: 10 }), NOW, { SOL: 100 });
const priceOf = (c: string) => ({ SOL: 100, ETH: 10 })[c] ?? 0;

describe("risk limits", () => {
  it("lets a normal trade through", () => {
    const book = riskBook({ state: { subjects: [soul("a", 100_000)], day: 1 }, ticks, now: NOW, priceOf });
    assert.equal(book.gateFor(soul("a", 100_000))("SOL", 10_000), null);
  });

  it("halts everything on the seal-bearer's command or TRADING_HALT", () => {
    const halt = { at: 1, reason: "by royal command", by: "seal" as const };
    const book = riskBook({ state: { subjects: [soul("a", 100_000)], day: 1, halt }, ticks, now: NOW, priceOf });
    assert.match(book.gateFor(soul("a", 100_000))("SOL", 0)!, /halted: by royal command/);
    assert.match(haltReason({}, "1")!, /TRADING_HALT/);
    assert.equal(haltReason({}, "0"), null);
    assert.equal(haltReason({}, undefined), null);
  });

  it("stops a villager down 10% on the day", () => {
    const a = soul("a", 89_000, 100_000);
    const book = riskBook({ state: { subjects: [a, soul("b", 1_000_000)], day: 1 }, ticks, now: NOW, priceOf });
    assert.equal(book.gateFor(a)("SOL", 0), "daily loss limit");
  });

  it("pauses the whole parish until dawn when it is down 8% on the day", () => {
    const souls = [soul("a", 90_000, 100_000), soul("b", 91_000, 100_000)];
    const book = riskBook({ state: { subjects: souls, day: 4 }, ticks, now: NOW, priceOf });
    assert.equal(book.pausedToday?.day, 4);
    assert.match(book.gateFor(souls[1]!)("SOL", 0)!, /paused until dawn/);
    const nextDay = riskBook({ state: { subjects: souls.map((s) => ({ ...s, dayStart: s.balance })), day: 5, risk: { at: 0, blocked: {}, pausedToday: { day: 4, reason: "x" } } }, ticks, now: NOW, priceOf });
    assert.equal(nextDay.pausedToday, undefined, "a new day lifts the pause");
  });

  it("blocks a coin whose price has gone stale", () => {
    const book = riskBook({ state: { subjects: [soul("a", 100_000)], day: 1 }, ticks, now: NOW + 13 * 60_000, priceOf });
    assert.equal(book.gateFor(soul("a", 100_000))("SOL", 0), "stale price");
    const fresh = riskBook({ state: { subjects: [soul("a", 100_000)], day: 1 }, ticks, now: NOW, priceOf });
    assert.equal(fresh.gateFor(soul("a", 100_000))("DOGE", 0), "stale price", "never priced");
  });

  it("caps the parish at 25% of its money on one coin, counting trades opened this tick", () => {
    const held = soul("a", 100_000, 100_000, { coin: "SOL", side: "long", stake: 40_000, entryUsd: 100, openedAt: 0, peakUsd: 100 });
    const b = soul("b", 100_000);
    const book = riskBook({ state: { subjects: [held, b], day: 1 }, ticks, now: NOW, priceOf });
    assert.equal(book.gateFor(b)("SOL", 5_000), null, "45k of 200k");
    book.opened("SOL", 5_000);
    assert.equal(book.gateFor(b)("SOL", 10_000), "exposure cap", "55k > 50k");
  });
});

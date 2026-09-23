import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addLesson, avoids, coinEdge, describeKnowledge, emptyKnowledge, learnTrade, LESSONS_KEPT } from "./knowledge.ts";

describe("what a villager learns", () => {
  it("tallies each closed trade by coin, approach and side", () => {
    let k = learnTrade(undefined, { coin: "SOL", side: "long", approach: "momentum", pnl: 500 });
    k = learnTrade(k, { coin: "SOL", side: "short", approach: "own", pnl: -200 });
    assert.deepEqual(k.coins.SOL, { w: 1, l: 1, pnl: 300 });
    assert.deepEqual(k.approaches.momentum, { w: 1, l: 0, pnl: 500 });
    assert.deepEqual(k.approaches.own, { w: 0, l: 1, pnl: -200 });
    assert.equal(k.sides.short.l, 1);
  });

  it("trusts a coin's record only after a few trades", () => {
    let k = emptyKnowledge();
    k = learnTrade(k, { coin: "ETH", side: "long", approach: "trend", pnl: 10 });
    assert.equal(coinEdge(k, "ETH"), 0);
    for (let i = 0; i < 5; i++) k = learnTrade(k, { coin: "ETH", side: "long", approach: "trend", pnl: 10 });
    assert.ok(coinEdge(k, "ETH") > 0.4);
    assert.equal(coinEdge(k, "BTC"), 0);
  });

  it("avoids a coin that keeps losing it money", () => {
    let k = emptyKnowledge();
    for (let i = 0; i < 3; i++) k = learnTrade(k, { coin: "DOGE", side: "long", approach: "scalp", pnl: -10 });
    assert.equal(avoids(k, "DOGE"), false, "three trades is too few");
    k = learnTrade(k, { coin: "DOGE", side: "long", approach: "scalp", pnl: -10 });
    assert.equal(avoids(k, "DOGE"), true);
    k = learnTrade(k, { coin: "DOGE", side: "long", approach: "scalp", pnl: 100 });
    assert.equal(avoids(k, "DOGE"), false, "back in profit on it");
  });

  it("keeps a few written lessons, newest last, without repeats", () => {
    let k = addLesson(undefined, "Breakouts on SOL pay.");
    k = addLesson(k, "breakouts on sol pay.");
    k = addLesson(k, "ok");
    assert.deepEqual(k.lessons, ["breakouts on sol pay."]);
    for (let i = 0; i < 10; i++) k = addLesson(k, `Lesson number ${i}`);
    assert.equal(k.lessons.length, LESSONS_KEPT);
    assert.equal(k.lessons.at(-1), "Lesson number 9");
  });

  it("describes itself for the AI", () => {
    let k = learnTrade(undefined, { coin: "SOL", side: "long", approach: "momentum", pnl: 500 });
    k = learnTrade(k, { coin: "XRP", side: "long", approach: "momentum", pnl: -300 });
    k = addLesson(k, "Momentum works on SOL.");
    const text = describeKnowledge(k, (n) => `${n}s`);
    assert.match(text, /best coins: SOL 1W\/0L \+500s/);
    assert.match(text, /worst coins: XRP 0W\/1L -300s/);
    assert.match(text, /"Momentum works on SOL\."/);
    assert.equal(describeKnowledge(undefined, String), "nothing learned yet");
  });
});

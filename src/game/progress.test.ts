import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultKingPolicy, kingSpawnCount } from "./economy.ts";
import { advanceSeason, checkMilestones, GOAL_START, GOAL_STEP, parishWealth, SEASON_DAYS } from "./progress.ts";
import { rankChange, rankOf } from "./ranks.ts";
import { tradeStep, type Strategy, type Trader } from "./strategies.ts";
import { settleDay } from "./trading.ts";
import type { GameState, Subject } from "./types.ts";

const money = (n: number) => `${n}s`;

describe("ranks", () => {
  it("are earned by the record and lost when it turns", () => {
    assert.equal(rankOf(undefined), "apprentice");
    assert.equal(rankOf({ wins: 5, losses: 4, pnl: 100 }), "apprentice");
    assert.equal(rankOf({ wins: 5, losses: 5, pnl: 0 }), "journeyman");
    assert.equal(rankOf({ wins: 5, losses: 5, pnl: -1 }), "apprentice");
    assert.equal(rankOf({ wins: 15, losses: 15, pnl: 1 }), "merchant");
    assert.equal(rankOf({ wins: 38, losses: 37, pnl: 1 }), "master");
    assert.equal(rankOf({ wins: 30, losses: 45, pnl: 1 }), "merchant", "a master must win half");
    assert.equal(rankChange("apprentice", "merchant"), 1);
    assert.equal(rankChange("master", "merchant"), -1);
  });

  it("cap how much a villager may risk on one trade", () => {
    const strat: Strategy = { kind: "momentum", coins: ["SOL"], sizePct: 1, takeProfitPct: 2, stopLossPct: 1, shorts: true };
    const series = [100, 100, 100, 100, 100, 100, 101];
    const base: Trader = { id: "a", firstName: "A", balance: 100_000, strategy: strat };
    const free = tradeStep(base, () => 101, () => series, 1, 20_000).trader.position!.stake;
    const capped = tradeStep({ ...base, riskCap: 0.01 }, () => 101, () => series, 1, 20_000).trader.position!.stake;
    assert.ok(capped < free);
    assert.equal(capped, Math.floor((100_000 * 0.01) / 0.0195));
  });
});

describe("tax with losses carried forward", () => {
  const base = { dayStart: 10_000, taxRate: 0.2, rent: 100, floor: 1_000 };
  it("a losing day pays no tax and carries its loss forward", () => {
    const r = settleDay({ ...base, balance: 9_000 });
    assert.equal(r.tithe, 0);
    assert.equal(r.carry, 1_000);
  });
  it("later profit is set against the loss before tax", () => {
    const partly = settleDay({ ...base, balance: 10_600, carry: 1_000 });
    assert.equal(partly.offset, 600);
    assert.equal(partly.tithe, 0);
    assert.equal(partly.carry, 400);
    const past = settleDay({ ...base, balance: 11_000, carry: 400 });
    assert.equal(past.offset, 400);
    assert.equal(past.tithe, 120, "20% of the 600 left");
    assert.equal(past.carry, 0);
  });
});

describe("seasons", () => {
  it("open, run their days, and are judged on the parish's wealth", () => {
    const first = advanceSeason(undefined, { day: 1, at: 0, wealth: 1_000_000, hangedToday: 0, money });
    assert.equal(first.season.n, 1);
    assert.equal(first.season.goal, GOAL_START);
    const mid = advanceSeason(first.season, { day: 4, at: 1, wealth: 900_000, hangedToday: 1, money });
    assert.equal(mid.result, undefined);
    assert.equal(mid.season.hanged, 1);
    const won = advanceSeason(mid.season, { day: 1 + SEASON_DAYS, at: 2, wealth: 1_040_000, hangedToday: 0, money });
    assert.equal(won.result?.won, true);
    assert.equal(won.season.n, 2);
    assert.ok(Math.abs(won.season.goal - (GOAL_START + GOAL_STEP)) < 1e-9, "a win raises the goal");
    const lost = advanceSeason(won.season, { day: 1 + 2 * SEASON_DAYS, at: 3, wealth: 1_040_000, hangedToday: 0, money });
    assert.equal(lost.result?.won, false);
    assert.equal(lost.season.goal, won.season.goal, "a loss keeps it");
    assert.match(lost.notes[0]!, /lost/);
  });

  it("count open trades at today's price in the parish's wealth", () => {
    const s = { balance: 1_000, state: "idle", position: { coin: "SOL", side: "long", stake: 1_000, entryUsd: 100, openedAt: 0, peakUsd: 100 } } as Subject;
    assert.equal(parishWealth({ king: { balance: 500 } as never, subjects: [s] }, () => 110), 1_600);
  });
});

describe("milestones", () => {
  it("are recorded once, with when", () => {
    const state = {
      day: 3,
      king: { balance: 0 },
      subjects: [{ id: "a", firstName: "A", balance: 1, state: "idle", record: { wins: 1, losses: 0, pnl: 5 } }],
      trades: [{}],
    } as unknown as GameState;
    const a = checkMilestones(state, 99);
    assert.deepEqual(Object.keys(a.milestones).sort(), ["first-trade", "first-win"]);
    assert.equal(a.milestones["first-win"]!.at, 99);
    assert.equal(a.notes.length, 2);
    const b = checkMilestones({ ...state, milestones: a.milestones }, 150);
    assert.equal(b.notes.length, 0);
    assert.equal(b.milestones["first-win"]!.at, 99);
  });
});

describe("the economy under stress", () => {
  it("survives 90 days of mostly losing villagers without the treasury or any purse going negative", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const stake = 20_000;
    const policy = defaultKingPolicy(stake, 24);
    let treasury = 300_000;
    let souls: { balance: number; dayStart: number; carry: number; born: number }[] = [];
    let external = 0; // money that left for or came from the market
    const total = () => treasury + souls.reduce((n, s) => n + s.balance, 0) - external;
    const start = total();
    for (let day = 1; day <= 90; day++) {
      // A bad market: each purse moves -6%..+4% a day.
      for (const s of souls) {
        const pnl = Math.round(s.balance * (rnd() * 0.1 - 0.06));
        s.balance += pnl;
        external += pnl;
      }
      const next: typeof souls = [];
      for (const s of souls) {
        const d = settleDay({ balance: s.balance, dayStart: s.dayStart, taxRate: 0.2, rent: 340, floor: 2_700, carry: s.carry });
        treasury += d.tithe + d.rentPaid;
        assert.ok(d.balance >= 0);
        if (d.hanged) treasury += d.balance;
        else next.push({ balance: d.balance, dayStart: d.balance, carry: d.carry, born: s.born });
      }
      souls = next;
      const n = kingSpawnCount({ treasury, living: souls.length, unproven: souls.filter((s) => s.born === day - 1).length, policy });
      for (let i = 0; i < n; i++) {
        treasury -= stake;
        souls.push({ balance: stake, dayStart: stake, carry: 0, born: day });
      }
      assert.ok(treasury >= 0, `treasury went negative on day ${day}`);
      if (n) assert.ok(treasury >= policy.reserveSats, "spawning never breaks the reserve");
      assert.equal(total(), start, "no money created or destroyed");
    }
  });
});

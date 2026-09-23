import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Metrics } from "./backtest.ts";
import { compareWithBacktest, ordersFrom, paperStats, readinessGates, strategyChanges, type PaperOrder } from "./paper.ts";
import type { Strategy, TradeEvent } from "./strategies.ts";
import type { Subject } from "./types.ts";

const open = (t: number, coin: string, stake: number, by: "momentum" | "scalp" = "momentum"): TradeEvent => ({
  t, id: "a", name: "Agnes", action: "open", coin, side: "long", price: 100.1, mid: 100, cost: 10, fee: 40, stake, by, reason: "signal",
});
const close = (t: number, pnl: number, by: "momentum" | "scalp" = "momentum"): TradeEvent => ({
  t, id: "a", name: "Agnes", action: "close", coin: "SOL", side: "long", price: 101, mid: 101.05, cost: 10, fee: 40, stake: 10_000, pnl, by, reason: "take-profit",
});

describe("paper orders", () => {
  it("records fills with expected and fill prices, and rejections with why", () => {
    const orders = ordersFrom(
      [open(1, "SOL", 10_000), close(2, 150)],
      [{ villagerId: "b", name: "Hugh", order: { coin: "DOGE", side: "short", stake: 500, by: "scalp", reason: "rejected: below the exchange minimum" }, expected: 0.2 }],
      4,
      3,
    );
    assert.equal(orders.length, 3);
    assert.deepEqual(
      [orders[0]!.status, orders[0]!.expectedPrice, orders[0]!.fillPrice, orders[0]!.approach],
      ["filled", 100, 100.1, "momentum"],
    );
    assert.equal(orders[1]!.pnlSats, 150);
    assert.deepEqual([orders[2]!.status, orders[2]!.fillPrice, orders[2]!.reason], ["rejected", null, "rejected: below the exchange minimum"]);
  });

  it("records who changed a strategy, and only real changes", () => {
    const s = (kind: Strategy["kind"], tp = 2): Strategy => ({ kind, coins: [], sizePct: 0.3, takeProfitPct: tp, stopLossPct: 1, shorts: true });
    const before = [{ id: "a", firstName: "Agnes", strategy: s("scalp") }, { id: "b", firstName: "Hugh", strategy: s("trend") }] as Subject[];
    const after = [{ id: "a", firstName: "Agnes", strategy: s("scalp") }, { id: "b", firstName: "Hugh", strategy: s("trend", 3) }, { id: "c", firstName: "Rose", strategy: s("momentum") }] as Subject[];
    const changes = strategyChanges(before, after, "royal decree", 2, 9);
    assert.deepEqual(changes.map((c) => [c.name, c.by, c.before?.takeProfitPct ?? null]), [["Hugh", "royal decree", 2], ["Rose", "royal decree", null]]);
  });
});

describe("measuring paper trading", () => {
  const day = 86_400_000;
  const orders: PaperOrder[] = [
    ...ordersFrom([open(0, "SOL", 10_000), close(day / 2, 300), open(day, "SOL", 10_000), close(day * 1.5, -500), open(day * 2, "SOL", 10_000), close(day * 2.5, 100)], [], 1, 0),
  ].map((o, i) => (o.action === "open" ? { ...o, nextPrice: i === 0 ? 100.3 : 99.9 } : o));

  it("counts, costs, wins, P&L and the worst drawdown", () => {
    const s = paperStats(orders, "all");
    assert.equal(s.opens, 3);
    assert.equal(s.closes, 3);
    assert.equal(s.days, 2.5);
    assert.ok(Math.abs(s.opensPerDay! - 1.2) < 1e-9);
    assert.ok(Math.abs(s.avgCostPct! - 0.005) < 1e-9, "(10 + 40) / 10,000");
    assert.ok(Math.abs(s.winRate! - 2 / 3) < 1e-9);
    assert.equal(s.pnl, -100);
    assert.equal(s.maxDrawdown, 500);
    assert.ok(s.followThrough! < 0.001);
  });

  it("flags paper results that stray from the backtest, once there are enough trades", () => {
    const paper = { ...paperStats(orders, "momentum"), closes: 20, opensPerDay: 10, winRate: 0.2, avgCostPct: 0.02 };
    const bt = { trades: 30, days: 10, winRate: 0.6, costPerFillPct: 0.005 } as Metrics;
    const d = compareWithBacktest(paper, bt);
    assert.deepEqual(d.map((x) => x.measure), ["trades a day", "cost per fill", "win rate"]);
    assert.deepEqual(compareWithBacktest({ ...paper, closes: 3 }, bt), [], "too few trades to say");
  });
});

describe("the gates before real money", () => {
  const good = {
    completion7d: 0.99,
    ledgerMismatches30d: 0,
    backtestPassing: ["Momentum"],
    paper: { ...paperStats([], "all"), days: 31, pnl: 5_000, maxDrawdown: 1_000, closes: 40 },
    capital: 100_000,
    discrepancies: 0,
    signoffs: { security: "2026-10-01 AB", monitoring: "2026-10-01 AB", legal: "2026-10-02 solicitor" },
  };
  it("pass only when every one passes, sign-offs included", () => {
    assert.equal(readinessGates(good).ready, true);
    const unsigned = readinessGates({ ...good, signoffs: {} });
    assert.equal(unsigned.ready, false);
    assert.deepEqual(unsigned.gates.filter((g) => g.status === "manual").map((g) => g.id), ["security", "monitoring", "legal"]);
  });
  it("fail on each missing piece of evidence", () => {
    const fails = (patch: Partial<typeof good>) => readinessGates({ ...good, ...patch }).gates.filter((g) => g.status === "fail").map((g) => g.id);
    assert.deepEqual(fails({ completion7d: 0.8 }), ["reliability"]);
    assert.deepEqual(fails({ ledgerMismatches30d: 1 }), ["ledger"]);
    assert.deepEqual(fails({ backtestPassing: [] }), ["out-of-sample"]);
    assert.deepEqual(fails({ paper: { ...good.paper, days: 12 } }), ["paper"]);
    assert.deepEqual(fails({ paper: { ...good.paper, pnl: -1 } }), ["paper"]);
    assert.deepEqual(fails({ paper: { ...good.paper, maxDrawdown: 30_000 } }), ["paper"]);
    assert.deepEqual(fails({ discrepancies: 2 }), ["consistency"]);
  });
});

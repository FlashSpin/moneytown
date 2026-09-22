import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRent, applyTithe, runSubjectDawn, tapePnl, tradeIncome } from "./dawn.ts";
import type { Tape } from "./types.ts";
import { gbpToSats, rentSats, stakeSats, sumExchequer } from "./wallets.ts";

const tape: Tape = {
  btcUsd: 100_000,
  btcGbp: 80_000,
  change24h: 0,
  fearGreed: 50,
  fearGreedLabel: "Neutral",
  dark: true,
  source: "test",
  fetchedAt: 0,
  assets: {
    BTC: { usd: 100_000, change24h: 0 },
    ETH: { usd: 3_500, change24h: 0 },
    SOL: { usd: 150, change24h: 0 },
  },
};

const dawnBase = {
  tape,
  rng: () => 0.5,
  rentSats: 2_500,
};

describe("tithe uses taxRate, never a hardcoded 20%", () => {
  it("charges nothing at 0%", () => {
    const r = applyTithe(10_000, 0);
    assert.equal(r.tithe, 0);
    assert.equal(r.balance, 10_000);
  });

  it("charges 40% when taxRate is 0.4", () => {
    const r = applyTithe(10_000, 0.4);
    assert.equal(r.tithe, 4_000);
    assert.equal(r.balance, 6_000);
  });

  it("dawn leftover after rent follows the given taxRate", () => {
    const zero = runSubjectDawn({
      ...dawnBase,
      balance: 20_000,
      taxRate: 0,
      action: "idle",
    });
    const high = runSubjectDawn({
      ...dawnBase,
      balance: 20_000,
      taxRate: 0.4,
      action: "idle",
    });
    assert.equal(zero.rentPaid, 2_500);
    assert.equal(zero.tithe, 0);
    assert.equal(zero.balance, 17_500);
    assert.equal(high.rentPaid, 2_500);
    assert.equal(high.tithe, 7_000);
    assert.equal(high.balance, 10_500);
    assert.notEqual(zero.tithe, high.tithe);
  });
});

describe("rent and insolvency", () => {
  it("cannot pay more rent than the purse holds", () => {
    const r = applyRent(800, 2_500);
    assert.equal(r.paid, 800);
    assert.equal(r.balance, 0);
  });

  it("hangs a subject whose purse is empty after rent and tithe", () => {
    const r = runSubjectDawn({
      ...dawnBase,
      balance: 2_000,
      taxRate: 0.2,
      rng: () => 0.1,
      action: "idle",
    });
    assert.equal(r.hanged, true);
    assert.equal(r.balance, 0);
  });

  it("hangs a subject whose purse is already empty", () => {
    const r = runSubjectDawn({
      ...dawnBase,
      balance: 0,
      taxRate: 0.2,
      rng: () => 0.1,
      action: "earn",
    });
    assert.equal(r.hanged, true);
    assert.equal(r.income, 0);
  });
});

describe("tape pnl", () => {
  it("longs profit when the tape rises", () => {
    assert.equal(tapePnl(10_000, 10, "long"), 1_000);
    assert.equal(tapePnl(10_000, 10, "short"), -1_000);
    assert.equal(tapePnl(10_000, 10, "flat"), 0);
  });
});

describe("wallets", () => {
  it("exchequer is the sum of every purse", () => {
    const king = { balance: 9_500 };
    const folk = [{ balance: 38_000 }, { balance: 0 }];
    assert.equal(sumExchequer(king, folk), 47_500);
  });

  it("£20 stake is converted at the live GBP tape", () => {
    assert.equal(gbpToSats(20, 80_000), 25_000);
    assert.equal(stakeSats({ btcGbp: 80_000, btcUsd: 100_000 }), 25_000);
  });

  it("£1.50 rent is converted at the live GBP tape", () => {
    assert.equal(gbpToSats(1.5, 80_000), 1_875);
    assert.equal(rentSats({ btcGbp: 80_000, btcUsd: 100_000 }), 1_875);
  });
});

describe("tradeIncome — real mark-to-market P&L from a real price move", () => {
  it("is zero when flat, when the balance is zero, or when either price is unknown", () => {
    assert.equal(tradeIncome(10_000, 100, 110, "flat"), 0);
    assert.equal(tradeIncome(0, 100, 110, "long"), 0);
    assert.equal(tradeIncome(10_000, 0, 110, "long"), 0);
    assert.equal(tradeIncome(10_000, 100, 0, "long"), 0);
  });

  it("matches tapePnl fed the actual entry-to-exit percent move", () => {
    assert.equal(tradeIncome(10_000, 100_000, 105_000, "long"), tapePnl(10_000, 5, "long"));
    assert.equal(tradeIncome(10_000, 100_000, 95_000, "short"), tapePnl(10_000, -5, "short"));
  });

  it("a long profits when price rises, a short profits when price falls", () => {
    assert.equal(tradeIncome(10_000, 100_000, 110_000, "long"), 1_000);
    assert.equal(tradeIncome(10_000, 100_000, 90_000, "short"), 1_000);
    assert.equal(tradeIncome(10_000, 100_000, 110_000, "short"), -1_000);
  });

  it("clamps a catastrophic move so it never drives the balance negative on its own", () => {
    // A short against a price that triples implies a loss beyond the whole stake.
    const pnl = tradeIncome(10_000, 100_000, 300_000, "short");
    assert.equal(pnl, -10_000);
  });
});

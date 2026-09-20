import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEarn, applyRent, applyTithe, runSubjectDawn, tapePnl } from "./dawn.ts";
import type { Tape } from "./types.ts";
import { activePurse, gbpToSats, isBtcAddress, rentSats, stakeSats, sumExchequer } from "./wallets.ts";

const tape: Tape = {
  btcUsd: 100_000,
  btcGbp: 80_000,
  change24h: 0,
  fearGreed: 50,
  fearGreedLabel: "Neutral",
  dark: true,
  source: "test",
  fetchedAt: 0,
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

  it("hangs a subject whose test purse is already empty", () => {
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

  it("skipDues leaves a funded purse untouched", () => {
    const r = runSubjectDawn({
      ...dawnBase,
      balance: 8_000,
      taxRate: 0.2,
      rng: () => 0.1,
      action: "earn",
      skipDues: true,
    });
    assert.equal(r.hanged, false);
    assert.equal(r.rentPaid, 0);
    assert.equal(r.tithe, 0);
    assert.equal(r.balance, 8_000);
  });

  it("chain mode never pays an in-game wage and hangs only if the watch is zero", () => {
    const live = runSubjectDawn({
      ...dawnBase,
      balance: 8_000,
      taxRate: 0.2,
      action: "earn",
      chainMode: true,
      chainBalance: 90_000,
    });
    assert.equal(live.income, 0);
    assert.equal(live.hanged, false);
    assert.equal(live.rentPaid, 0);
    const broke = runSubjectDawn({
      ...dawnBase,
      balance: 8_000,
      taxRate: 0.2,
      action: "earn",
      chainMode: true,
      chainBalance: 0,
    });
    assert.equal(broke.hanged, true);
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
  it("accepts bech32 and legacy shapes, never keys", () => {
    assert.equal(isBtcAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), true);
    assert.equal(isBtcAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT"), true);
    assert.equal(isBtcAddress("not-an-address"), false);
    assert.equal(isBtcAddress(""), false);
  });

  it("active purse prefers chain only when a chain balance is known", () => {
    assert.equal(
      activePurse({ walletMode: "test", testBalance: 40_000, chainBalance: 9 }),
      40_000,
    );
    assert.equal(
      activePurse({ walletMode: "chain", testBalance: 40_000, chainBalance: 12 }),
      12,
    );
    assert.equal(
      activePurse({ walletMode: "chain", testBalance: 40_000, chainBalance: null }),
      40_000,
    );
  });

  it("exchequer is the sum of every purse", () => {
    const king = { walletMode: "test", testBalance: 9_500, chainBalance: null };
    const folk = [
      { walletMode: "test", testBalance: 38_000, chainBalance: null },
      { walletMode: "test", testBalance: 0, chainBalance: null },
    ];
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

describe("no in-game wage", () => {
  it("earn never pays from the game, even on a live tape", () => {
    const live: Tape = { ...tape, dark: false, change24h: 10 };
    const r = applyEarn("earn", 25_000, live, () => 0.5, "long");
    assert.equal(r.income, 0);
  });
});

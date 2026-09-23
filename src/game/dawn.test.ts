import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gbpToSats, rentSats, stakeSats, sumExchequer } from "./wallets.ts";

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

  it("£0.25 upkeep is converted at the live GBP tape", () => {
    assert.equal(gbpToSats(0.25, 80_000), 313);
    assert.equal(rentSats({ btcGbp: 80_000, btcUsd: 100_000 }), 313);
  });
});


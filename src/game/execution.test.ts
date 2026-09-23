import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costOf, EST_HALF_SPREAD, marketExecutor, MIN_SLIPPAGE } from "./execution.ts";
import { tradeStep, type Strategy, type Trader } from "./strategies.ts";
import type { AssetQuote } from "./types.ts";

// 1 BTC = $100,000, so 1 sat = $0.001 and 100,000 sats = $100.
const tape = (assets: Record<string, AssetQuote>) => ({ btcUsd: 100_000, assets, coins: ["SOL"] });
const SOL: AssetQuote = { usd: 100, change24h: 0, bid: 99.9, ask: 100.1, vol24hUsd: 50_000_000, ordermin: 0.02, costmin: 0.5, lotDecimals: 8 };

describe("execution", () => {
  it("buys at the ask and sells at the bid, plus a little slippage", () => {
    const ex = marketExecutor(tape({ SOL }));
    const buy = ex.open("SOL", "long", 100_000);
    assert.ok(buy.ok);
    assert.equal(buy.mid, 100);
    assert.ok(buy.price > 100.1 && buy.price < 100.13, `bought at ${buy.price}`);
    const sell = ex.close("SOL", "long", 100_000);
    assert.ok(sell.price < 99.9 && sell.price > 99.87, `sold at ${sell.price}`);
    const short = ex.open("SOL", "short", 100_000);
    assert.ok(short.ok && short.price < 99.9, "a short sells at the bid");
  });

  it("slippage grows with the order's size against the day's volume", () => {
    const small = costOf(SOL, 100, false).slippage;
    const big = costOf(SOL, 400_000, false).slippage;
    assert.equal(small, MIN_SLIPPAGE);
    assert.ok(big > small * 5);
  });

  it("rounds the quantity down to the pair's lot size, and stakes only what filled", () => {
    const ex = marketExecutor(tape({ SOL: { ...SOL, lotDecimals: 1 } }));
    const f = ex.open("SOL", "long", 100_000); // $100 → 0.99 SOL → 0.9
    assert.ok(f.ok);
    assert.equal(f.qty, 0.9);
    assert.ok(f.stake < 100_000 && f.stake > 89_000);
  });

  it("rejects an order below the exchange minimum, or too big for the market", () => {
    const ex = marketExecutor(tape({ SOL, THIN: { ...SOL, vol24hUsd: 5_000 } }));
    assert.deepEqual(ex.open("SOL", "long", 1_000), { ok: false, reason: "rejected: below the exchange minimum" }); // $1 < 0.02 SOL
    assert.deepEqual(ex.open("THIN", "long", 100_000), { ok: false, reason: "rejected: not enough volume" }); // $100 > 1% of $5k
    assert.equal(ex.open("NONE", "long", 100_000).ok, false);
  });

  it("estimates the spread when the price has no live book", () => {
    const ex = marketExecutor(tape({ GECKO: { usd: 10, change24h: 0 } }), new Set());
    const f = ex.open("GECKO", "long", 100_000);
    assert.ok(f.ok);
    assert.ok(Math.abs(f.price / 10 - 1 - (EST_HALF_SPREAD + 0.001)) < 1e-9);
  });

  it("a round trip at an unchanged price loses the spread, slippage and fees", () => {
    const strat: Strategy = { kind: "momentum", coins: ["SOL"], sizePct: 0.5, takeProfitPct: 2, stopLossPct: 1, shorts: true };
    const t0: Trader = { id: "a", firstName: "A", balance: 1_000_000, strategy: strat };
    const ex = marketExecutor(tape({ SOL }));
    const series = [100, 100, 100, 100, 100, 100, 101];
    const open = tradeStep(t0, () => 100, () => series, 1, 20_000, [], new Set(), () => null, ex);
    assert.equal(open.event?.mid, 100);
    assert.ok(open.event!.cost! > 0);
    const shut = tradeStep(open.trader, () => 100, () => series, 1 + 11 * 3_600_000, 20_000, [], new Set(), () => null, ex);
    assert.equal(shut.event?.action, "close");
    const lost = 1_000_000 - shut.trader.balance;
    // ~0.1% spread + 0.02% slippage each way + 0.4% fee each way on a 500,000-sat stake.
    assert.ok(lost > 4_500 && lost < 5_500, `round trip cost ${lost}`);
  });

  it("a rejected order leaves the villager as it was, and says why", () => {
    const strat: Strategy = { kind: "momentum", coins: ["SOL"], sizePct: 0.5, takeProfitPct: 2, stopLossPct: 1, shorts: true };
    const t0: Trader = { id: "a", firstName: "A", balance: 1_000, strategy: strat };
    const r = tradeStep(t0, () => 101, () => [100, 100, 100, 100, 100, 100, 101], 1, 20_000, [], new Set(), () => null, marketExecutor(tape({ SOL })));
    assert.equal(r.event, null);
    assert.equal(r.rejected, "rejected: below the exchange minimum");
    assert.equal(r.trader, t0);
  });
});

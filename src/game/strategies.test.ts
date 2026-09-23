import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanStrategy,
  defaultStrategy,
  deskStep,
  entrySignal,
  FEE_RATE,
  stakeFor,
  tradeStep,
  unrealized,
  type Strategy,
  type Trader,
} from "./strategies.ts";

const flat = (n: number, p = 100) => Array(n).fill(p);

describe("entry signals", () => {
  it("scalp follows a 15-minute move over 0.3%", () => {
    assert.equal(entrySignal("scalp", [100, 100, 100, 100.5])?.side, "long");
    assert.equal(entrySignal("scalp", [100, 100, 100, 99.5])?.side, "short");
    assert.equal(entrySignal("scalp", [100, 100, 100, 100.1]), null);
    assert.equal(entrySignal("scalp", [100, 101]), null, "warming up");
  });

  it("momentum needs 0.8% in 30 minutes", () => {
    assert.equal(entrySignal("momentum", [...flat(6), 101])?.side, "long");
    assert.equal(entrySignal("momentum", [...flat(6), 100.5]), null);
  });

  it("breakout fires on a break of the 2-hour range", () => {
    assert.equal(entrySignal("breakout", [...flat(24), 100.01])?.side, "long");
    assert.equal(entrySignal("breakout", [...flat(24), 99.99])?.side, "short");
    assert.equal(entrySignal("breakout", flat(25)), null);
  });

  it("reversion buys oversold and shorts overbought", () => {
    const falling = Array.from({ length: 15 }, (_, i) => 100 - i);
    const rising = Array.from({ length: 15 }, (_, i) => 100 + i);
    assert.equal(entrySignal("reversion", falling)?.side, "long");
    assert.equal(entrySignal("reversion", rising)?.side, "short");
  });

  it("trend fires only on the crossover itself", () => {
    const cross = [...flat(24), 106];
    assert.equal(entrySignal("trend", cross)?.side, "long");
    assert.equal(entrySignal("trend", [...cross, 107]), null, "already crossed");
  });
});

describe("a villager's trading step", () => {
  const strat: Strategy = { kind: "momentum", coins: ["SOL"], sizePct: 0.5, takeProfitPct: 2, stopLossPct: 1, shorts: true };
  const base: Trader = { id: "s-1", firstName: "Agnes", balance: 100_000, strategy: strat };
  const series = [...flat(6), 101];
  const at = (px: number) => () => px;
  const hist = () => series;

  it("opens on a signal, staking its share and paying the fee", () => {
    const { trader, event } = tradeStep(base, at(101), hist, 1_000, 20_000);
    assert.equal(event?.action, "open");
    assert.equal(trader.position?.stake, 50_000);
    assert.equal(trader.position?.side, "long");
    assert.equal(trader.balance, 100_000 - 50_000 * FEE_RATE);
  });

  it("takes profit at its target, net of the closing fee", () => {
    const open = tradeStep(base, at(101), hist, 1_000, 20_000).trader;
    const { trader, event } = tradeStep(open, at(103.1), () => flat(10), 2_000, 20_000);
    assert.equal(event?.action, "close");
    assert.match(event!.reason, /take-profit/);
    const gross = Math.round(50_000 * ((103.1 - 101) / 101));
    assert.equal(event!.pnl, gross - Math.round((50_000 + gross) * FEE_RATE));
    assert.equal(trader.position, undefined);
    assert.equal(trader.record?.wins, 1);
  });

  it("cuts losses at its stop", () => {
    const open = tradeStep(base, at(101), hist, 1_000, 20_000).trader;
    const { event, trader } = tradeStep(open, at(99.9), () => flat(10), 2_000, 20_000);
    assert.match(event!.reason, /stop-loss/);
    assert.ok(event!.pnl! < 0);
    assert.equal(trader.record?.losses, 1);
  });

  it("holds between its stop and its target", () => {
    const open = tradeStep(base, at(101), hist, 1_000, 20_000).trader;
    const { event, trader } = tradeStep(open, at(101.5), () => flat(10), 2_000, 20_000);
    assert.equal(event, null);
    assert.ok(trader.position);
  });

  it("closes at the time limit", () => {
    const open = tradeStep(base, at(101), hist, 1_000, 20_000).trader;
    const { event } = tradeStep(open, at(101.2), () => flat(10), 1_000 + 8 * 3_600_000, 20_000);
    assert.match(event!.reason, /time limit/);
  });

  it("waits out a cool-down before retrading the same coin", () => {
    const open = tradeStep(base, at(101), hist, 1_000, 20_000).trader;
    const closed = tradeStep(open, at(99.9), () => flat(10), 2_000, 20_000).trader;
    assert.equal(tradeStep(closed, at(101), hist, 3_000, 20_000).event, null);
    assert.equal(tradeStep(closed, at(101), hist, 2_000 + 11 * 60_000, 20_000).event?.action, "open");
  });

  it("won't short when its strategy forbids it", () => {
    const longOnly = { ...base, strategy: { ...strat, shorts: false } };
    assert.equal(tradeStep(longOnly, at(99), () => [...flat(6), 99], 1_000, 20_000).event, null);
  });

  it("trails a trend trade's stop behind the peak", () => {
    const trend: Trader = { ...base, strategy: { ...strat, kind: "trend", takeProfitPct: 20, stopLossPct: 2 } };
    const open = tradeStep(trend, at(106), () => [...flat(24), 106], 1_000, 20_000).trader;
    const up = tradeStep(open, at(112), () => [...flat(24), 106, 112], 2_000, 20_000).trader;
    assert.equal(up.position?.peakUsd, 112);
    const { event } = tradeStep(up, at(109.5), () => [...flat(24), 106, 112, 109.5], 3_000, 20_000);
    assert.match(event!.reason, /trailing stop/);
    assert.ok(event!.pnl! > 0);
  });

  it("weak purses stake less", () => {
    assert.equal(stakeFor(8_000, 0.8, 20_000), 2_000);
    assert.equal(stakeFor(30_000, 0.8, 20_000), 24_000);
  });

  it("a position can lose at most its stake", () => {
    assert.equal(unrealized({ coin: "X", side: "short", stake: 1_000, entryUsd: 10, openedAt: 0, peakUsd: 10 }, 40), -1_000);
  });
});

describe("choosing strategies", () => {
  const market = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "LINK"];

  it("gives each temperament its own default, across the whole market", () => {
    const a = defaultStrategy("s-aaa", "cautious", market);
    const b = defaultStrategy("s-zzz", "bold", market);
    assert.equal(a.kind, "reversion");
    assert.equal(a.shorts, false);
    assert.equal(b.kind, "breakout");
    assert.deepEqual(a.coins, [], "no watchlist: it scans every coin");
  });

  it("tidies a proposed strategy: known kind, listed coins, sane numbers", () => {
    const base = defaultStrategy("s-1", "trend", market);
    const s = cleanStrategy({ kind: "Scalp", coins: ["sol", "FAKE", "eth", "btc", "xrp"], size: 250, tp: 99, sl: 0.01 }, base, market);
    assert.equal(s.kind, "scalp");
    assert.deepEqual(s.coins, ["SOL", "ETH", "BTC", "XRP"], "any number of listed coins");
    assert.equal(s.sizePct, 1);
    assert.equal(s.takeProfitPct, 15);
    assert.equal(s.stopLossPct, 0.3);
  });

  it("keeps what it can't read, and uses the new kind's own targets", () => {
    const base = defaultStrategy("s-1", "trend", market);
    const s = cleanStrategy({ kind: "breakout" }, base, market);
    assert.deepEqual(s.coins, base.coins);
    assert.equal(s.takeProfitPct, 3);
    assert.equal(cleanStrategy("nonsense", base, market).kind, base.kind);
  });

  it('reads "all" (or an empty list) as the whole market', () => {
    const base = { ...defaultStrategy("s-1", "trend", market), coins: ["SOL"] };
    assert.deepEqual(cleanStrategy({ coins: "all" }, base, market).coins, []);
    assert.deepEqual(cleanStrategy({ coins: ["ALL"] }, base, market).coins, []);
    assert.deepEqual(cleanStrategy({ coins: [] }, base, market).coins, []);
    assert.deepEqual(cleanStrategy({ coins: "eth, doge" }, base, market).coins, ["ETH", "DOGE"]);
    assert.deepEqual(cleanStrategy({ kind: "scalp" }, base, market).coins, ["SOL"], "absent: unchanged");
  });
});

describe("trading the whole market", () => {
  const strat: Strategy = { kind: "momentum", coins: [], sizePct: 0.5, takeProfitPct: 2, stopLossPct: 1, shorts: true };
  const base: Trader = { id: "s-1", firstName: "Agnes", balance: 100_000, strategy: strat };
  const px: Record<string, number> = { BTC: 100, SOL: 102, DOGE: 101 };
  const hist: Record<string, number[]> = { BTC: flat(7), SOL: [...flat(6), 102], DOGE: [...flat(6), 101] };
  const priceOf = (c: string) => px[c] ?? 0;
  const seriesOf = (c: string) => hist[c] ?? [];

  it("scans every coin and takes the strongest signal", () => {
    const { event } = tradeStep(base, priceOf, seriesOf, 1_000, 20_000, ["BTC", "SOL", "DOGE"]);
    assert.equal(event?.coin, "SOL");
  });

  it("keeps to its focus coins when it has some", () => {
    const focused = { ...base, strategy: { ...strat, coins: ["DOGE"] } };
    assert.equal(tradeStep(focused, priceOf, seriesOf, 1_000, 20_000, ["BTC", "SOL", "DOGE"]).event?.coin, "DOGE");
  });

  it("learns from each close, and steers clear of coins that keep losing it money", () => {
    let t: Trader = base;
    for (let i = 0; i < 4; i++) {
      t = tradeStep({ ...t, cooldownUntil: 0 }, priceOf, seriesOf, 1_000 + i, 20_000, ["SOL"]).trader;
      t = tradeStep(t, () => 90, () => flat(10), 2_000 + i, 20_000, ["SOL"]).trader;
    }
    assert.deepEqual([t.knowledge?.coins.SOL?.w, t.knowledge?.coins.SOL?.l], [0, 4]);
    assert.equal(t.knowledge?.approaches.momentum?.l, 4);
    assert.ok(t.knowledge!.coins.SOL!.pnl < 0);
    const next = tradeStep({ ...t, cooldownUntil: 0 }, priceOf, seriesOf, 9_000, 20_000, ["SOL", "DOGE"]);
    assert.equal(next.event?.coin, "DOGE", "SOL is avoided now");
  });
});

describe("a villager's own calls at the desk", () => {
  const strat: Strategy = { kind: "reversion", coins: [], sizePct: 0.2, takeProfitPct: 2, stopLossPct: 1, shorts: false };
  const base: Trader = { id: "s-1", firstName: "Agnes", balance: 100_000, strategy: strat };
  const px: Record<string, number> = { SOL: 100, ETH: 50 };
  const priceOf = (c: string) => px[c] ?? 0;

  it("opens a trade of its own choosing, with its own targets", () => {
    const { trader, events } = deskStep(base, { action: "short", coin: "SOL", sizePct: 0.3, tp: 3, sl: 1.5, hours: 2, why: "fading the pump" }, priceOf, 1_000, 20_000);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.own, true);
    assert.equal(trader.position?.side, "short", "its own call may short even if its strategy doesn't");
    assert.equal(trader.position?.stake, 30_000);
    assert.deepEqual(trader.position?.own, { tp: 3, sl: 1.5, maxHoldH: 2 });
    assert.equal(trader.position?.by, "own");
  });

  it("its own trade keeps its own targets and time limit", () => {
    const open = deskStep(base, { action: "buy", coin: "SOL", tp: 5, sl: 3, hours: 1, why: "x" }, priceOf, 0, 20_000).trader;
    assert.equal(tradeStep(open, () => 102, () => flat(20), 60_000, 20_000).event, null, "strategy TP of 2% doesn't apply");
    const late = tradeStep(open, () => 101, () => flat(20), 3_600_000, 20_000);
    assert.match(late.event!.reason, /time limit \(1h\)/);
    assert.equal(late.trader.knowledge?.approaches.own?.w, 1);
  });

  it("switches trades: closes the old one, opens the new", () => {
    const open = deskStep(base, { action: "buy", coin: "SOL", why: "x" }, priceOf, 0, 20_000).trader;
    const { trader, events } = deskStep(open, { action: "buy", coin: "ETH", why: "better setup" }, priceOf, 1_000, 20_000);
    assert.deepEqual(events.map((e) => e.action), ["close", "open"]);
    assert.equal(trader.position?.coin, "ETH");
  });

  it("closes on its own call, and ignores orders it can't carry out", () => {
    const open = deskStep(base, { action: "buy", coin: "SOL", why: "x" }, priceOf, 0, 20_000).trader;
    const closed = deskStep(open, { action: "close", why: "taking it off" }, priceOf, 1_000, 20_000);
    assert.equal(closed.events[0]?.reason, "taking it off");
    assert.equal(closed.trader.position, undefined);
    assert.equal(deskStep(base, { action: "close", why: "" }, priceOf, 0, 20_000).events.length, 0);
    assert.equal(deskStep(base, { action: "buy", coin: "FAKE", why: "" }, priceOf, 0, 20_000).events.length, 0);
    const held = deskStep(open, { action: "buy", coin: "SOL", why: "" }, priceOf, 1_000, 20_000);
    assert.equal(held.events.length, 0, "already long SOL");
  });
});

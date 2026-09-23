import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balancesOf,
  FEES,
  genesisPostings,
  Journal,
  KING,
  MARKET,
  reconcile,
  unbalancedEvents,
  villagerAccount,
  withBookCheck,
} from "./ledger.ts";
import { deskStep, tradeStep, type Strategy, type Trader } from "./strategies.ts";
import type { GameState, Subject } from "./types.ts";

const soul = (id: string, balance: number) => ({ id, firstName: id, balance }) as Subject;
const world = (king: number, subjects: Subject[]) => ({ king: { balance: king } as never, subjects, day: 3 });

describe("the ledger", () => {
  it("every transfer is two legs that sum to zero", () => {
    const j = new Journal({ at: 1, day: 1 }, "t");
    j.transfer(KING, villagerAccount("a"), 500, "stake");
    j.transfer(villagerAccount("a"), KING, 0, "tax");
    assert.equal(j.postings.length, 2, "a zero transfer posts nothing");
    assert.deepEqual(unbalancedEvents(j.postings), []);
    assert.equal(balancesOf(j.postings).get(villagerAccount("a")), 500);
    assert.notEqual(j.postings[0]!.event, new Journal({ at: 2, day: 1 }, "t").postings[0]?.event);
  });

  it("opens the books from the purses as they stand", () => {
    const g = genesisPostings(world(1_000, [soul("a", 300), soul("b", 0)]), 5);
    const b = balancesOf(g);
    assert.equal(b.get(KING), 1_000);
    assert.equal(b.get(villagerAccount("a")), 300);
    assert.equal(b.has(villagerAccount("b")), false);
    assert.equal(b.get("genesis"), -1_300);
  });

  it("a trade's postings move exactly what the purse moved: fees to the exchange, P&L from the market", () => {
    const strat: Strategy = { kind: "momentum", coins: ["SOL"], sizePct: 0.5, takeProfitPct: 2, stopLossPct: 1, shorts: true };
    const t0: Trader = { id: "a", firstName: "A", balance: 100_000, strategy: strat };
    const series = [100, 100, 100, 100, 100, 100, 101];
    const open = tradeStep(t0, () => 101, () => series, 1, 20_000);
    const close = tradeStep(open.trader, () => 103.5, () => series, 2, 20_000);
    const j = new Journal({ at: 3, day: 1 }, "trade");
    j.fill(open.event!);
    j.fill(close.event!);
    const b = balancesOf(j.postings);
    assert.equal(b.get(villagerAccount("a")), close.trader.balance - 100_000);
    assert.equal((b.get(FEES) ?? 0) + (b.get(MARKET) ?? 0), -(close.trader.balance - 100_000));
    assert.equal(b.get(FEES), open.event!.fee! + close.event!.fee!);
    assert.deepEqual(unbalancedEvents(j.postings), []);
  });

  it("a desk switch (close then open) posts both fills", () => {
    const strat: Strategy = { kind: "reversion", coins: [], sizePct: 0.2, takeProfitPct: 2, stopLossPct: 1, shorts: true };
    const px: Record<string, number> = { SOL: 100, ETH: 50 };
    const t0: Trader = { id: "a", firstName: "A", balance: 100_000, strategy: strat };
    const a = deskStep(t0, { action: "buy", coin: "SOL", chance: 0.8, why: "x" }, (c) => px[c]!, 0, 20_000);
    px.SOL = 97;
    const b = deskStep(a.trader, { action: "short", coin: "ETH", chance: 0.8, why: "y" }, (c) => px[c]!, 1, 20_000);
    const j = new Journal({ at: 3, day: 1 }, "trade");
    for (const e of [...a.events, ...b.events]) j.fill(e);
    assert.equal(balancesOf(j.postings).get(villagerAccount("a")), b.trader.balance - 100_000);
  });

  it("reconciles the world against the ledger, and catches a purse that doesn't match", () => {
    const g = genesisPostings(world(1_000, [soul("a", 300)]), 5);
    const ok = reconcile(balancesOf(g), world(1_000, [soul("a", 300)]), 9);
    assert.equal(ok.ok, true);
    const bad = reconcile(balancesOf(g), world(1_000, [soul("a", 301)]), 9);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.diffs, [{ account: "v:a", ledger: 300, world: 301 }]);
    const gone = reconcile(balancesOf(g), world(1_000, []), 9);
    assert.equal(gone.ok, false, "a villager struck off with money still in the ledger");
  });

  it("halts trading when the books don't balance, and records the check either way", () => {
    const g = balancesOf(genesisPostings(world(1_000, [soul("a", 300)]), 5));
    const base: Pick<GameState, "king" | "subjects" | "ledger" | "halt"> = { ...world(1_000, [soul("a", 300)]), ledger: { since: 5 } };
    const fine = withBookCheck(base, g, 9);
    assert.equal(fine.ledger?.check?.ok, true);
    assert.equal(fine.halt, undefined);
    const off = withBookCheck({ ...base, subjects: [soul("a", 999)] }, g, 9);
    assert.equal(off.halt?.by, "ledger");
    assert.equal(withBookCheck({ ...base, ledger: undefined }, null, 9).ledger, undefined, "books not open yet: no check");
  });
});

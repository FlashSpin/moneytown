import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balancesOf,
  FEES,
  genesisPostings,
  GENESIS,
  Journal,
  KING,
  MARKET,
  reconcile,
  refoundPostings,
  unbalancedEvents,
  villagerAccount,
  withBookCheck,
} from "./ledger.ts";
import { fillTargets } from "./guild.ts";
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

  it("a fill's postings move exactly what the purse's cash moved: purchases to the market, costs to the fees", () => {
    const price = (f: string) => ({ SPY: 500, IEF: 100 })[f as "SPY"] ?? 0;
    const bought = fillTargets({ balance: 100_000, holdings: {} }, { SPY: 0.6, IEF: 0.4 }, price);
    const sold = fillTargets(bought, { IEF: 1 }, price);
    const j = new Journal({ at: 3, day: 1 }, "market");
    for (const f of [...bought.fills, ...sold.fills]) j.trade({ t: 3, d: "2026-01-02", id: "a", name: "A", fund: f.fund, value: f.value, cost: f.cost, why: "test" });
    const b = balancesOf(j.postings);
    assert.equal(b.get(villagerAccount("a")), sold.balance - 100_000);
    assert.equal(b.get(FEES), [...bought.fills, ...sold.fills].reduce((n, f) => n + f.cost, 0));
    assert.equal((b.get(MARKET) ?? 0) + (b.get(FEES) ?? 0), 100_000 - sold.balance);
    assert.deepEqual(unbalancedEvents(j.postings), []);
  });

  it("the re-founding closes every old balance back to genesis", () => {
    const old = balancesOf(genesisPostings(world(1_000, [soul("a", 300), soul("b", 50)]), 5));
    const closed = balancesOf([...genesisPostings(world(1_000, [soul("a", 300), soul("b", 50)]), 5), ...refoundPostings(old, 6, 3)]);
    for (const [account, v] of closed) assert.equal(v, 0, account);
    assert.equal(closed.get(GENESIS), 0);
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

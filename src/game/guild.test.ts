import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillTargets, performance, presetStrategy, raiseCash, retrain, stepIndexes, stepMerchant, worthOf, type MerchantFields } from "./guild.ts";
import { balancesOf, genesisPostings, reconcile, unbalancedEvents, villagerAccount } from "./ledger.ts";
import { marketDay } from "./market-day.ts";
import { toDaily, type FundId } from "./merchant.ts";
import type { GameState, Subject } from "./types.ts";
import { mulberry32 } from "./wallets.ts";
import { freshWorld, makeSubject, refoundWorld } from "./world.ts";

/** A crypto-era parish of three villagers. */
function oldParish(): GameState {
  const rng = mulberry32(3);
  const taken = new Set<string>();
  const subjects = [0, 1, 2].map(() => makeSubject(rng, taken, 50_000));
  return { ...freshWorld(42), era: undefined, subjects };
}

/** A small market: SPY rising 0.1% a day, IEF flat. */
function market(n = 260) {
  const rows: Partial<Record<FundId, { d: string; c: number }[]>> = { SPY: [], IEF: [], SHY: [] };
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    rows.SPY!.push({ d, c: 100 * 1.001 ** i });
    rows.IEF!.push({ d, c: 50 });
    rows.SHY!.push({ d, c: 80 });
  }
  return toDaily(rows);
}

const merchant = (over: Partial<MerchantFields> = {}): MerchantFields => ({
  id: "m1",
  firstName: "Agnes",
  balance: 100_000,
  track: { start: 100_000, startDay: "", bench: 100, days: 0 },
  ...over,
});

describe("filling orders", () => {
  const price = (f: FundId) => ({ SPY: 100, IEF: 50 })[f as "SPY" | "IEF"] ?? 0;

  it("buys to the target mix, paying the cost, and never spends cash it hasn't got", () => {
    const out = fillTargets({ balance: 100_000 }, { SPY: 0.6, IEF: 0.4 }, price);
    assert.ok(out.balance >= 0, "no borrowing");
    const worth = worthOf(out, price);
    const spy = ((out.holdings.SPY ?? 0) * 100) / worth;
    assert.ok(Math.abs(spy - 0.6) < 0.01, `about 60% SPY, got ${spy}`);
    const costs = out.fills.reduce((n, f) => n + f.cost, 0);
    assert.equal(worth + costs, 100_000, "only the costs are lost");
  });

  it("sells before it buys, and leaves small differences alone", () => {
    const held = { balance: 0, holdings: { SPY: 1000 } };
    const out = fillTargets(held, { IEF: 1 }, price);
    assert.equal(out.holdings.SPY, undefined, "sold out entirely");
    assert.ok((out.holdings.IEF ?? 0) > 0);
    assert.ok(out.fills[0]!.value < 0, "the sale comes first");
    const still = fillTargets({ balance: 0, holdings: { SPY: 1000 } }, { SPY: 0.995 }, price);
    assert.equal(still.fills.length, 0, "within the band: no trade");
  });

  it("raises exactly enough cash, pro rata, or sells everything", () => {
    const s = merchant({ balance: 0, holdings: { SPY: 500, IEF: 1000 } });
    const some = raiseCash(s, 10_000, price);
    assert.ok(some.next.balance >= 10_000 - 1 && some.next.balance < 10_200, `raised ${some.next.balance}`);
    assert.equal(some.fills.length, 2, "both funds are trimmed");
    const all = raiseCash(s, Number.MAX_SAFE_INTEGER, price);
    assert.deepEqual(all.next.holdings, {});
  });
});

describe("a merchant's market day", () => {
  it("decides at a close and fills only at the next", () => {
    const g = market();
    const s = { ...merchant(), strategy: presetStrategy("sixty-forty") };
    const day1 = stepMerchant(s, g, 210, 1);
    assert.equal(day1.trades.length, 0, "nothing fills on the day it is decided");
    assert.ok(day1.next.pending, "orders are placed");
    const day2 = stepMerchant(day1.next, g, 211, 2);
    assert.ok(day2.trades.length > 0, "the orders fill at the next close");
    assert.ok(day2.trades.every((t) => t.d === g.days[211]));
    assert.equal(day2.next.track?.days, 2);
    assert.equal(stepMerchant(day2.next, g, 211, 3).next, day2.next, "the same close twice changes nothing");
  });

  it("is judged against the 60/40 over the same days", () => {
    const p = performance({ balance: 0, worth: 110_000, track: { start: 100_000, startDay: "x", bench: 100, days: 30 } }, 105);
    assert.ok(p && Math.abs(p.ret - 0.1) < 1e-9 && Math.abs(p.bench - 0.05) < 1e-9 && p.ahead > 0);
    const idx = stepIndexes({ sf: 100, us: 100 }, market(), 1);
    assert.ok(idx.us > 100 && idx.sf > 100 && idx.sf < idx.us, "the 60/40 moves 60% as much as SPY here");
  });

  it("retrains a merchant far behind the 60/40 only after long enough", () => {
    const behind = merchant({ worth: 90_000, strategy: presetStrategy("momentum"), track: { start: 100_000, startDay: "x", bench: 100, days: 70 } });
    assert.equal(retrain(behind, 110, [])?.strategy.preset, "trend");
    assert.equal(retrain({ ...behind, track: { ...behind.track!, days: 20 } }, 110, []), null, "too soon to judge");
    assert.equal(retrain({ ...behind, worth: 112_000 }, 110, []), null, "ahead: keep going");
  });
});

describe("the guild's books", () => {
  it("re-founds a crypto-era world with balanced books and every merchant staked", () => {
    const old = oldParish();
    const legacy = new Map<string, number>([
      ["king", 123_456],
      [villagerAccount(old.subjects[0]!.id), 7_000],
      ["fees", 900],
      ["genesis", -131_356],
    ]);
    const world = refoundWorld(old, legacy, 100_000, 5);
    assert.equal(world.era, "guild");
    const books = balancesOf(world.postings ?? []);
    for (const [k, v] of legacy) books.set(k, (books.get(k) ?? 0) + v);
    assert.deepEqual(unbalancedEvents(world.postings ?? []), []);
    assert.ok(reconcile(books, world, 5).ok, "the ledger matches every purse after the re-founding");
    assert.equal(world.subjects.length, 3);
    assert.ok(world.subjects.every((s) => s.balance === 100_000 && s.strategy));
  });

  it("re-founds a world whose books open on the same load without counting the treasury twice", () => {
    const old = oldParish();
    const opened = { ...old, ledger: { since: 1 }, postings: genesisPostings(old, 1) };
    const world = refoundWorld(opened, null, 100_000, 5);
    assert.deepEqual(unbalancedEvents(world.postings ?? []), []);
    assert.ok(reconcile(balancesOf(world.postings ?? []), world, 5).ok);
  });

  it("posts every fill of a market day, and the books still balance", () => {
    const g = market();
    let replay = refoundWorld(oldParish(), null, 100_000, 1);
    const all = [...(replay.postings ?? [])];
    for (let i = 205; i < 215; i++) {
      replay = marketDay({ ...replay, postings: [] }, g, i, i);
      all.push(...(replay.postings ?? []));
    }
    assert.deepEqual(unbalancedEvents(all), []);
    assert.ok(reconcile(balancesOf(all), replay, 1).ok, "every purse matches the ledger after ten market days");
    assert.ok((replay.trades ?? []).length > 0, "the merchants invested");
    const invested = replay.subjects.filter((s: Subject) => Object.keys(s.holdings ?? {}).length);
    assert.ok(invested.length > 0);
    assert.equal(replay.lastMarketDay, g.days[214]);
  });
});

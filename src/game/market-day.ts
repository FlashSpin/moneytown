/**
 * A market day for the whole guild — pure. Called once per trading day
 * after the close (src/lib/merchant.server.ts, fed by the merchant
 * workflow): every living merchant's orders fill and its ISA is valued at
 * the close (./guild.ts `stepMerchant`), each fill is posted to the ledger,
 * the market board and the 60/40 index move on, and the Chronicle notes
 * what mattered. While trading is halted, nothing is bought or sold: purses
 * are only valued.
 */
import { performance, stepIndexes, stepMerchant, worthOf, type FundTrade } from "./guild.ts";
import { Journal, withPostings } from "./ledger.ts";
import { avg, FUND_IDS, FUNDS, ret, type Daily, type FundId } from "./merchant.ts";
import { RANK_INFO, rankChange, rankOf } from "./ranks.ts";
import type { Board, GameState, Subject } from "./types.ts";
import { pushLog, withTotals } from "./world.ts";

const TRADES_KEPT = 60;
/** A fund moving this much in a day makes the Chronicle. */
const BIG_MOVE = 0.03;

export function boardAt(g: Daily, i: number, at: number): Board {
  const funds: Board["funds"] = {};
  for (const f of FUND_IDS) {
    const close = g.px[f]?.[i];
    if (!close || !(close > 0)) continue;
    const a = avg(g, f, i, 200);
    funds[f] = {
      close,
      change1d: ret(g, f, i, 1) ?? 0,
      ...(ret(g, f, i, 252) !== null ? { change1y: ret(g, f, i, 252)! } : {}),
      ...(a !== null ? { above200: close > a } : {}),
    };
  }
  return { d: g.days[i]!, at, funds };
}

const living = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";

export function marketDay(prev: GameState, g: Daily, i: number, now: number): GameState {
  const d = g.days[i]!;
  if (prev.lastMarketDay && prev.lastMarketDay >= d) return prev;
  const first = !prev.lastMarketDay;
  // The 60/40 index moves on from the guild's first market day.
  const bench = first ? (prev.bench ?? { sf: 100, us: 100 }) : stepIndexes(prev.bench, g, i);
  const price = (f: FundId) => g.px[f]?.[i] ?? 0;
  const journal = new Journal({ at: now, day: prev.day }, "market");
  const trades: FundTrade[] = [];
  let log = prev.log;
  const push = (kind: Parameters<typeof pushLog>[1], text: string) => {
    log = pushLog({ day: prev.day, log }, kind, text);
  };
  let before = 0;
  let after = 0;
  const subjects = prev.subjects.map((s) => {
    if (!living(s)) return s;
    // A merchant's first market day sets where it is judged from.
    let me: Subject = s.track && !s.track.startDay ? { ...s, track: { ...s.track, startDay: d, bench: bench.sf } } : s;
    const was = me.worth ?? me.balance;
    before += was;
    const wasRank = rankOf(me, prev.bench?.sf ?? 100);
    if (prev.halt) {
      me = { ...me, worth: worthOf(me, price), worthDay: d };
    } else {
      const step = stepMerchant(me, g, i, now);
      me = step.next;
      for (const t of step.trades) {
        journal.trade(t);
        trades.push(t);
      }
    }
    const worth = me.worth ?? me.balance;
    after += worth;
    const nowRank = rankOf(me, bench.sf);
    const moved = rankChange(wasRank, nowRank);
    if (moved) {
      push(
        "subject",
        moved > 0
          ? `${me.firstName} rises to ${RANK_INFO[nowRank].label} (${RANK_INFO[nowRank].rule}).`
          : `${me.firstName} falls back to ${RANK_INFO[nowRank].label} — the results no longer hold up.`,
      );
    }
    return { ...me, lastPnl: worth - was, lastAction: "earn" as const };
  });

  const board = boardAt(g, i, now);
  for (const f of FUND_IDS) {
    const q = board.funds[f];
    if (q && Math.abs(q.change1d) >= BIG_MOVE) push("tape", `${FUNDS[f].name} (${f}) ${q.change1d > 0 ? "leaps" : "tumbles"} ${(q.change1d * 100).toFixed(1)}% at the close.`);
  }
  if (!first && before > 0) {
    const change = after / before - 1;
    const sf = prev.bench?.sf ? bench.sf / prev.bench.sf - 1 : 0;
    push("tape", `The close of ${d}: the guild's ISAs ${change >= 0 ? "gain" : "lose"} ${(Math.abs(change) * 100).toFixed(2)}% on the day (the 60/40 ${sf >= 0 ? "+" : "-"}${(Math.abs(sf) * 100).toFixed(2)}%).${trades.length ? ` ${trades.length} orders filled.` : ""}`);
  } else if (first) {
    push("tape", `The guild's first market day: the close of ${d}. Orders are placed tonight and fill at the next close.`);
  }
  if (prev.halt) push("system", `Orders are halted (${prev.halt.reason}): purses are valued, nothing is bought or sold.`);
  return withTotals({
    ...withPostings(prev, journal.postings),
    subjects,
    board,
    bench,
    log,
    trades: [...trades.slice().reverse(), ...(prev.trades ?? [])].slice(0, TRADES_KEPT),
    lastMarketAt: now,
    lastMarketDay: d,
  });
}

/** How a merchant stands against the 60/40 now (for summaries). */
export function standing(s: Subject, bench: number): string {
  const p = performance(s, bench);
  if (!p || !(s.track?.days ?? 0)) return "not yet invested";
  return `${p.ret >= 0 ? "+" : ""}${(p.ret * 100).toFixed(1)}% (60/40 ${p.bench >= 0 ? "+" : ""}${(p.bench * 100).toFixed(1)}%)`;
}

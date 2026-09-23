/**
 * The trading tick — server-only, every 5 minutes (/api/trade). Each
 * villager's own strategy (src/game/strategies.ts) scans every coin in the
 * market and trades by its rules, like an exchange bot. When the trading
 * desk is due — as often as the villagers asked for last time, 5 to 60
 * minutes — they also look at the market with the (free) AI and place,
 * switch or close their own trades (`tradingDesk`). Every closed trade is
 * remembered (src/game/knowledge.ts). The AI chooses and tunes the
 * strategies at the council (src/game/review.server.ts).
 */
import { loadTape } from "@/lib/tape.server";
import { SHOUT_LIFE } from "./constants";
import { marketCoins, priceOf, scanCoins } from "./dawn";
import { appendTick, priceFresh, tradingSeries, validatePrices, type Ticks } from "./indicators";
import { haltReason, riskBook, type Gate } from "./limits";
import { standAt } from "./shops";
import { marketExecutor } from "./execution";
import { addLesson } from "./knowledge";
import { checkMilestones } from "./progress";
import { RANK_INFO, rankChange, rankOf } from "./ranks";
import { Journal, withPostings } from "./ledger";
import { DESK_DEFAULT_GAP, tradingDesk, type CouncilSoul, type Desk } from "./llm.server";
import { defaultStrategy, deskStep, tradeStep, type Strategy, type TradeEvent, type Trader } from "./strategies";
import { wanderPoint } from "./town";
import { temperOf } from "./trading";
import type { GameState, SpeechLine, Subject, Tape } from "./types";
import { pushLog, withTotals } from "./world";
import { formatGbp, mulberry32, satsToGbp, stakeSats, tapeGbp, uid } from "./wallets";

/** A move this big in an hour (in %) goes in the Chronicle. */
export const MARKET_MOVE_PCT = 5;

/** How many fills the trading floor keeps. */
export const TRADES_KEPT = 60;

export function isLiving(s: Subject): boolean {
  return s.state !== "condemned" && s.state !== "hanging";
}

/** Every coin the parish needs priced beyond the market's own: open trades and every focus list. */
export function coinsNeeded(state: GameState): string[] {
  const out = new Set<string>();
  for (const s of state.subjects) {
    if (s.position) out.add(s.position.coin);
    for (const c of s.strategy?.coins ?? []) out.add(c);
  }
  return [...out];
}

export function strategyOf(s: Subject, tape: Tape): Strategy {
  return s.strategy ?? defaultStrategy(s.id, s.temper ?? temperOf(s.id), marketCoins(tape));
}

/** How the AI sees a villager: purse, strategy, trade, record and what it has learned. */
export function soulFor(s: Subject, tape: Tape): CouncilSoul {
  return {
    id: s.id,
    firstName: s.firstName,
    balance: s.balance,
    dayStart: s.dayStart ?? s.balance,
    temper: s.temper ?? temperOf(s.id),
    strategy: strategyOf(s, tape),
    position: s.position,
    trades: s.trades,
    record: s.record,
    knowledge: s.knowledge,
  };
}

/** Every coin a villager may trade right now: the whole scan list, priced. */
export function tradableCoins(tape: Tape): string[] {
  return scanCoins(tape).filter((c) => priceOf(tape, c) > 0);
}

export function pricesOf(tape: Tape): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [coin, info] of Object.entries(tape.assets)) if (info.usd > 0) out[coin] = info.usd;
  return out;
}

/**
 * Run every villager once against `tape`: its own desk order if it placed
 * one, else its strategy across every tradable coin. Pure apart from the RNG.
 */
export function tradeParish(
  state: GameState,
  tape: Tape,
  ticks: Ticks,
  now: number,
  desk?: Pick<Desk, "orders" | "lessons"> | null,
  env?: string,
): {
  subjects: Subject[];
  events: TradeEvent[];
  speech: SpeechLine[];
  skipped: number;
  notes: { kind: "subject" | "tape"; text: string }[];
  risk: NonNullable<GameState["risk"]>;
} {
  const market = marketCoins(tape);
  const book = riskBook({ state, ticks, now, priceOf: (coin) => priceOf(tape, coin), env });
  // Orders fill like an exchange's: at the bid or ask, with slippage, lot sizes and minimums.
  const exec = marketExecutor(tape);
  const universe = tradableCoins(tape);
  const hot = new Set(tape.trending ?? []);
  let skipped = 0;
  const notes: { kind: "subject" | "tape"; text: string }[] = [];
  const stake = stakeSats(tape);
  const rng = mulberry32(state.seed + Math.floor(now / 60_000));
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(tape)));
  const events: TradeEvent[] = [];
  const speech: SpeechLine[] = [];
  let delay = 0.3;

  const subjects = state.subjects.map((s) => {
    if (!isLiving(s)) return s;
    const strategy = strategyOf(s, tape);
    const lesson = desk?.lessons.get(s.id);
    const me: Trader = {
      id: s.id,
      firstName: s.firstName,
      balance: s.balance,
      strategy,
      position: s.position,
      cooldownUntil: s.cooldownUntil,
      cooldownCoin: s.cooldownCoin,
      record: s.record,
      trades: s.trades,
      knowledge: lesson ? addLesson(s.knowledge, lesson) : s.knowledge,
      riskCap: RANK_INFO[rankOf(s.record)].riskCap,
    };
    const px = (coin: string) => priceOf(tape, coin);
    const gate = book.gateFor(s);
    // Every block is counted, so the ledger shows what the limits stopped.
    const counted: Gate = (coin, st) => {
      const why = gate(coin, st);
      if (why) book.block(why);
      return why;
    };
    const order = desk?.orders.get(s.id);
    // Its own call at the desk, if it made one that could be carried out; otherwise its strategy trades.
    const own = order ? deskStep(me, order, px, now, stake, counted, exec) : null;
    if (own?.skipped) skipped++;
    if (own?.skipped?.startsWith("rejected")) book.block(own.skipped);
    const step = own?.events.length
      ? { trader: own.trader, fills: own.events }
      : (() => {
          const r = tradeStep(me, px, (coin) => tradingSeries(ticks, coin, now), now, stake, universe, hot, counted, exec);
          if (r.rejected) book.block(r.rejected);
          return { trader: r.trader, fills: r.event ? [r.event] : [] };
        })();
    const trader = step.trader;
    const event = step.fills[step.fills.length - 1];
    if (trader.position && step.fills.some((f) => f.action === "open")) book.opened(trader.position.coin, trader.position.stake);
    const next: Subject = {
      ...s,
      strategy,
      balance: trader.balance,
      position: trader.position,
      cooldownUntil: trader.cooldownUntil,
      cooldownCoin: trader.cooldownCoin,
      record: trader.record,
      trades: trader.trades,
      knowledge: trader.knowledge,
      // Mirrors for everything that still reads the simple view of a position.
      side: trader.position?.side ?? "flat",
      asset: trader.position?.coin ?? s.asset,
      size: trader.position ? strategy.sizePct : s.size,
      entryUsd: trader.position?.entryUsd,
    };
    // The Chronicle keeps what matters: a change of rank, and a trade that moved the purse a lot.
    const was = rankOf(s.record);
    const now_ = rankOf(trader.record);
    const moved = rankChange(was, now_);
    if (moved) {
      notes.push({
        kind: "subject",
        text: moved > 0
          ? `${s.firstName} rises to ${RANK_INFO[now_].label} (${RANK_INFO[now_].rule}) and may now risk up to ${Math.round(RANK_INFO[now_].riskCap * 100)}% a trade.`
          : `${s.firstName} falls back to ${RANK_INFO[now_].label} — the record no longer holds up.`,
      });
    }
    for (const f of step.fills) {
      if (f.action === "close" && f.pnl !== undefined && s.balance > 0 && Math.abs(f.pnl) >= s.balance * 0.05) {
        notes.push({
          kind: "subject",
          text: `${s.firstName} ${f.pnl > 0 ? "banks" : "loses"} ${gbp(Math.abs(f.pnl))} on ${f.coin} (${f.side}) — ${Math.round((Math.abs(f.pnl) / s.balance) * 100)}% of the purse; ${f.reason}.`,
        });
      }
    }
    if (!event) return next;
    events.push(...step.fills);
    const verb = event.action === "open" ? (event.side === "long" ? "Buying" : "Shorting") : "Closing";
    const tail =
      event.action === "open"
        ? `${event.coin} — ${event.reason}!`
        : `${event.coin}, ${event.pnl! >= 0 ? "+" : "-"}${gbp(Math.abs(event.pnl!))}${event.own ? ` — ${event.reason}` : ""}.`;
    speech.push({
      id: uid("t", rng),
      fromId: s.id,
      toId: null,
      text: `${verb} ${tail}`,
      shout: true,
      age: -delay,
      life: SHOUT_LIFE,
      heard: false,
      logged: true,
    });
    delay += 2.4;
    const dest = event.action === "open" ? standAt(event.coin, market) : wanderPoint(rng);
    return { ...next, destX: dest.x + (rng() - 0.5) * 36, destY: dest.y + rng() * 16, state: "walk" as const, lastPnl: event.pnl ?? next.lastPnl };
  });
  return {
    subjects,
    events,
    speech: speech.slice(0, 8),
    skipped,
    notes,
    risk: { at: now, blocked: book.blocked, ...(book.pausedToday ? { pausedToday: book.pausedToday } : {}) },
  };
}

/** Whether the villagers want to look at the market with the AI this tick (a minute's grace for a late schedule). */
export function deskDue(state: GameState, now: number, force = false): boolean {
  if (process.env.TRADING_DESK?.trim().toLowerCase() === "off") return false;
  // No new trades can open while halted, so there's nothing to ask the AI.
  if (haltReason(state, process.env.TRADING_HALT)) return false;
  if (!state.subjects.some(isLiving)) return false;
  return force || now + 60_000 >= (state.desk?.nextAt ?? 0);
}

/**
 * One trading tick. `memo` carries the desk's answer across retries (the
 * caller re-runs this when the world changed under it) so the AI is asked
 * at most once per tick.
 */
export async function runTradeTick(prev: GameState, memo: { desk?: Desk | { error: string }; tape?: Tape; force?: boolean } = {}): Promise<GameState> {
  const now = Date.now();
  let tape = memo.tape ?? (await loadTape(coinsNeeded(prev)).catch(() => ({ ...prev.tape, dark: true, source: "dark" })));
  if (tape.dark && !tape.coins) tape = { ...tape, coins: prev.tape.coins };
  // No prices, no trading — but nobody loses their place either.
  if (tape.dark) return { ...prev, lastTickAt: now };
  memo.tape = tape;

  // Prices are checked before they are recorded: an implausible jump waits for the next tick to confirm it.
  const checked = validatePrices(prev.ticks, pricesOf(tape));
  const ticks = { ...appendTick(prev.ticks, now, checked.accepted), suspect: checked.suspect };
  // A held-back coin trades (and marks) at its last good price this tick, with no book to fill against.
  for (const coin of checked.held) {
    const good = ticks.px[coin]?.[ticks.px[coin]!.length - 1];
    const q = tape.assets[coin];
    if (good && q) tape = { ...tape, assets: { ...tape.assets, [coin]: { usd: good, change24h: q.change24h, name: q.name, src: q.src } } };
  }
  const feed = feedHealth(tape, ticks, now, checked.held);
  const due = deskDue(prev, now, memo.force);
  if (due && memo.desk === undefined) {
    memo.desk = await tradingDesk({
      day: prev.day,
      tape,
      ticks,
      kingPlan: prev.council?.kingPlan,
      souls: prev.subjects.filter(isLiving).map((s) => soulFor(s, tape)),
      now,
    }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
  }
  const answer = due ? memo.desk : undefined;
  const desk = answer && !("error" in answer) ? answer : null;
  const { subjects, events, speech, skipped, risk, notes } = tradeParish({ ...prev, tape, ticks }, tape, ticks, now, desk, process.env.TRADING_HALT);
  const journal = new Journal({ at: now, day: prev.day }, "trade");
  for (const e of events) journal.fill(e);

  // The Chronicle: promotions and big trades, the market's big moves (once a coin a day), and a halt.
  let log = prev.log;
  for (const n of notes) log = pushLog({ day: prev.day, log }, n.kind, n.text);
  const marketNotes = prev.marketNotes?.day === prev.day ? prev.marketNotes : { day: prev.day, coins: [] };
  const noted = new Set(marketNotes.coins);
  for (const coin of scanCoins(tape)) {
    if (noted.has(coin)) continue;
    const series = tradingSeries(ticks, coin, now);
    if (series.length < 13) continue;
    const move = (series[series.length - 1]! / series[series.length - 13]! - 1) * 100;
    if (Math.abs(move) < MARKET_MOVE_PCT) continue;
    noted.add(coin);
    log = pushLog({ day: prev.day, log }, "tape", `${coin} ${move > 0 ? "surges" : "plunges"} ${move > 0 ? "+" : ""}${move.toFixed(1)}% in an hour.`);
  }
  if (prev.halt && prev.halt.at > (prev.lastTickAt ?? 0) && prev.halt.by === "ledger") {
    log = pushLog({ day: prev.day, log }, "system", `Trading halted: ${prev.halt.reason}.`);
  }
  const traded: GameState = { ...prev, subjects, trades: [...events.slice().reverse(), ...(prev.trades ?? [])].slice(0, TRADES_KEPT) };
  const reached = checkMilestones(traded, now);
  for (const line of reached.notes) log = pushLog({ day: prev.day, log }, "crown", line);

  return withTotals({
    ...withPostings(prev, journal.postings),
    tape,
    ticks,
    subjects,
    desk: due
      ? {
          at: now,
          nextAt: now + (desk?.nextMin ?? DESK_DEFAULT_GAP) * 60_000,
          say: desk?.say ?? "",
          orders: desk?.orders.size ?? 0,
          skipped,
          ...(answer && "error" in answer ? { error: answer.error.slice(0, 300) } : {}),
          ...(desk ? { brain: desk.brain } : {}),
        }
      : prev.desk,
    trades: [...events.slice().reverse(), ...(prev.trades ?? [])].slice(0, TRADES_KEPT),
    speech: speech.length ? speech : prev.speech,
    speechAt: speech.length ? now : prev.speechAt,
    lastTickAt: now,
    risk,
    feed,
    log,
    marketNotes: { day: prev.day, coins: [...noted] },
    milestones: reached.milestones,
  });
}

/** How healthy the market data is this tick: where prices came from, which have a book, and which are stale or held back. */
export function feedHealth(tape: Tape, ticks: Ticks, now: number, held: string[]): NonNullable<GameState["feed"]> {
  const coins = scanCoins(tape);
  const quotes = coins.map((c) => tape.assets[c]).filter((q) => q && q.usd > 0);
  return {
    at: now,
    source: tape.source,
    listed: coins.length,
    priced: quotes.length,
    kraken: quotes.filter((q) => q!.src === "kraken").length,
    withBook: quotes.filter((q) => q!.bid && q!.ask).length,
    stale: coins.filter((c) => !priceFresh(ticks, c, now)),
    held,
  };
}

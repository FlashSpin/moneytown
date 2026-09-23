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
import { marketCoins, priceOf } from "./dawn";
import { appendTick, seriesOf, type Ticks } from "./indicators";
import { standAt } from "./shops";
import { addLesson } from "./knowledge";
import { DESK_DEFAULT_GAP, tradingDesk, type CouncilSoul, type Desk } from "./llm.server";
import { defaultStrategy, deskStep, tradeStep, type Strategy, type TradeEvent, type Trader } from "./strategies";
import { wanderPoint } from "./town";
import { temperOf } from "./trading";
import type { GameState, SpeechLine, Subject, Tape } from "./types";
import { withTotals } from "./world";
import { formatGbp, mulberry32, satsToGbp, stakeSats, tapeGbp, uid } from "./wallets";

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

/** Every coin a villager may trade right now: the market's, priced. */
export function tradableCoins(tape: Tape): string[] {
  return marketCoins(tape).filter((c) => priceOf(tape, c) > 0);
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
): { subjects: Subject[]; events: TradeEvent[]; speech: SpeechLine[] } {
  const market = marketCoins(tape);
  const universe = tradableCoins(tape);
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
    };
    const px = (coin: string) => priceOf(tape, coin);
    const order = desk?.orders.get(s.id);
    // Its own call at the desk, if it made one that could be carried out; otherwise its strategy trades.
    const own = order ? deskStep(me, order, px, now, stake) : null;
    const step = own?.events.length
      ? { trader: own.trader, fills: own.events }
      : (() => {
          const r = tradeStep(me, px, (coin) => seriesOf(ticks, coin), now, stake, universe);
          return { trader: r.trader, fills: r.event ? [r.event] : [] };
        })();
    const trader = step.trader;
    const event = step.fills[step.fills.length - 1];
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
  return { subjects, events, speech: speech.slice(0, 8) };
}

/** Whether the villagers want to look at the market with the AI this tick (a minute's grace for a late schedule). */
export function deskDue(state: GameState, now: number): boolean {
  if (process.env.TRADING_DESK?.trim().toLowerCase() === "off") return false;
  if (!state.subjects.some(isLiving)) return false;
  return now + 60_000 >= (state.desk?.nextAt ?? 0);
}

/**
 * One trading tick. `memo` carries the desk's answer across retries (the
 * caller re-runs this when the world changed under it) so the AI is asked
 * at most once per tick.
 */
export async function runTradeTick(prev: GameState, memo: { desk?: Desk | null; tape?: Tape } = {}): Promise<GameState> {
  const now = Date.now();
  let tape = memo.tape ?? (await loadTape(coinsNeeded(prev)).catch(() => ({ ...prev.tape, dark: true, source: "dark" })));
  if (tape.dark && !tape.coins) tape = { ...tape, coins: prev.tape.coins };
  // No prices, no trading — but nobody loses their place either.
  if (tape.dark) return { ...prev, lastTickAt: now };
  memo.tape = tape;

  const ticks = appendTick(prev.ticks, now, pricesOf(tape));
  const due = deskDue(prev, now);
  if (due && memo.desk === undefined) {
    memo.desk = await tradingDesk({
      day: prev.day,
      tape,
      ticks,
      kingPlan: prev.council?.kingPlan,
      souls: prev.subjects.filter(isLiving).map((s) => soulFor(s, tape)),
      now,
    }).catch(() => null);
  }
  const desk = due ? memo.desk : null;
  const { subjects, events, speech } = tradeParish({ ...prev, tape }, tape, ticks, now, desk);
  return withTotals({
    ...prev,
    tape,
    ticks,
    subjects,
    desk: due
      ? {
          at: now,
          nextAt: now + (desk?.nextMin ?? DESK_DEFAULT_GAP) * 60_000,
          say: desk?.say ?? "",
          orders: desk?.orders.size ?? 0,
          ...(desk ? { brain: desk.brain } : {}),
        }
      : prev.desk,
    trades: [...events.slice().reverse(), ...(prev.trades ?? [])].slice(0, TRADES_KEPT),
    speech: speech.length ? speech : prev.speech,
    speechAt: speech.length ? now : prev.speechAt,
    lastTickAt: now,
  });
}

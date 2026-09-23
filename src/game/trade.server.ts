/**
 * The trading tick — server-only, every 5 minutes (/api/trade). No AI here:
 * each villager's own strategy (src/game/strategies.ts) reads the live
 * prices and trades by its rules, like an exchange bot. The AI chooses and
 * tunes those strategies at the council (src/game/review.server.ts).
 */
import { loadTape } from "@/lib/tape.server";
import { SHOUT_LIFE } from "./constants";
import { marketCoins, priceOf } from "./dawn";
import { appendTick, seriesOf, type Ticks } from "./indicators";
import { standAt } from "./shops";
import { defaultStrategy, tradeStep, type TradeEvent } from "./strategies";
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

/** Every coin the parish needs priced: the market, open trades, and every watchlist. */
export function coinsNeeded(state: GameState): string[] {
  const out = new Set<string>();
  for (const s of state.subjects) {
    if (s.position) out.add(s.position.coin);
    for (const c of s.strategy?.coins ?? []) out.add(c);
  }
  return [...out];
}

export function pricesOf(tape: Tape): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [coin, info] of Object.entries(tape.assets)) if (info.usd > 0) out[coin] = info.usd;
  return out;
}

/** Run every villager's strategy once against `tape`. Pure apart from the RNG. */
export function tradeParish(
  state: GameState,
  tape: Tape,
  ticks: Ticks,
  now: number,
): { subjects: Subject[]; events: TradeEvent[]; speech: SpeechLine[] } {
  const market = marketCoins(tape);
  const stake = stakeSats(tape);
  const rng = mulberry32(state.seed + Math.floor(now / 60_000));
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(tape)));
  const events: TradeEvent[] = [];
  const speech: SpeechLine[] = [];
  let delay = 0.3;

  const subjects = state.subjects.map((s) => {
    if (!isLiving(s)) return s;
    const strategy = s.strategy ?? defaultStrategy(s.id, s.temper ?? temperOf(s.id), market);
    const { trader, event } = tradeStep(
      {
        id: s.id,
        firstName: s.firstName,
        balance: s.balance,
        strategy,
        position: s.position,
        cooldownUntil: s.cooldownUntil,
        cooldownCoin: s.cooldownCoin,
        record: s.record,
        trades: s.trades,
      },
      (coin) => priceOf(tape, coin),
      (coin) => seriesOf(ticks, coin),
      now,
      stake,
    );
    const next: Subject = {
      ...s,
      strategy,
      balance: trader.balance,
      position: trader.position,
      cooldownUntil: trader.cooldownUntil,
      cooldownCoin: trader.cooldownCoin,
      record: trader.record,
      trades: trader.trades,
      // Mirrors for everything that still reads the simple view of a position.
      side: trader.position?.side ?? "flat",
      asset: trader.position?.coin ?? s.asset,
      size: trader.position ? strategy.sizePct : s.size,
      entryUsd: trader.position?.entryUsd,
    };
    if (!event) return next;
    events.push(event);
    const verb = event.action === "open" ? (event.side === "long" ? "Buying" : "Shorting") : "Closing";
    const tail =
      event.action === "open"
        ? `${event.coin} — ${event.reason}!`
        : `${event.coin}, ${event.pnl! >= 0 ? "+" : "-"}${gbp(Math.abs(event.pnl!))}.`;
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

export async function runTradeTick(prev: GameState): Promise<GameState> {
  const now = Date.now();
  let tape = await loadTape(coinsNeeded(prev)).catch(() => ({ ...prev.tape, dark: true, source: "dark" }));
  if (tape.dark && !tape.coins) tape = { ...tape, coins: prev.tape.coins };
  // No prices, no trading — but nobody loses their place either.
  if (tape.dark) return { ...prev, lastTickAt: now };

  const ticks = appendTick(prev.ticks, now, pricesOf(tape));
  const { subjects, events, speech } = tradeParish({ ...prev, tape }, tape, ticks, now);
  return withTotals({
    ...prev,
    tape,
    ticks,
    subjects,
    trades: [...events.slice().reverse(), ...(prev.trades ?? [])].slice(0, TRADES_KEPT),
    speech: speech.length ? speech : prev.speech,
    speechAt: speech.length ? now : prev.speechAt,
    lastTickAt: now,
  });
}

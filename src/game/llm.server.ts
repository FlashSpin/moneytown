/**
 * The parish's strategy councils — server-only. Two AI calls per review
 * (Gemini, Groq, Claude, Grok, Pollinations — see src/lib/counsel.server.ts):
 *   1. `kingCouncil`: the King reads the markets (price, 1h/4h/24h moves,
 *      RSI, volatility) and every villager's strategy, open trade and
 *      results, and ADVISES each one on its day-trading strategy (at dawn he
 *      also sets the day's tax and favoured coin);
 *   2. `parishCouncil`: the villagers debate among themselves and with the
 *      King, then each CHOOSES and tunes its own strategy.
 * The strategies then trade every 5 minutes without the AI
 * (src/game/trade.server.ts). Each call returns null when no AI answers.
 */
import { askCounsel, type CounselSource } from "@/lib/counsel.server";
import { HANG_BELOW_GBP, RENT_GBP, SHOUT_LIFE, SPEECH_LIFE, TAX_MAX, TAX_MIN } from "./constants";
import { marketCoins, priceOf, type Asset } from "./dawn";
import { trimSpeech } from "./brains";
import { coinStats, seriesOf, type Ticks } from "./indicators";
import { cleanStrategy, FEE_RATE, STRATEGY_INFO, STRATEGY_KINDS, unrealized, type Position, type Strategy } from "./strategies";
import { TEMPER_DESCRIPTIONS, temperOf, type Temper } from "./trading";
import type { BrainInfo, SpeechLine, Tape } from "./types";
import { clamp, formatGbp, satsToGbp, tapeGbp, uid } from "./wallets";

export const BRAIN_LABELS: Record<CounselSource, string> = {
  gemini: "Gemini (free)",
  groq: "Groq (free)",
  claude: "Claude",
  grok: "Grok (online)",
  pollinations: "Free online wits",
};

export type CouncilSoul = {
  id: string;
  firstName: string;
  balance: number;
  /** Purse at the start of the day. */
  dayStart: number;
  temper?: Temper;
  strategy: Strategy;
  position?: Position;
  /** Fills today. */
  trades?: number;
  record?: { wins: number; losses: number; pnl: number };
};

export type Council = {
  say: string;
  advice: Map<string, Strategy>;
  /** Dawn only: next day's tax (fraction) and favoured coin. */
  taxRate?: number;
  favorAsset?: Asset;
  brain: BrainInfo;
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    const cleaned = raw
      .slice(start, end + 1)
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    return JSON.parse(cleaned);
  }
}

/** A coin the market lists and prices right now, or null. */
function asAsset(v: unknown, tape: Tape): Asset | null {
  const s = String(v ?? "").toUpperCase();
  return priceOf(tape, s) > 0 ? s : null;
}

const pct = (n: number | null) => (n === null ? "?" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

function marketsBlock(tape: Tape, ticks: Ticks | undefined): string {
  return marketCoins(tape)
    .map((a, i) => {
      const info = tape.assets[a];
      if (!info || !(info.usd > 0)) return `- ${a}: no price — do not trade it`;
      const s = coinStats(seriesOf(ticks, a));
      const price = info.usd >= 100 ? Math.round(info.usd).toLocaleString("en-US") : info.usd >= 1 ? info.usd.toFixed(2) : info.usd.toPrecision(4);
      return `- #${i + 1} ${a}${info.name && info.name.toUpperCase() !== a ? ` (${info.name})` : ""}: $${price} | 1h ${pct(s.ch1h)} 4h ${pct(
        s.ch4h,
      )} 24h ${pct(info.change24h)} | RSI ${s.rsi === null ? "?" : s.rsi.toFixed(0)} | volatility ${s.vol === null ? "?" : `${s.vol.toFixed(2)}%/5min`}`;
    })
    .join("\n");
}

const MENU = STRATEGY_KINDS.map(
  (k) => `- ${k}: ${STRATEGY_INFO[k].about} (typical take-profit ${STRATEGY_INFO[k].tp}%, stop-loss ${STRATEGY_INFO[k].sl}%)`,
).join("\n");

function describeStrategy(s: Strategy): string {
  return `${s.kind} on ${s.coins.join("/")}, ${Math.round(s.sizePct * 100)}% per trade, TP ${s.takeProfitPct}% SL ${s.stopLossPct}%${
    s.shorts ? ", may short" : ", long only"
  }`;
}

function rosterRows(souls: CouncilSoul[], tape: Tape, gbp: (sats: number) => string): string {
  return souls
    .map((s) => {
      const today = s.balance - s.dayStart;
      const pos = s.position
        ? `OPEN ${s.position.side} ${s.position.coin} (${(() => {
            const u = unrealized(s.position, priceOf(tape, s.position.coin));
            return `${u >= 0 ? "+" : "-"}${gbp(Math.abs(u))}`;
          })()})`
        : "no open trade";
      const rec = s.record ? `${s.record.wins}W/${s.record.losses}L, career ${s.record.pnl >= 0 ? "+" : "-"}${gbp(Math.abs(s.record.pnl))}` : "no record yet";
      return `${s.id} | ${s.firstName} | ${s.temper ?? temperOf(s.id)} | purse ${gbp(s.balance)}, today ${today >= 0 ? "+" : "-"}${gbp(
        Math.abs(today),
      )}, ${s.trades ?? 0} fills | ${pos} | ${rec} | strategy: ${describeStrategy(s.strategy)}${s.strategy.note ? ` — "${s.strategy.note}"` : ""}`;
    })
    .join("\n");
}

const STRATEGY_JSON = `{"id":"...","kind":"${STRATEGY_KINDS.join("|")}","coins":["COIN","COIN"],"size":25,"tp":2,"sl":1.2,"shorts":true`;

function councilPrompt(input: {
  day: number;
  dawn: boolean;
  kingBalance: number;
  taxRate: number;
  favorAsset: Asset;
  favorFixed: boolean;
  taxFixed: boolean;
  tape: Tape;
  ticks?: Ticks;
  souls: CouncilSoul[];
}): string {
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(input.tape)));
  const tax = Math.round(input.taxRate * 100);
  const dawnAsk = input.dawn ? `,"taxRate":${tax},"favorAsset":"a coin symbol from the market list"` : "";
  const dawnRules = input.dawn
    ? `\n- It is dawn: also set taxRate (whole %, ${Math.round(TAX_MIN * 100)}-${Math.round(TAX_MAX * 100)}; taken from each villager's daily PROFIT only)${
        input.taxFixed ? " — fixed by royal decree, repeat it" : ""
      } and favorAsset (your house view)${input.favorFixed ? ` — fixed by royal decree at ${input.favorAsset}, repeat it` : ""}.`
    : "";

  return `Day ${input.day}${input.dawn ? ", dawn" : ", a review during the day"}. You are the KING of Ledgerford and master of its trading house. Every villager is an independent DAY-TRADING bot staked from your treasury. Each runs a strategy that trades automatically every 5 minutes on its own watchlist of 1-3 coins — you and the villagers choose and tune those strategies a few times a day. You ADVISE each villager on its strategy; they then hold a council and each decides.

How the money works:
- Each trade: LONG (gains as the coin rises) or SHORT (gains as it falls), size = % of the purse, closed at the take-profit (TP) or stop-loss (SL) %, by the strategy's own exit, or a time limit. Every fill pays a ${(FEE_RATE * 100).toFixed(1)}% fee, so tiny targets lose money: keep TP well above ${(FEE_RATE * 200).toFixed(1)}%.
- Each dawn: your tax takes ${tax}% of the day's PROFIT only, then £${RENT_GBP} upkeep. A purse below £${HANG_BELOW_GBP} hangs.

The strategies:
${MENU}

Match strategy to market: momentum/breakout/trend when coins trend (big 1h/4h moves), reversion when they chop around (RSI extremes, moves that reverse), scalp only on liquid, steady coins. Pick watchlist coins that suit the strategy (volatile coins for breakouts, big coins for scalps). Size by confidence and the purse's strength: 15-35 normally; weak purses (under £10) no more than 25. Fit each villager's temperament. Give struggling villagers (losing records) a change of approach; leave winning ones alone. Spread the parish across coins and strategies.${
    input.favorFixed ? `\nThe bearer of the royal seal favours ${input.favorAsset}: include it where it fits.` : ""
  }

Markets (5-minute data):
${marketsBlock(input.tape, input.ticks)}
Fear & greed: ${input.tape.fearGreed} (${input.tape.fearGreedLabel}).

Treasury: ${gbp(input.kingBalance)}.
Villagers (id | name | temperament | purse | open trade | record | current strategy):
${rosterRows(input.souls, input.tape, gbp) || "(none)"}

Reply with JSON only:
{"say":"your plan for the parish in one or two Tudor sentences: which coins, which strategies, and why","advice":[${STRATEGY_JSON},"note":"one short Tudor sentence of advice to this villager with the reason"}]${dawnAsk}}
Rules: one piece of advice per villager id above. Never ask for keys. Amounts in pounds.${dawnRules}`;
}

function parseTalks(raw: unknown, ids: Set<string>, rng: () => number): SpeechLine[] {
  if (!Array.isArray(raw)) return [];
  const out: SpeechLine[] = [];
  let delay = 0.25;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { from?: unknown; to?: unknown; shout?: unknown; text?: unknown };
    const from = String(r.from ?? "");
    if (from !== "king" && !ids.has(from)) continue;
    let to = r.to == null || r.to === "" || r.to === "null" ? null : String(r.to);
    if (to && to !== "king" && !ids.has(to)) to = null;
    const text = trimSpeech(String(r.text ?? ""));
    if (!text) continue;
    const shout = Boolean(r.shout) || (to == null && text.length > 48);
    out.push({
      id: uid("t", rng),
      fromId: from,
      toId: shout ? null : to,
      text,
      shout,
      age: -delay,
      life: shout ? SHOUT_LIFE : SPEECH_LIFE,
      heard: false,
      logged: false,
    });
    delay += shout ? 3.1 : 2.2;
    if (out.length >= 8) break;
  }
  return out;
}

/** The AI's strategies per villager, tidied (known ids, known kinds, listed coins, sane numbers). */
function parseStrategies(raw: unknown, souls: CouncilSoul[], tape: Tape): Map<string, Strategy & { followsKing?: boolean }> {
  const out = new Map<string, Strategy & { followsKing?: boolean }>();
  if (!Array.isArray(raw)) return out;
  const byId = new Map(souls.map((s) => [s.id, s]));
  const market = marketCoins(tape).filter((c) => priceOf(tape, c) > 0);
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const soul = byId.get(String(r.id ?? ""));
    if (!soul || out.has(soul.id)) continue;
    out.set(soul.id, { ...cleanStrategy(r, soul.strategy, market), followsKing: r.followsKing !== false });
  }
  return out;
}

export async function kingCouncil(input: Parameters<typeof councilPrompt>[0]): Promise<Council | null> {
  try {
    const res = await askCounsel(councilPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as {
      say?: unknown;
      advice?: unknown;
      orders?: unknown;
      taxRate?: unknown;
      favorAsset?: unknown;
    };
    const taxN = Number(obj.taxRate);
    return {
      say: String(obj.say ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
      advice: parseStrategies(obj.advice ?? obj.orders, input.souls, input.tape),
      taxRate: input.dawn && Number.isFinite(taxN) ? clamp(taxN > 1 ? taxN / 100 : taxN, TAX_MIN, TAX_MAX) : undefined,
      favorAsset: input.dawn ? (asAsset(obj.favorAsset, input.tape) ?? undefined) : undefined,
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

// ── The villagers' council: they debate, then each chooses its strategy ─────

export type ParishCouncil = {
  decisions: Map<string, Strategy & { followsKing?: boolean }>;
  /** The debate, in order, for the town's speech bubbles and the council transcript. */
  talks: SpeechLine[];
  brain: BrainInfo;
};

function parishPrompt(input: {
  day: number;
  tape: Tape;
  ticks?: Ticks;
  kingPlan: string;
  advice: Map<string, Strategy>;
  souls: CouncilSoul[];
}): string {
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(input.tape)));
  const people = input.souls
    .map((s) => {
      const temper = s.temper ?? temperOf(s.id);
      const a = input.advice.get(s.id);
      return `${s.id} | ${s.firstName}, ${TEMPER_DESCRIPTIONS[temper]} | King advises: ${a ? `${describeStrategy(a)}${a.note ? ` — "${a.note}"` : ""}` : "keep as you are"}`;
    })
    .join("\n");
  return `Day ${input.day}. You voice the villagers of Ledgerford at their trading council. Each villager is an INDEPENDENT day-trading bot with its own temperament; its strategy trades automatically every 5 minutes. Each has just heard the King's advice and reads the markets for itself.

The strategies:
${MENU}
Every fill pays a ${(FEE_RATE * 100).toFixed(1)}% fee.

Markets (5-minute data):
${marketsBlock(input.tape, input.ticks)}
Fear & greed: ${input.tape.fearGreed} (${input.tape.fearGreedLabel}).

The King's plan: "${input.kingPlan}"

The villagers, their standing, open trades, results and current strategies:
${rosterRows(input.souls, input.tape, gbp)}

What each has been advised:
${people}

Hold the council:
1. A short debate (4-8 lines) between villagers and with the King ("king" may reply). Talk real strategy: cite prices, 1h/4h moves, RSI and volatility above; say what's been working (their fills and records) and what hasn't; agree or push back on the King; plan together so the parish isn't all on one coin or one strategy.
2. Then EACH villager chooses its OWN strategy in character: keep what works, change what doesn't. Following the King is sensible, but a villager may choose differently if its temperament, record or reading of the market gives it a reason — say why.
Rules: coins from the market list only, 1-3 per villager; size is % of the purse per trade (10-100; weak purses under £10 no more than 25); take-profit well above the fees. Period English, plain about the trading. Never ask for keys.

Reply with JSON only:
{"discussion":[{"from":"villager id or king","to":"villager id, king or null","text":"one line"}],"decisions":[${STRATEGY_JSON},"plan":"first-person reason, one sentence","followsKing":true}]}`;
}

export async function parishCouncil(input: Parameters<typeof parishPrompt>[0]): Promise<ParishCouncil | null> {
  try {
    const res = await askCounsel(parishPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as { discussion?: unknown; talk?: unknown; decisions?: unknown };
    const ids = new Set(input.souls.map((s) => s.id));
    return {
      decisions: parseStrategies(obj.decisions, input.souls, input.tape),
      talks: parseTalks(obj.discussion ?? obj.talk, ids, Math.random),
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

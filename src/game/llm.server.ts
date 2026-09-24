/**
 * The parish's strategy councils — server-only. Two AI calls per review
 * (Gemini, Groq, Claude, Grok, Pollinations — see src/lib/counsel.server.ts):
 *   1. `kingCouncil`: the King reads the markets (price, 1h/4h/24h moves,
 *      RSI, volatility) and every villager's strategy, open trade and
 *      results, and ADVISES each one on its day-trading strategy (at dawn he
 *      also sets the day's tax and favoured coin);
 *   2. `parishCouncil`: the villagers debate among themselves and with the
 *      King, then each CHOOSES and tunes its own strategy.
 * The strategies then trade every 5 minutes (src/game/trade.server.ts), and
 * between councils `tradingDesk` lets the villagers look at the market with
 * the AI and place, switch or close their own trades whenever they choose —
 * they also say when they next want to look. Every call shows each villager
 * what it has learned (src/game/knowledge.ts) and asks it for a lesson, so
 * it builds on its experience. Each call returns null when no AI answers.
 */
import { askCounsel, counselDiagnostics, type CounselSource } from "@/lib/counsel.server";
import { HANG_BELOW_GBP, RENT_GBP, SHOUT_LIFE, SPEECH_LIFE, TAX_MAX, TAX_MIN } from "./constants";
import { marketCoins, priceOf, scanCoins, type Asset } from "./dawn";
import { trimSpeech } from "./brains";
import { coinStats, seriesOf, type Ticks } from "./indicators";
import { describeKnowledge, type Knowledge } from "./knowledge";
import { MAX_RISK, MIN_EDGE, TRADING_COST_PCT } from "./risk";
import { describe as describeGenome, type PoolEntry } from "./lab";
import {
  BAR_LABEL,
  cleanStrategy,
  coinsLabel,
  genesOf,
  FEE_RATE,
  STRATEGY_INFO,
  STRATEGY_KINDS,
  unrealized,
  type DeskOrder,
  type Position,
  type Strategy,
} from "./strategies";
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
  knowledge?: Knowledge;
};

/** A strategy the council chose, with the villager's stance and what it has learned. */
export type Choice = Strategy & { followsKing?: boolean; lesson?: string };

export type Council = {
  say: string;
  advice: Map<string, Choice>;
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
  const stalls = marketCoins(tape).length;
  return scanCoins(tape)
    .map((a, i) => {
      const info = tape.assets[a];
      if (!info || !(info.usd > 0)) return `- ${a}: no price — do not trade it`;
      const s = coinStats(seriesOf(ticks, a));
      const price = info.usd >= 100 ? Math.round(info.usd).toLocaleString("en-US") : info.usd >= 1 ? info.usd.toFixed(2) : info.usd.toPrecision(4);
      return `${i === stalls ? "(beyond the town's stalls, also tradable:)\n" : ""}- #${i + 1} ${a}${info.name && info.name.toUpperCase() !== a ? ` (${info.name})` : ""}: $${price} | 1h ${pct(s.ch1h)} 4h ${pct(
        s.ch4h,
      )} 24h ${pct(info.change24h)} | RSI ${s.rsi === null ? "?" : s.rsi.toFixed(0)} | volatility ${s.vol === null ? "?" : `${s.vol.toFixed(2)}%/5min`}`;
    })
    .join("\n");
}

/** The crowd's mood: fear & greed, and the coins most searched for right now. */
function sentimentLine(tape: Tape): string {
  const listed = new Set(scanCoins(tape));
  const trending = (tape.trending ?? []).map((c) => (listed.has(c) ? c : `${c} (not tradable here)`));
  return `Crowd sentiment: fear & greed ${tape.fearGreed} (${tape.fearGreedLabel}); trending searches: ${
    trending.length ? trending.join(", ") : "unknown"
  }. Hype can mean momentum — or a crowded trade about to reverse.`;
}

const SIZING = `Sizing is automatic and learned: every trade is sized by the Kelly criterion from the villager's own win rate (half-Kelly), and no trade may lose more than ${Math.round(
  MAX_RISK * 100,
)}% of the purse at its stop-loss; a losing approach shrinks to tiny stakes until it proves itself. "size" is only the most the villager is willing to stake.`;

const MENU = STRATEGY_KINDS.map(
  (k) => `- ${k}: ${STRATEGY_INFO[k].about} (typical take-profit ${STRATEGY_INFO[k].tp}%, stop-loss ${STRATEGY_INFO[k].sl}%)`,
).join("\n");

/**
 * The guild book for the councils: the lab's strategies that held up on data
 * they never saw, best first. A villager given one by id trades its tuned
 * genes and targets.
 */
function bookBlock(book: PoolEntry[] | undefined): string {
  const open = (book ?? []).filter((e) => !e.retired && (e.proven || (e.val.ret > 0 && e.test.ret > 0))).slice(0, 8);
  if (!open.length) return "";
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const rows = open.map((e) => {
    const live = e.live?.trades ? `; live ${e.live.trades} trades, avg ${pct(e.live.sum / e.live.trades)} a trade` : "";
    return `- ${e.id}${e.proven ? " (PROVEN)" : ""}: ${describeGenome(e)} — unseen test ${pct(e.test.ret)} over ${e.test.trades} trades, win ${Math.round(e.test.winRate * 100)}%${live}`;
  });
  return `\nThe guild book — strategies bred by the strategy lab on months of real prices and judged on data they never saw (PROVEN = made money on every slice and with higher costs). To train a villager in one, give its id as "genome" (its genes and targets come with it; your tp/sl are then ignored). Prefer them for struggling villagers; leave winners be:\n${rows.join("\n")}\n`;
}

function describeStrategy(s: Strategy): string {
  const book = s.genome ? ` [guild book ${s.genome.book ?? s.genome.id}, ${BAR_LABEL[genesOf(s).bar]} bars]` : "";
  return `${s.kind}${book} on ${coinsLabel(s)}, ${Math.round(s.sizePct * 100)}% per trade, TP ${s.takeProfitPct}% SL ${s.stopLossPct}%${
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
      )}, ${s.trades ?? 0} fills | ${pos} | ${rec} | strategy: ${describeStrategy(s.strategy)}${s.strategy.note ? ` — "${s.strategy.note}"` : ""}
    learned: ${describeKnowledge(s.knowledge, gbp)}`;
    })
    .join("\n");
}

const STRATEGY_JSON = `{"id":"...","genome":"a guild book id (optional)","kind":"${STRATEGY_KINDS.join("|")}","coins":"all" or ["COIN",...],"size":25,"tp":2,"sl":1.2,"shorts":true`;

const COIN_RULE =
  'coins: "all" (recommended — the strategy scans every coin in the market each tick and takes the strongest signal, skipping coins the villager has learned lose it money) or a focus list of any market coins';

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
  book?: PoolEntry[];
}): string {
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(input.tape)));
  const tax = Math.round(input.taxRate * 100);
  const dawnAsk = input.dawn ? `,"taxRate":${tax},"favorAsset":"a coin symbol from the market list"` : "";
  const dawnRules = input.dawn
    ? `\n- It is dawn: also set taxRate (whole %, ${Math.round(TAX_MIN * 100)}-${Math.round(TAX_MAX * 100)}; taken from each villager's daily PROFIT only)${
        input.taxFixed ? " — fixed by royal decree, repeat it" : ""
      } and favorAsset (your house view)${input.favorFixed ? ` — fixed by royal decree at ${input.favorAsset}, repeat it` : ""}.`
    : "";

  return `Day ${input.day}${input.dawn ? ", dawn" : ", a review during the day"}. You are the KING of Ledgerford and master of its trading house. Every villager is an independent DAY-TRADING bot staked from your treasury. Each runs a strategy that trades automatically every 5 minutes across EVERY coin in the market (or the coins it focuses on); between councils each may also place its own trades at the trading desk whenever it chooses. Each villager remembers how every trade went — by coin, by approach, long vs short — and keeps written lessons: build on them. You ADVISE each villager on its strategy; they then hold a council and each decides.

How the money works:
- Each trade: LONG (gains as the coin rises) or SHORT (gains as it falls), size = % of the purse, closed at the take-profit (TP) or stop-loss (SL) %, by the strategy's own exit, or a time limit. Orders fill like a real exchange's: buys at the ask, sells at the bid, plus slippage, and every fill pays a ${(FEE_RATE * 100).toFixed(1)}% fee — a round trip costs about ${TRADING_COST_PCT.toFixed(2)}%, so tiny targets lose money: keep TP well above ${(TRADING_COST_PCT * 2).toFixed(1)}%. Orders below the exchange's minimum size are rejected, so tiny purses can't trade every coin.
- Each dawn: your tax takes ${tax}% of the day's PROFIT only, then £${RENT_GBP} upkeep. A purse below £${HANG_BELOW_GBP} hangs.

The strategies:
${MENU}
${bookBlock(input.book)}
Match strategy to market: momentum/breakout/trend when coins trend (big 1h/4h moves), reversion when they chop around (RSI extremes, moves that reverse), scalp only on liquid, steady coins. ${COIN_RULE}; focus only when the villager's own record or the market gives a clear reason. Learn from each villager's record: steer it towards the coins and approaches that have paid it and away from those that haven't. ${SIZING} Fit each villager's temperament. Give struggling villagers (losing records) a change of approach; leave winning ones alone. Spread the parish across coins and strategies.${
    input.favorFixed ? `\nThe bearer of the royal seal favours ${input.favorAsset}: include it where it fits.` : ""
  }

Markets (5-minute data):
${marketsBlock(input.tape, input.ticks)}
${sentimentLine(input.tape)}

Treasury: ${gbp(input.kingBalance)}.
Villagers (id | name | temperament | purse | open trade | record | current strategy, then what it has learned):
${rosterRows(input.souls, input.tape, gbp) || "(none)"}

Reply with JSON only:
{"say":"your plan for the parish in one or two Tudor sentences: which coins, which strategies, and why","advice":[${STRATEGY_JSON},"note":"one short Tudor sentence of advice to this villager with the reason","lesson":"one plain sentence this villager should remember from its trades so far (empty if nothing new)"}]${dawnAsk}}
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
function parseStrategies(raw: unknown, souls: CouncilSoul[], tape: Tape, book: PoolEntry[] = []): Map<string, Choice> {
  const out = new Map<string, Choice>();
  if (!Array.isArray(raw)) return out;
  const byId = new Map(souls.map((s) => [s.id, s]));
  const market = scanCoins(tape).filter((c) => priceOf(tape, c) > 0);
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const soul = byId.get(String(r.id ?? ""));
    if (!soul || out.has(soul.id)) continue;
    const lesson = typeof r.lesson === "string" ? r.lesson.trim() : "";
    out.set(soul.id, { ...cleanStrategy(r, soul.strategy, market, book), followsKing: r.followsKing !== false, ...(lesson ? { lesson } : {}) });
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
      advice: parseStrategies(obj.advice ?? obj.orders, input.souls, input.tape, input.book),
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
  decisions: Map<string, Choice>;
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
  book?: PoolEntry[];
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
${bookBlock(input.book)}
Every fill pays a ${(FEE_RATE * 100).toFixed(1)}% fee plus the spread and slippage (about ${TRADING_COST_PCT.toFixed(2)}% a round trip).

Markets (5-minute data):
${marketsBlock(input.tape, input.ticks)}
${sentimentLine(input.tape)}

The King's plan: "${input.kingPlan}"

The villagers, their standing, open trades, results and current strategies:
${rosterRows(input.souls, input.tape, gbp)}

What each has been advised:
${people}

Hold the council:
1. A short debate (4-8 lines) between villagers and with the King ("king" may reply). Talk real strategy: cite prices, 1h/4h moves, RSI and volatility above; say what's been working (their fills, records and what each has learned) and what hasn't; agree or push back on the King; plan together so the parish isn't all on one coin or one strategy.
2. Then EACH villager chooses its OWN strategy in character, building on what it has learned: keep what works, change what doesn't, and write down one new lesson. Following the King is sensible, but a villager may choose differently if its temperament, record or reading of the market gives it a reason — say why.
${SIZING}
Rules: ${COIN_RULE}; size is the most % of the purse per trade (10-100; weak purses under £10 no more than 25); take-profit well above the fees. Period English, plain about the trading. Never ask for keys.

Reply with JSON only:
{"discussion":[{"from":"villager id or king","to":"villager id, king or null","text":"one line"}],"decisions":[${STRATEGY_JSON},"plan":"first-person reason, one sentence","followsKing":true,"lesson":"one plain sentence it has learned from its own trades (empty if nothing new)"}]}`;
}

export async function parishCouncil(input: Parameters<typeof parishPrompt>[0]): Promise<ParishCouncil | null> {
  try {
    const res = await askCounsel(parishPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as { discussion?: unknown; talk?: unknown; decisions?: unknown };
    const ids = new Set(input.souls.map((s) => s.id));
    return {
      decisions: parseStrategies(obj.decisions, input.souls, input.tape, input.book),
      talks: parseTalks(obj.discussion ?? obj.talk, ids, Math.random),
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

// ── The trading desk: the villagers' own calls, whenever they want ─────────

export type Desk = {
  say: string;
  orders: Map<string, DeskOrder>;
  lessons: Map<string, string>;
  /** When they want to look again, in minutes. */
  nextMin: number;
  brain: BrainInfo;
};

export const DESK_MIN_GAP = 5;
export const DESK_MAX_GAP = 60;
export const DESK_DEFAULT_GAP = 15;

function deskPrompt(input: { day: number; tape: Tape; ticks?: Ticks; kingPlan?: string; souls: CouncilSoul[]; now: number }): string {
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(input.tape)));
  const held = input.souls
    .filter((s) => s.position)
    .map((s) => {
      const p = s.position!;
      const px = priceOf(input.tape, p.coin);
      const move = px > 0 ? (((px - p.entryUsd) / p.entryUsd) * 100 * (p.side === "long" ? 1 : -1)).toFixed(2) : "?";
      const mins = Math.round((input.now - p.openedAt) / 60_000);
      return `${s.id}: ${p.side} ${p.coin} ${move}% after ${mins} min${p.own ? ` (its own trade: TP ${p.own.tp}% SL ${p.own.sl}%)` : ` (from its ${p.by ?? s.strategy.kind} strategy)`}`;
    })
    .join("\n");
  return `Day ${input.day}. The TRADING DESK of Ledgerford. Each villager below is an independent day-trading bot with its own temperament. Its strategy already trades automatically every 5 minutes across every coin; here each villager may ALSO act on its own judgement right now: buy (long), short, close its trade, or hold (let its strategy carry on). Each villager holds at most one trade; buying or shorting while holding another trade switches (two fills). Every fill pays a ${(FEE_RATE * 100).toFixed(1)}% fee and crosses the spread (about ${TRADING_COST_PCT.toFixed(2)}% a round trip), so only act on a real edge — holding is usually right, and churning loses money.

How a call is judged: give your honest "chance" (%) that the trade reaches its take-profit before its stop-loss. Break-even chance = (sl + ${TRADING_COST_PCT.toFixed(2)}) / (tp + sl). A call only goes ahead when its chance beats break-even by at least ${Math.round(
    MIN_EDGE * 100,
  )} points — the trade must look clearly mispriced — and each villager's chances are checked against how its past calls actually went (over-confident villagers get marked down). The stake is then sized by the Kelly criterion, never risking more than ${Math.round(
    MAX_RISK * 100,
  )}% of the purse at the stop. Be calibrated, not hopeful.

Markets (5-minute data):
${marketsBlock(input.tape, input.ticks)}
${sentimentLine(input.tape)}
${input.kingPlan ? `\nThe King's plan: "${input.kingPlan}"\n` : ""}
The villagers (id | name | temperament | purse | open trade | record | strategy, then what it has learned):
${rosterRows(input.souls, input.tape, gbp)}

Open trades right now:
${held || "(none)"}

Decide, in character, for each villager that has a reason to act — build on what it has learned (its best and worst coins, which approaches pay it, its lessons). Also decide when the desk should next look at the market: sooner when things are moving fast or trades need watching, later when it's quiet.

Reply with JSON only:
{"say":"one Tudor sentence on the desk's view","orders":[{"id":"villager id","action":"buy|short|close|hold","coin":"COIN (buy/short only)","chance":62,"tp":2.5,"sl":1.2,"hours":4,"size":100,"why":"short first-person reason citing the numbers"}],"lessons":[{"id":"villager id","lesson":"one plain sentence it has learned (only when there is something new)"}],"nextMinutes":${DESK_DEFAULT_GAP}}
Rules: coins from the market list only; chance in % (buy/short only); size = the most % of the purse to stake (5-100, optional); tp/sl in % (tp well above the fees); hours = how long at most to hold (0.25-48). nextMinutes ${DESK_MIN_GAP}-${DESK_MAX_GAP}. Omit villagers who hold.`;
}

function parseOrders(raw: unknown, souls: CouncilSoul[], tape: Tape): Map<string, DeskOrder> {
  const out = new Map<string, DeskOrder>();
  if (!Array.isArray(raw)) return out;
  const ids = new Set(souls.map((s) => s.id));
  const num = (v: unknown) => {
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "");
    if (!ids.has(id) || out.has(id)) continue;
    const act = String(r.action ?? "").toLowerCase();
    const action = act === "buy" || act === "long" ? "buy" : act === "short" || act === "sell short" ? "short" : act === "close" || act === "sell" ? "close" : null;
    if (!action) continue;
    const why = String(r.why ?? r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (action === "close") {
      out.set(id, { action, why });
      continue;
    }
    const coin = asAsset(r.coin, tape);
    if (!coin) continue;
    const size = num(r.size ?? r.sizePct);
    const chance = num(r.chance ?? r.probability ?? r.p);
    out.set(id, {
      action,
      coin,
      chance: chance === undefined ? undefined : chance > 1 ? chance / 100 : chance,
      sizePct: size === undefined ? undefined : size > 1 ? size / 100 : size,
      tp: num(r.tp ?? r.takeProfit),
      sl: num(r.sl ?? r.stopLoss),
      hours: num(r.hours),
      why,
    });
  }
  return out;
}

function parseLessons(raw: unknown, souls: CouncilSoul[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  const ids = new Set(souls.map((s) => s.id));
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; lesson?: unknown };
    const id = String(r.id ?? "");
    const lesson = String(r.lesson ?? "").trim();
    if (ids.has(id) && lesson) out.set(id, lesson);
  }
  return out;
}

/** Why the free AI didn't answer, from each free provider's latest attempt (no keys in it). */
function freeAiReport(): string {
  return counselDiagnostics()
    .filter((r) => r.provider === "gemini" || r.provider === "groq")
    .map((r) => `${r.provider}: ${r.configured ? (r.last ?? "not tried") : "no key"}`)
    .join("; ");
}

/**
 * The villagers look at the market with the (free) AI and place their own
 * trades. When no AI answers usefully, says why (`error`).
 */
export async function tradingDesk(input: Parameters<typeof deskPrompt>[0]): Promise<Desk | { error: string }> {
  let text = "";
  try {
    const res = await askCounsel(deskPrompt(input), { freeOnly: true });
    if (!res.ok || !res.text.trim()) return { error: `no free AI answered — ${freeAiReport()}` };
    text = res.text;
    const obj = extractJson(res.text) as { say?: unknown; orders?: unknown; lessons?: unknown; nextMinutes?: unknown };
    const next = Number(obj.nextMinutes);
    return {
      say: String(obj.say ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      orders: parseOrders(obj.orders, input.souls, input.tape),
      lessons: parseLessons(obj.lessons, input.souls),
      nextMin: Number.isFinite(next) ? clamp(Math.round(next), DESK_MIN_GAP, DESK_MAX_GAP) : DESK_DEFAULT_GAP,
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch (error) {
    const reply = text.replace(/\s+/g, " ").trim().slice(0, 80);
    return { error: `unreadable reply (${error instanceof Error ? error.message : "error"})${reply ? `: ${reply}` : ""}` };
  }
}

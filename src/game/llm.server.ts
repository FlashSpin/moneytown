/**
 * The guild's strategy councils — server-only. Two AI calls per council
 * (Gemini, Groq, Claude, Grok, Pollinations — see src/lib/counsel.server.ts):
 *   1. `kingCouncil`: the King reads the market board (every fund's latest
 *      close, its day and year, and whether it is above its 200-day average)
 *      and each merchant's ISA — worth, results against a 60/40, strategy —
 *      and ADVISES each one on its investing strategy (at dawn he also sets
 *      the guild's dues and his favoured fund);
 *   2. `parishCouncil`: the merchants debate among themselves and with the
 *      King, then each CHOOSES its own strategy and writes down a lesson.
 * Strategies come from the guild's menu (./guild.ts PRESETS) and its book of
 * lab-tested strategies (./merchant.ts). Each call returns null when no AI
 * answers; the merchants then keep what they have.
 */
import { askCounsel, type CounselSource } from "@/lib/counsel.server";
import { SHOUT_LIFE, SPEECH_LIFE, TAX_MAX, TAX_MIN } from "./constants";
import { trimSpeech } from "./brains";
import { PRESETS, PRESET_BY_ID, strategyLabel, type GuildStrategy } from "./guild";
import { describeM, fixM, FUND_IDS, FUNDS, type FundId, type MEntry } from "./merchant";
import { TEMPER_DESCRIPTIONS, type Temper } from "./trading";
import type { Board, BrainInfo, SpeechLine } from "./types";
import { clamp, money, uid } from "./wallets";

export const BRAIN_LABELS: Record<CounselSource, string> = {
  gemini: "Gemini (free)",
  groq: "Groq (free)",
  claude: "Claude",
  grok: "Grok (online)",
  pollinations: "Free online wits",
};

/** How a merchant looks to the councils. */
export type CouncilSoul = {
  id: string;
  firstName: string;
  temper: Temper;
  worth: number;
  start: number;
  /** Its return since it began, and the 60/40's over the same days (null before its first market day). */
  ret: number | null;
  bench: number | null;
  days: number;
  strategy: GuildStrategy;
  /** "SPY 40%, IEF 30%, cash 30%". */
  holdings: string;
  lessons?: string[];
};

/** A strategy the council chose, with the merchant's stance and what it has learned. */
export type Choice = { strategy: GuildStrategy; note?: string; followsKing?: boolean; lesson?: string };

export type Council = {
  say: string;
  advice: Map<string, Choice>;
  /** Dawn only: the guild's dues (fraction) and the favoured fund. */
  taxRate?: number;
  favorAsset?: FundId;
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

const pct = (n: number | null | undefined) => (n == null ? "?" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);

function boardBlock(board: Board | undefined): string {
  if (!board) return "(no prices yet — the market board fills after the next close)";
  return FUND_IDS.map((f) => {
    const q = board.funds[f];
    if (!q) return `- ${f} ${FUNDS[f].name}: no price`;
    return `- ${f} ${FUNDS[f].name}: day ${pct(q.change1d)}, year ${pct(q.change1y)}, ${q.above200 === undefined ? "trend unknown" : q.above200 ? "ABOVE" : "below"} its 200-day average`;
  }).join("\n");
}

/** The menu: the guild's presets, then the lab's best strategies (proven first). */
function menuBlock(book: MEntry[] | undefined): string {
  const presets = PRESETS.map((p) => `- ${p.id}: ${p.label} — ${p.about}`).join("\n");
  const lab = (book ?? []).slice(0, 5);
  const labRows = lab.length
    ? `\nFrom the guild's lab (tested on ~20 years of prices; PROVEN = beat a 60/40 on risk-adjusted return on data it never saw):\n${lab
        .map((e) => `- ${e.id}${e.proven ? " (PROVEN)" : ""}: ${describeM(e)}; unseen test ${pct(e.test.cagr)}/yr, worst fall ${pct(-e.test.maxDd)}`)
        .join("\n")}`
    : "";
  return presets + labRows;
}

function rosterRows(souls: CouncilSoul[]): string {
  return souls
    .map((s) => {
      const result = s.ret === null ? "not yet invested" : `${pct(s.ret)} since it began vs the 60/40's ${pct(s.bench)} over ${s.days} market days`;
      return `${s.id} | ${s.firstName} | ${s.temper} | worth ${money(s.worth)} (staked ${money(s.start)}) | ${result} | strategy: ${strategyLabel(s.strategy)} | holds: ${s.holdings || "cash"}${
        s.lessons?.length ? `\n    learned: ${s.lessons.slice(-2).join(" / ")}` : ""
      }`;
    })
    .join("\n");
}

/** A strategy id from the menu, turned into the strategy itself (null if unknown). */
export function resolveStrategy(id: unknown, book: MEntry[] | undefined): GuildStrategy | null {
  const key = String(id ?? "").trim();
  const p = PRESET_BY_ID.get(key);
  if (p) return { genome: p.genome, preset: p.id };
  const e = (book ?? []).find((x) => x.id === key);
  return e ? { genome: fixM(e), book: e.id } : null;
}

const STRATEGY_JSON = `{"id":"villager id","strategy":"a strategy id from the menu","note":"one short Tudor sentence with the reason"}`;

const WISDOM = `How to judge: over the long run shares have beaten bonds and cash, but they can fall by half; bonds and gold have often held up when shares fell; trading costs a little every time, so changing strategy often loses money. A merchant who is ahead of the 60/40 should usually keep its strategy. A merchant well behind it over many days may deserve a different one. Spread the guild across different strategies so it never all falls at once.`;

function councilPrompt(input: {
  day: number;
  dawn: boolean;
  kingBalance: number;
  taxRate: number;
  favorAsset: FundId;
  favorFixed: boolean;
  taxFixed: boolean;
  board?: Board;
  souls: CouncilSoul[];
  book?: MEntry[];
}): string {
  const dues = Math.round(input.taxRate * 100);
  const dawnAsk = input.dawn ? `,"taxRate":${dues},"favorAsset":"a fund symbol"` : "";
  const dawnRules = input.dawn
    ? `\n- It is dawn: also set taxRate (the guild's dues, a whole % of each merchant's gain over a season, ${Math.round(TAX_MIN * 100)}-${Math.round(TAX_MAX * 100)})${
        input.taxFixed ? " — fixed by royal decree, repeat it" : ""
      } and favorAsset (your house view, one of ${FUND_IDS.join(", ")})${input.favorFixed ? ` — fixed by royal decree at ${input.favorAsset}, repeat it` : ""}.`
    : "";
  return `Day ${input.day}. You are the KING of Ledgerford and master of its Merchant guild. Every villager is a merchant with a stocks & shares ISA staked from your treasury, invested in index funds by one strategy, checked weekly to quarterly. Orders are decided after a day's close and filled at the next close; every trade costs 0.2%. Each season the guild is judged on whether it grew more than a plain 60/40 of shares and bonds. You ADVISE each merchant on its strategy; they then hold a council and each decides.

${WISDOM}

The strategy menu (give the id):
${menuBlock(input.book)}

The market board (latest close):
${boardBlock(input.board)}

Treasury: ${money(input.kingBalance)}. Dues: ${dues}% of each merchant's season gain.
Merchants (id | name | temperament | worth | results | strategy | holdings):
${rosterRows(input.souls) || "(none)"}

Reply with JSON only:
{"say":"your plan for the guild in one or two Tudor sentences","advice":[${STRATEGY_JSON}]${dawnAsk}}
Rules: one piece of advice per merchant id above; the strategy must be an id from the menu. Never ask for keys. Amounts in pounds.${dawnRules}`;
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
    out.push({ id: uid("t", rng), fromId: from, toId: shout ? null : to, text, shout, age: -delay, life: shout ? SHOUT_LIFE : SPEECH_LIFE, heard: false, logged: false });
    delay += shout ? 3.1 : 2.2;
    if (out.length >= 8) break;
  }
  return out;
}

/** The AI's strategy per merchant, tidied: known merchants, strategies from the menu. */
function parseChoices(raw: unknown, souls: CouncilSoul[], book: MEntry[] | undefined): Map<string, Choice> {
  const out = new Map<string, Choice>();
  if (!Array.isArray(raw)) return out;
  const byId = new Map(souls.map((s) => [s.id, s]));
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const soul = byId.get(String(r.id ?? ""));
    if (!soul || out.has(soul.id)) continue;
    const strategy = resolveStrategy(r.strategy ?? r.preset ?? r.genome, book) ?? soul.strategy;
    const note = typeof r.note === "string" ? r.note.replace(/\s+/g, " ").trim().slice(0, 200) : typeof r.plan === "string" ? r.plan.slice(0, 200) : undefined;
    const lesson = typeof r.lesson === "string" ? r.lesson.trim().slice(0, 200) : "";
    out.set(soul.id, { strategy, ...(note ? { note } : {}), followsKing: r.followsKing !== false, ...(lesson ? { lesson } : {}) });
  }
  return out;
}

export async function kingCouncil(input: Parameters<typeof councilPrompt>[0]): Promise<Council | null> {
  try {
    const res = await askCounsel(councilPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as { say?: unknown; advice?: unknown; taxRate?: unknown; favorAsset?: unknown };
    const taxN = Number(obj.taxRate);
    const fav = String(obj.favorAsset ?? "").toUpperCase() as FundId;
    return {
      say: String(obj.say ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
      advice: parseChoices(obj.advice, input.souls, input.book),
      taxRate: input.dawn && Number.isFinite(taxN) ? clamp(taxN > 1 ? taxN / 100 : taxN, TAX_MIN, TAX_MAX) : undefined,
      favorAsset: input.dawn && FUND_IDS.includes(fav) ? fav : undefined,
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

// ── The merchants' council: they debate, then each chooses its strategy ─────

export type ParishCouncil = {
  decisions: Map<string, Choice>;
  /** The debate, in order, for the town's speech bubbles and the council transcript. */
  talks: SpeechLine[];
  brain: BrainInfo;
};

function parishPrompt(input: { day: number; board?: Board; kingPlan: string; advice: Map<string, GuildStrategy & { note?: string }>; souls: CouncilSoul[]; book?: MEntry[] }): string {
  const people = input.souls
    .map((s) => {
      const a = input.advice.get(s.id);
      return `${s.id} | ${s.firstName}, ${TEMPER_DESCRIPTIONS[s.temper]} | King advises: ${a ? `${strategyLabel(a)}${a.note ? ` — "${a.note}"` : ""}` : "keep as you are"}`;
    })
    .join("\n");
  return `Day ${input.day}. You voice the merchants of Ledgerford at their guild council. Each merchant runs its own stocks & shares ISA with one investing strategy; each has just heard the King's advice and reads the markets for itself.

${WISDOM}

The strategy menu (give the id):
${menuBlock(input.book)}

The market board (latest close):
${boardBlock(input.board)}

The King's plan: "${input.kingPlan}"

The merchants and their results:
${rosterRows(input.souls)}

What each has been advised:
${people}

Hold the council:
1. A short debate (4-8 lines) between merchants and with the King ("king" may reply). Talk real investing: cite the funds' moves and trends above, who is ahead of or behind the 60/40, and why; agree or push back on the King.
2. Then EACH merchant chooses its OWN strategy from the menu, in character: keep what works, change what clearly doesn't, and write down one new lesson.
Period English, plain about the investing. Never ask for keys.

Reply with JSON only:
{"discussion":[{"from":"villager id or king","to":"villager id, king or null","text":"one line"}],"decisions":[${STRATEGY_JSON.replace("}", ',"followsKing":true,"lesson":"one plain sentence it has learned"}')}]}`;
}

export async function parishCouncil(input: Parameters<typeof parishPrompt>[0]): Promise<ParishCouncil | null> {
  try {
    const res = await askCounsel(parishPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as { discussion?: unknown; talk?: unknown; decisions?: unknown };
    const ids = new Set(input.souls.map((s) => s.id));
    return {
      decisions: parseChoices(obj.decisions, input.souls, input.book),
      talks: parseTalks(obj.discussion ?? obj.talk, ids, Math.random),
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

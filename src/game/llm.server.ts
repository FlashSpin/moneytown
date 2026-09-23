/**
 * The parish's trading councils — server-only. Two AI calls per review
 * (Gemini, Groq, Claude, Grok, Pollinations — see src/lib/counsel.server.ts):
 *   1. `kingCouncil`: the King reads the markets, their recent trend and
 *      every villager's purse, temperament and record, and ADVISES each one
 *      (at dawn he also sets the day's tax and favoured market);
 *   2. `parishCouncil`: the villagers debate strategy with each other and the
 *      King, then each DECIDES its own trade — following the King or not.
 * Each returns null when no AI answers; the caller falls back to the rules
 * in src/game/trading.ts.
 */
import { askCounsel, type CounselSource } from "@/lib/counsel.server";
import { HANG_BELOW_GBP, RENT_GBP, SHOUT_LIFE, SPEECH_LIFE, TAX_MAX, TAX_MIN } from "./constants";
import { ASSETS, type Asset, type Side } from "./dawn";
import { trimSpeech } from "./brains";
import { clampSize, TEMPER_DESCRIPTIONS, temperOf, trendPct, type Order, type PriceSample, type Temper } from "./trading";
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
  side?: Side;
  asset?: Asset;
  size?: number;
  /** P&L of the open position since it was last marked (sats). */
  openPnl: number;
  temper?: Temper;
  /** The villager's own reasoning for its current trade. */
  plan?: string;
  record?: { wins: number; losses: number; pnl: number };
};

export type Council = {
  say: string;
  orders: Map<string, Order>;
  talks: SpeechLine[];
  /** Dawn only: next day's tax (fraction) and favoured market. */
  taxRate?: number;
  favorAsset?: Asset;
  brain: BrainInfo;
};

const SIDES: Side[] = ["long", "short", "flat"];

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

function asSide(v: unknown): Side | null {
  const s = String(v ?? "").toLowerCase();
  return SIDES.includes(s as Side) ? (s as Side) : null;
}

function asAsset(v: unknown): Asset | null {
  const s = String(v ?? "").toUpperCase();
  return (ASSETS as string[]).includes(s) ? (s as Asset) : null;
}

function marketsBlock(tape: Tape, history: PriceSample[]): string {
  return ASSETS.map((a) => {
    const info = tape.assets[a];
    if (!(info.usd > 0)) return `- ${a}: no price today — do not trade it`;
    const trend = trendPct(history, a, info.usd);
    const span = history.length ? `${Math.round((Date.now() - history[0]!.t) / 3_600_000)}h` : "";
    const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
    return `- ${a}: $${Math.round(info.usd).toLocaleString("en-US")}, 24h ${sign(info.change24h)}${
      trend !== null && span ? `, over the last ${span} ${sign(trend)}` : ""
    }`;
  }).join("\n");
}

function rosterRows(souls: CouncilSoul[], gbp: (sats: number) => string): string {
  return souls
    .map((s) => {
      const today = s.balance - s.dayStart;
      const pos = s.side && s.side !== "flat" ? `${s.side} ${s.asset} at ${Math.round(clampSize(s.size) * 100)}%` : "flat";
      const rec = s.record ? `${s.record.wins}W/${s.record.losses}L, career ${s.record.pnl >= 0 ? "+" : "-"}${gbp(Math.abs(s.record.pnl))}` : "no record yet";
      return `${s.id} | ${s.firstName} | ${s.temper ?? temperOf(s.id)} | purse ${gbp(s.balance)} | today ${today >= 0 ? "+" : "-"}${gbp(
        Math.abs(today),
      )} | holding ${pos}${s.side && s.side !== "flat" ? ` (last move ${s.openPnl >= 0 ? "+" : "-"}${gbp(Math.abs(s.openPnl))})` : ""} | ${rec}${
        s.plan ? ` | own plan: "${s.plan}"` : ""
      }`;
    })
    .join("\n");
}

function councilPrompt(input: {
  day: number;
  dawn: boolean;
  kingBalance: number;
  taxRate: number;
  favorAsset: Asset;
  favorFixed: boolean;
  taxFixed: boolean;
  tape: Tape;
  history: PriceSample[];
  souls: CouncilSoul[];
}): string {
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(input.tape)));
  const tax = Math.round(input.taxRate * 100);
  const rows = rosterRows(input.souls, gbp);
  const dawnAsk = input.dawn
    ? `,"taxRate":${tax},"favorAsset":"BTC|ETH|SOL"`
    : "";
  const dawnRules = input.dawn
    ? `\n- It is dawn: also set taxRate (whole %, ${Math.round(TAX_MIN * 100)}-${Math.round(TAX_MAX * 100)}; it is taken from each villager's daily PROFIT only, so a fair rate fills the treasury without starving them)${
        input.taxFixed ? " — the tax is fixed by royal decree, repeat it" : ""
      } and favorAsset (your house view for the day)${input.favorFixed ? ` — fixed by royal decree at ${input.favorAsset}, repeat it` : ""}.`
    : "";

  return `Day ${input.day}${input.dawn ? ", dawn" : ", a review during the day"}. You are the KING of Ledgerford and master of its trading house. Every villager is an independent trading agent staked from your treasury, with its own temperament. Every few hours you study the markets and ADVISE each villager; they then hold a council, debate your advice, and each decides its own trade — most follow you, some will not.

How the money works:
- A position is LONG (gains when the asset rises), SHORT (gains when it falls) or FLAT (no risk), on BTC, ETH or SOL.
- size = share of the purse at risk (10-100). P&L = purse x size x price move. Each review re-marks positions at the current price.
- Each dawn: your tax takes ${tax}% of the day's PROFIT only (nothing on a losing day), then £${RENT_GBP} upkeep. A purse below £${HANG_BELOW_GBP} hangs.

Your goal: grow the parish's total wealth while keeping every soul alive. Advise like a disciplined master, fitting each villager's temperament and record:
- Follow clear trends; don't fight them. If nothing moves decisively, go FLAT or small — sitting out costs only the upkeep.
- Cut positions that are losing against the trend; let winners run (keep them unchanged).
- Size by conviction: 20-40 normally, up to 60 only on a strong, confirmed trend. Weak purses (under £10) no more than 25.
- Spread the parish across assets when conviction is similar; don't put every soul on one bet.
- Don't flip positions on noise — every change should have a reason.${
    input.favorFixed ? `\n- The bearer of the royal seal favours ${input.favorAsset}: lean towards it where the trend allows.` : ""
  }

Markets:
${marketsBlock(input.tape, input.history)}
Fear & greed: ${input.tape.fearGreed} (${input.tape.fearGreedLabel}).${input.tape.dark ? " The price tape is DARK today — order everyone FLAT." : ""}

Treasury: ${gbp(input.kingBalance)}.
Villagers (id | name | temperament | purse | today's P&L | current position | record | own plan):
${rows || "(none)"}

Reply with JSON only:
{"say":"your plan for the parish, one or two Tudor sentences naming the markets and why","orders":[{"id":"...","side":"long|short|flat","asset":"BTC|ETH|SOL","size":30,"note":"one short Tudor sentence of advice to this villager with the reason"}]${dawnAsk}}
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

/** Validate the AI's orders: known ids only, known sides and assets, sizes clamped, no trading an unpriced asset. */
function parseOrders(raw: unknown, ids: Set<string>, tape: Tape): Map<string, Order> {
  const orders = new Map<string, Order>();
  if (!Array.isArray(raw)) return orders;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; side?: unknown; asset?: unknown; size?: unknown; note?: unknown };
    const id = String(r.id ?? "");
    if (!ids.has(id) || orders.has(id)) continue;
    const side = asSide(r.side);
    if (!side) continue;
    const asset = asAsset(r.asset) ?? "BTC";
    const priced = tape.assets[asset].usd > 0 && !tape.dark;
    orders.set(id, {
      side: priced ? side : "flat",
      asset,
      size: clampSize(r.size),
      note: String(r.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    });
  }
  return orders;
}

export async function kingCouncil(input: Parameters<typeof councilPrompt>[0]): Promise<Council | null> {
  try {
    const res = await askCounsel(councilPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as {
      say?: unknown;
      orders?: unknown;
      talk?: unknown;
      talks?: unknown;
      taxRate?: unknown;
      favorAsset?: unknown;
    };
    const ids = new Set(input.souls.map((s) => s.id));
    const taxN = Number(obj.taxRate);
    return {
      say: String(obj.say ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
      orders: parseOrders(obj.orders, ids, input.tape),
      talks: [],
      taxRate: input.dawn && Number.isFinite(taxN) ? clamp(taxN > 1 ? taxN / 100 : taxN, TAX_MIN, TAX_MAX) : undefined,
      favorAsset: input.dawn ? (asAsset(obj.favorAsset) ?? undefined) : undefined,
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

// ── The villagers' council: they debate, then each decides for itself ──────

export type ParishDecision = Order & { followsKing: boolean };
export type ParishCouncil = {
  decisions: Map<string, ParishDecision>;
  /** The debate, in order, for the town's speech bubbles and the council transcript. */
  talks: SpeechLine[];
  brain: BrainInfo;
};

function parishPrompt(input: {
  day: number;
  tape: Tape;
  history: PriceSample[];
  kingPlan: string;
  advice: Map<string, Order>;
  souls: CouncilSoul[];
}): string {
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(input.tape)));
  const people = input.souls
    .map((s) => {
      const temper = s.temper ?? temperOf(s.id);
      const a = input.advice.get(s.id);
      const adv = a ? `${a.side} ${a.asset} at ${Math.round(a.size * 100)}% — "${a.note}"` : "no advice";
      return `${s.id} | ${s.firstName}, ${TEMPER_DESCRIPTIONS[temper]} | King advises: ${adv}`;
    })
    .join("\n");
  return `Day ${input.day}. You voice the villagers of Ledgerford at their trading council. Each villager is an INDEPENDENT trader with its own temperament; each has just heard the King's advice and now reads the live markets for itself.

Markets:
${marketsBlock(input.tape, input.history)}
Fear & greed: ${input.tape.fearGreed} (${input.tape.fearGreedLabel}).${input.tape.dark ? " The price tape is DARK — nobody can trade; everyone stays FLAT." : ""}

The King's plan: "${input.kingPlan}"

The villagers, their standing and records:
${rosterRows(input.souls, gbp)}

What each has been advised:
${people}

Hold the council:
1. A short debate (4-8 lines) between villagers and with the King ("king" may reply). They discuss real strategy: cite the prices and moves above, agree or push back on the King's plan, compare notes on what has worked (their records), and plan together — e.g. who takes which market so the parish isn't all on one bet.
2. Then EACH villager decides its OWN trade in character. Following the King is sensible, but a villager may disagree if its temperament, its record or the markets give it a reason — say why.
Rules: size is % of the purse at risk (10-100); weak purses (under £10) risk no more than 25; no trading an asset with no price. Stay in period English, but speak plainly about the trades. Never ask for keys.

Reply with JSON only:
{"discussion":[{"from":"villager id or king","to":"villager id, king or null","text":"one line"}],"decisions":[{"id":"...","side":"long|short|flat","asset":"BTC|ETH|SOL","size":30,"plan":"first-person reason, one sentence","followsKing":true}]}`;
}

export async function parishCouncil(input: Parameters<typeof parishPrompt>[0]): Promise<ParishCouncil | null> {
  try {
    const res = await askCounsel(parishPrompt(input));
    if (!res.ok || !res.text.trim()) return null;
    const obj = extractJson(res.text) as { discussion?: unknown; talk?: unknown; decisions?: unknown };
    const ids = new Set(input.souls.map((s) => s.id));
    const orders = parseOrders(
      Array.isArray(obj.decisions)
        ? obj.decisions.map((d) => (d && typeof d === "object" ? { ...(d as object), note: (d as { plan?: unknown }).plan } : d))
        : [],
      ids,
      input.tape,
    );
    const follows = new Map<string, boolean>();
    for (const d of Array.isArray(obj.decisions) ? obj.decisions : []) {
      if (d && typeof d === "object") follows.set(String((d as { id?: unknown }).id), (d as { followsKing?: unknown }).followsKing !== false);
    }
    const decisions = new Map<string, ParishDecision>();
    for (const [id, o] of orders) decisions.set(id, { ...o, followsKing: follows.get(id) ?? true });
    return {
      decisions,
      talks: parseTalks(obj.discussion ?? obj.talk, ids, Math.random),
      brain: { kind: res.source, label: BRAIN_LABELS[res.source] },
    };
  } catch {
    return null;
  }
}

/**
 * AI counsel for the daily tick — server-only. Everyone (King and every
 * villager) shares one fixed cascade: Grok, then free Pollinations, then the
 * caller's own heuristic fallback (this module never invents a decision
 * itself; `counselDawn` returns null on total failure). There is no more
 * per-soul model choice — that was a player-facing control, now removed —
 * and no local-model backends (Ollama/LM Studio/on-device), which only ever
 * made sense from a visitor's own browser, not a server cron.
 */
import { askGrokCounsel } from "@/lib/counsel.server";
import { RENT_GBP, SHOUT_LIFE, SPEECH_LIFE, TAX_MAX, TAX_MIN } from "./constants";
import { ASSETS, type Asset, type Side } from "./dawn";
import { trimSpeech } from "./brains";
import type { BrainInfo, SpeechLine, SubjectAction, Tape } from "./types";
import { clamp, formatGbp, satsToGbp, tapeGbp, uid } from "./wallets";

export type KingCounsel = {
  say: string;
  favorAsset: Asset;
  taxRate: number;
};

export type SubjectCounsel = {
  id: string;
  action: SubjectAction;
  side: Side;
  asset: Asset;
  say: string;
};

export type DawnCounsel = {
  king: KingCounsel;
  subjects: SubjectCounsel[];
  talks: SpeechLine[];
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

function asSubAction(v: unknown): SubjectAction {
  if (v === "earn" || v === "work") return "earn";
  if (v === "walk" || v === "petition") return "walk";
  return "idle";
}

function asSide(v: unknown): Side {
  return SIDES.includes(v as Side) ? (v as Side) : "flat";
}

function asAsset(v: unknown): Asset {
  return (ASSETS as string[]).includes(v as string) ? (v as Asset) : "BTC";
}

/** Falls back to the previous day's rate on anything missing/invalid. */
function asTaxRate(v: unknown, prevRate: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return prevRate;
  return clamp(n / 100, TAX_MIN, TAX_MAX);
}

function gbp(sats: number, tape: Tape): string {
  return formatGbp(satsToGbp(sats, tapeGbp(tape)));
}

function marketsLine(tape: Tape): string {
  return ASSETS.map((a) => {
    const info = tape.assets[a];
    const sign = info.change24h >= 0 ? "+" : "";
    return `${a} $${Math.round(info.usd).toLocaleString("en-US")} ${sign}${info.change24h.toFixed(1)}%`;
  }).join(" · ");
}

type SubjectRow = { id: string; firstName: string; balance: number };

function counselPrompt(input: {
  day: number;
  kingBalance: number;
  taxRate: number;
  cap: number;
  tape: Tape;
  role: "king" | "agent";
  kingFavorAsset?: Asset;
  subjects: SubjectRow[];
}): string {
  const tape = input.tape;
  const rows = input.subjects.map((s) => `${s.id}|${s.firstName}|purse ${gbp(s.balance, tape)}`).join("\n");
  const tax = Math.round(input.taxRate * 100);
  const markets = marketsLine(tape);
  const subjectSchema = `{"id":"...","action":"earn|idle|walk","side":"long|short|flat","asset":"BTC|ETH|SOL","say":"one Tudor sentence"}`;
  const talkSchema = `{"from":"subject id","to":"subject id or king or null","shout":false,"text":"short Tudor speech"}`;
  if (input.role === "agent") {
    return `Day ${input.day}. You are the LINKED AI AGENT thinking for these Ledgerford souls. Each soul trades ONE crypto asset long, short, or flat — this is their real trade, and their whole purse moves with that asset's real price by the next dawn. Choose with care: pick recklessly and they can be wiped out and hang; pick well and they prosper. The King's tax is ${tax}%. Daily upkeep is £${RENT_GBP} from the purse. If they cannot pay the tax they hang. No keys. Amounts in pounds.
Markets (usd, 24h): ${markets}
Your King favors ${input.kingFavorAsset ?? "BTC"} today — weigh it, but think for yourself.
Souls (id|name|purse):
${rows || "(none)"}
JSON:
{"subjects":[${subjectSchema}],"talk":[${talkSchema}]}
Rules: side/asset is each soul's real trade for the coming dawn — never default to flat without reason. action is flavor only (earn = work, idle/walk = rest). Talk 2-5 lines — let souls discuss which asset looks promising and why, debating strategy with each other. Never ask for keys. JSON only.`;
  }
  return `Day ${input.day}. You are the KING AI of Ledgerford — in command of the parish's linked agents. The crown treasury opens new souls by a fixed rule in code, not by your choice, and only while the parish is earning. You set the parish's market policy (favor ONE asset today; your linked agents weigh your favor but still think for themselves) AND the tithe rate (0-${Math.round(TAX_MAX * 100)}%, whole percent — set it to keep the treasury healthy without hanging the whole parish). King purse ${gbp(input.kingBalance, tape)}. Daily upkeep £${RENT_GBP}. Cap ${input.cap}.
Markets (usd, 24h): ${markets}
Souls (id|name|purse):
${rows || "(none)"}
JSON:
{"king":{"say":"one Tudor sentence — command them to trade wisely","favorAsset":"BTC|ETH|SOL","taxRate":0},"subjects":[${subjectSchema}],"talk":[${talkSchema}]}
Rules: side/asset is each soul's real trade for the coming dawn. Talk 3-6 lines — let the parish debate which asset looks promising. Never claim to spawn or move money yourself. Never ask for keys. Amounts in pounds. JSON only.`;
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

function parseCounsel(
  raw: unknown,
  ids: string[],
  prevTaxRate: number,
  rng: () => number,
): { king: KingCounsel; subjects: SubjectCounsel[]; talks: SpeechLine[] } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as {
    king?: { say?: unknown; favorAsset?: unknown; taxRate?: unknown };
    subjects?: { id?: unknown; action?: unknown; side?: unknown; asset?: unknown; say?: unknown }[];
    talk?: unknown;
    talks?: unknown;
  };
  const king: KingCounsel = {
    say: String(obj.king?.say ?? "The King holds his peace. His treasury opens souls by rule."),
    favorAsset: asAsset(obj.king?.favorAsset),
    taxRate: asTaxRate(obj.king?.taxRate, prevTaxRate),
  };
  const byId = new Map((obj.subjects ?? []).map((s) => [String(s.id), s]));
  const subjects: SubjectCounsel[] = ids.map((id) => {
    const row = byId.get(id);
    return {
      id,
      action: asSubAction(row?.action),
      side: asSide(row?.side),
      asset: asAsset(row?.asset),
      say: String(row?.say ?? ""),
    };
  });
  const talks = parseTalks(obj.talk ?? obj.talks, new Set(ids), rng);
  return { king, subjects, talks };
}

/** Grok, then free Pollinations. Both are plain server-to-server HTTPS calls. */
async function decide(prompt: string): Promise<{ text: string; brain: BrainInfo }> {
  const res = await askGrokCounsel(prompt);
  if (res.ok && res.text.trim()) {
    const brain: BrainInfo =
      res.source === "pollinations"
        ? { kind: "pollinations", label: "Free online wits" }
        : { kind: "grok", label: "Grok (online)" };
    return { text: res.text, brain };
  }
  throw new Error(res.ok ? "empty reply" : res.error);
}

export async function counselDawn(input: {
  day: number;
  kingBalance: number;
  taxRate: number;
  cap: number;
  tape: Tape;
  role: "king" | "agent";
  kingFavorAsset?: Asset;
  subjects: SubjectRow[];
}): Promise<DawnCounsel | null> {
  try {
    const prompt = counselPrompt(input);
    const { text, brain } = await decide(prompt);
    const parsed = parseCounsel(
      extractJson(text),
      input.subjects.map((s) => s.id),
      input.taxRate,
      Math.random,
    );
    return { ...parsed, brain };
  } catch {
    return null;
  }
}

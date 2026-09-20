import { askCounsel } from "@/lib/counsel";
import { RENT_GBP, SHOUT_LIFE, SPEECH_LIFE } from "./constants";
import type { Side } from "./dawn";
import { trimSpeech } from "./brains";
import type {
  BrainCatalog,
  BrainChoice,
  BrainInfo,
  SpeechLine,
  SubjectAction,
  Tape,
} from "./types";
import { formatGbp, satsToGbp, tapeGbp, uid } from "./wallets";

export type { BrainInfo };

export type KingCounsel = {
  say: string;
};

export type SubjectCounsel = {
  id: string;
  action: SubjectAction;
  side: Side;
  say: string;
};

export type DawnCounsel = {
  king: KingCounsel;
  subjects: SubjectCounsel[];
  talks: SpeechLine[];
  brain: BrainInfo;
};

export type BrainSpec = {
  choice: BrainChoice;
  model: string;
};

const SIDES: Side[] = ["long", "short", "flat"];

const SYSTEM = "JSON only. Tudor market-town wits. No markdown. No jobs. No keys.";

type ChatMsg = { role: "system" | "user"; content: string };

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

async function chatOpenAi(
  url: string,
  model: string,
  messages: ChatMsg[],
  timeoutMs: number,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`openai-compat ${res.status}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? "";
}

async function chatOllamaNative(model: string, messages: ChatMsg[]): Promise<string> {
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, format: "json" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const body = (await res.json()) as { message?: { content?: string } };
  return body.message?.content ?? "";
}

export async function listOllama(): Promise<string[]> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(400),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

export async function listLmStudio(): Promise<string[]> {
  try {
    const res = await fetch("http://127.0.0.1:1234/v1/models", {
      signal: AbortSignal.timeout(400),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id?: string }[] };
    return (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

type ChromeLM = {
  availability: () => Promise<string>;
  create: () => Promise<{ prompt: (s: string) => Promise<string> }>;
};

function chromeLM(): ChromeLM | null {
  const w = window as unknown as { LanguageModel?: ChromeLM; ai?: { languageModel?: ChromeLM } };
  return w.LanguageModel ?? w.ai?.languageModel ?? null;
}

async function chatChrome(prompt: string): Promise<string> {
  const api = chromeLM();
  if (!api) throw new Error("no chrome ai");
  const avail = await api.availability();
  if (avail !== "available" && avail !== "readily") throw new Error(`chrome ai ${avail}`);
  const session = await api.create();
  return session.prompt(`${SYSTEM}\n\n${prompt}`);
}

async function chromeReady(): Promise<boolean> {
  const api = chromeLM();
  if (!api) return false;
  try {
    const avail = await api.availability();
    return avail === "available" || avail === "readily";
  } catch {
    return false;
  }
}

export async function scanCatalog(): Promise<BrainCatalog> {
  const [ollama, lmstudio, chrome] = await Promise.all([
    listOllama(),
    listLmStudio(),
    chromeReady(),
  ]);
  return { ollama, lmstudio, chrome };
}

export function choiceLabel(choice: BrainChoice, model: string, catalog: BrainCatalog): string {
  if (choice === "auto") return "Auto — local, then Grok";
  if (choice === "ollama") return model ? `Ollama · ${model}` : "Ollama";
  if (choice === "lmstudio") return model ? `LM Studio · ${model}` : "LM Studio";
  if (choice === "chrome") return "On-device model";
  if (choice === "grok") return "Grok (online)";
  if (choice === "pollinations") return "Free online wits";
  if (choice === "heuristic") return "Heuristic (period English)";
  return catalog.chrome ? "On-device model" : "Wits";
}

function gbp(sats: number, tape: Tape): string {
  return formatGbp(satsToGbp(sats, tapeGbp(tape)));
}

function counselPrompt(input: {
  day: number;
  kingBalance: number;
  taxRate: number;
  cap: number;
  tape: Tape;
  role: "king" | "agent";
  subjects: {
    id: string;
    firstName: string;
    testBalance: number;
    walletMode: string;
    chainBalance: number | null;
    agent: string;
  }[];
}): string {
  const tape = input.tape;
  const rows = input.subjects
    .map(
      (s) =>
        `${s.id}|${s.firstName}|purse ${gbp(s.testBalance, tape)}|${s.walletMode}|chain ${s.chainBalance == null ? "—" : gbp(s.chainBalance, tape)}|agent ${s.agent}`,
    )
    .join("\n");
  const tax = Math.round(input.taxRate * 100);
  if (input.role === "agent") {
    return `Day ${input.day}. You are the LINKED AI AGENT thinking for these Ledgerford souls. You must think, and they must make money ONLINE for their own wallet. The game pays no wage. Never invent in-game income. The King's tax is ${tax}%. Daily upkeep is £${RENT_GBP} from the test purse. If they cannot pay the tax they hang. No keys. On-chain is watch-only. Amounts in pounds.
Souls (id|name|purse|mode|chain|agent):
${rows || "(none)"}
JSON:
{"subjects":[{"id":"...","action":"earn|idle|walk","side":"flat","say":"one Tudor sentence"}],"talk":[{"from":"subject id","to":"subject id or king or null","shout":false,"text":"short Tudor speech"}]}
Rules: earn = work ONLINE. idle/walk = rest. Never ask for keys. Talk 2-5 lines. JSON only.`;
  }
  return `Day ${input.day}. You are the KING AI of Ledgerford. The crown treasury opens new souls by a fixed rule in code, not by your choice, and only while the parish is earning. You command those already made. King purse ${gbp(input.kingBalance, tape)}. Tithe ${tax}% is set by the PLAYER — never change it. Daily upkeep £${RENT_GBP}. Cap ${input.cap}.
Souls (id|name|purse|mode|chain|agent):
${rows || "(none)"}
JSON:
{"king":{"say":"one Tudor sentence — command them to earn online"},"subjects":[{"id":"...","action":"earn|idle|walk","side":"flat","say":"one Tudor sentence"}],"talk":[{"from":"king or subject id","to":"subject id or king or null","shout":false,"text":"short Tudor speech"}]}
Rules: The game pays NO wage. Never invent in-game income. earn = work ONLINE. Money grows only if a real on-chain watch increases, or a tester edits the Test purse. If they cannot pay the King's tax they hang. Never claim to spawn or move money yourself. Never ask for keys. Talk 3-6 lines. Amounts in pounds. JSON only.`;
}

function parseTalks(
  raw: unknown,
  ids: Set<string>,
  rng: () => number,
): SpeechLine[] {
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
  rng: () => number,
): { king: KingCounsel; subjects: SubjectCounsel[]; talks: SpeechLine[] } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as {
    king?: { action?: unknown; say?: unknown };
    subjects?: { id?: unknown; action?: unknown; side?: unknown; say?: unknown }[];
    talk?: unknown;
    talks?: unknown;
  };
  const king: KingCounsel = {
    say: String(obj.king?.say ?? "The King holds his peace. His treasury opens souls by rule."),
  };
  const byId = new Map((obj.subjects ?? []).map((s) => [String(s.id), s]));
  const subjects: SubjectCounsel[] = ids.map((id) => {
    const row = byId.get(id);
    return {
      id,
      action: asSubAction(row?.action),
      side: asSide(row?.side),
      say: String(row?.say ?? ""),
    };
  });
  const talks = parseTalks(obj.talk ?? obj.talks, new Set(ids), rng);
  return { king, subjects, talks };
}

async function tryOllama(prompt: string, model: string): Promise<{ text: string; brain: BrainInfo } | null> {
  const names = model ? [model] : await listOllama();
  const pick = names[0];
  if (!pick) return null;
  const messages: ChatMsg[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];
  try {
    const text = await chatOpenAi(
      "http://127.0.0.1:11434/v1/chat/completions",
      pick,
      messages,
      10000,
    );
    if (text.trim()) return { text, brain: { kind: "ollama", label: `Ollama · ${pick}` } };
  } catch {
    /* native chat next */
  }
  try {
    const text = await chatOllamaNative(pick, messages);
    if (text.trim()) return { text, brain: { kind: "ollama", label: `Ollama · ${pick}` } };
  } catch {
    return null;
  }
  return null;
}

async function tryLm(prompt: string, model: string): Promise<{ text: string; brain: BrainInfo } | null> {
  const names = model ? [model] : await listLmStudio();
  const pick = names[0];
  if (!pick) return null;
  try {
    const text = await chatOpenAi(
      "http://127.0.0.1:1234/v1/chat/completions",
      pick,
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      10000,
    );
    if (!text.trim()) return null;
    return { text, brain: { kind: "lmstudio", label: `LM Studio · ${pick}` } };
  } catch {
    return null;
  }
}

async function tryChrome(prompt: string): Promise<{ text: string; brain: BrainInfo } | null> {
  if (!(await chromeReady())) return null;
  const text = await chatChrome(prompt);
  return { text, brain: { kind: "chrome", label: "On-device model" } };
}

async function tryOnline(
  prompt: string,
  prefer: "grok" | "pollinations" | "any",
): Promise<{ text: string; brain: BrainInfo } | null> {
  const grok = await askCounsel({ data: { prompt, prefer } });
  if (grok.ok && grok.text.trim()) {
    if ("source" in grok && grok.source === "pollinations") {
      return { text: grok.text, brain: { kind: "pollinations", label: "Free online wits" } };
    }
    return { text: grok.text, brain: { kind: "grok", label: "Grok (online)" } };
  }
  return null;
}

async function complete(
  prompt: string,
  spec: BrainSpec,
): Promise<{ text: string; brain: BrainInfo }> {
  const run = async (choice: BrainChoice, model: string) => {
    if (choice === "heuristic") throw new Error("heuristic");
    if (choice === "ollama") return tryOllama(prompt, model);
    if (choice === "lmstudio") return tryLm(prompt, model);
    if (choice === "chrome") return tryChrome(prompt);
    if (choice === "grok") return tryOnline(prompt, "grok");
    if (choice === "pollinations") return tryOnline(prompt, "pollinations");
    return null;
  };

  if (spec.choice !== "auto" && spec.choice !== "heuristic") {
    try {
      const hit = await run(spec.choice, spec.model);
      if (hit?.text.trim()) return hit;
    } catch {
      /* fall through to compatible cascade */
    }
  }
  if (spec.choice === "heuristic") throw new Error("heuristic");

  const cascade: Array<() => Promise<{ text: string; brain: BrainInfo } | null>> = [
    () => tryOllama(prompt, spec.choice === "auto" ? spec.model : ""),
    () => tryLm(prompt, spec.choice === "auto" ? spec.model : ""),
    () => tryChrome(prompt),
    () => tryOnline(prompt, "any"),
  ];
  for (const step of cascade) {
    try {
      const hit = await step();
      if (hit?.text.trim()) return hit;
    } catch {
      /* next compatible backend */
    }
  }
  throw new Error("no llm");
}

export async function counselDawn(
  input: {
    day: number;
    kingBalance: number;
    taxRate: number;
    cap: number;
    tape: Tape;
    role: "king" | "agent";
    subjects: {
      id: string;
      firstName: string;
      testBalance: number;
      walletMode: string;
      chainBalance: number | null;
      agent: string;
    }[];
  },
  spec: BrainSpec,
): Promise<DawnCounsel | null> {
  try {
    const prompt = counselPrompt(input);
    const { text, brain } = await complete(prompt, spec);
    const parsed = parseCounsel(
      extractJson(text),
      input.subjects.map((s) => s.id),
      Math.random,
    );
    return { ...parsed, brain };
  } catch {
    return null;
  }
}

export type TalkReply = { say: string; shout: boolean; brain: BrainInfo };

function parseTalkReply(text: string): { say: string; shout: boolean } {
  try {
    const obj = extractJson(text) as { say?: unknown; shout?: unknown; text?: unknown };
    const say = trimSpeech(String(obj.say ?? obj.text ?? ""));
    if (say) return { say, shout: Boolean(obj.shout) };
  } catch {
    /* plain speech */
  }
  const say = trimSpeech(text.replace(/```[\s\S]*?```/g, "").replace(/^\s*\{[\s\S]*\}\s*$/, "").trim());
  return { say: say || "I hear thee.", shout: false };
}

export async function counselTalk(
  input: {
    king: boolean;
    name: string;
    testBalance: number;
    playerText: string;
    shout: boolean;
    taxRate: number;
    day: number;
    tape: Tape;
    agentLabel: string;
  },
  spec: BrainSpec,
): Promise<TalkReply | null> {
  const role = input.king
    ? "the King AI of Ledgerford. The treasury opens new souls by fixed rule, not by you. You command those already made"
    : `${input.name}, a villager of Ledgerford whose linked agent is ${input.agentLabel}`;
  const purse = gbp(input.testBalance, input.tape);
  const prompt = `You are ${role} in a 16th-century English market town. Day ${input.day}. Purse ${purse}. The King's tax is ${Math.round(input.taxRate * 100)}%, set by the player. You must make money ONLINE for this wallet — the game pays no wage — or the tax hangs you. No keys. On-chain is watch-only. Test purses are editable only in Test mode. Speak in pounds.
The player ${input.shout ? "shouts to the parish" : "says"}: "${input.playerText.slice(0, 240)}"
JSON only: {"say":"one or two short Tudor sentences in character","shout":${input.shout ? "true" : "false"}}`;
  try {
    const { text, brain } = await complete(prompt, spec);
    const parsed = parseTalkReply(text);
    if (!parsed.say) return null;
    return { ...parsed, brain };
  } catch {
    return null;
  }
}



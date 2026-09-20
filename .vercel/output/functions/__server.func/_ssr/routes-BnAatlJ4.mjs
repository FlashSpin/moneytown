import { i as __toESM } from "../_runtime.mjs";
import { R as require_react, v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { a as ScrollText, c as Crown, i as Sun, l as Coins, n as UserPlus, o as Plus, s as Minus, t as Wallet } from "../_libs/lucide-react.mjs";
import { t as create } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BnAatlJ4.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var ctx = null;
function ac() {
	if (typeof window === "undefined") return null;
	if (!ctx) {
		const Ctor = window.AudioContext || window.webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	return ctx;
}
function unlockAudio() {
	const c = ac();
	if (c?.state === "suspended") c.resume();
}
function beep(freq, dur, type, gain = .05, slide) {
	const c = ac();
	if (!c) return;
	const t = c.currentTime;
	const o = c.createOscillator();
	const g = c.createGain();
	o.type = type;
	o.frequency.setValueAtTime(freq, t);
	if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
	g.gain.setValueAtTime(gain, t);
	g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
	o.connect(g);
	g.connect(c.destination);
	o.start(t);
	o.stop(t + dur + .02);
}
function playGive() {
	beep(660, .08, "triangle", .04);
	beep(880, .12, "triangle", .035);
}
function playDawn() {
	beep(392, .18, "sine", .05);
	beep(523, .28, "sine", .04);
}
function playHang() {
	beep(160, .22, "sawtooth", .04, 90);
	beep(110, .7, "triangle", .035, 48);
	beep(70, .9, "sine", .028, 36);
}
function playTalk() {
	beep(620, .07, "triangle", .025);
}
function playShout() {
	beep(220, .22, "square", .03, 160);
	beep(330, .28, "triangle", .022);
}
function playSpawn() {
	beep(520, .1, "square", .03);
	beep(780, .16, "square", .025);
}
var SAVE_KEY = "ledgerford-save-v7";
var RENT_GBP = 1.5;
var TAX_MAX = .6;
var TAX_DEFAULT = .2;
var TAX_STEP = .01;
var SATS_PER_BTC = 1e8;
var MAP_W = 1792;
var MAP_H = 1008;
var SPEECH_LIFE = 5.4;
var SHOUT_LIFE = 7.2;
var MEN_NAMES = [
	"Hugh",
	"Thomas",
	"Will",
	"Robin",
	"Geoffrey",
	"Edmund",
	"Piers",
	"Nicholas",
	"Oswald",
	"Cuthbert",
	"Giles",
	"Lambert",
	"Ralph",
	"Simon"
];
var WOMEN_NAMES = [
	"Agnes",
	"Joan",
	"Margery",
	"Alice",
	"Cecily",
	"Isabel",
	"Edith",
	"Maud",
	"Beatrice",
	"Winifred",
	"Lettice",
	"Dorothy",
	"Rose",
	"Ellen"
];
var FALLBACK_TAPE = {
	btcUsd: 1e5,
	btcGbp: 74e3,
	change24h: 0,
	fearGreed: 50,
	fearGreedLabel: "Neutral",
	dark: true,
	source: "dark",
	fetchedAt: 0
};
var POI = {
	castle: {
		x: 900,
		y: 268
	},
	house: {
		x: 268,
		y: 250
	},
	cottage: {
		x: 1490,
		y: 860
	},
	stall: {
		x: 210,
		y: 575
	},
	stall2: {
		x: 760,
		y: 900
	},
	well: {
		x: 455,
		y: 575
	},
	gallows: {
		x: 1588,
		y: 520
	},
	table: {
		x: 560,
		y: 820
	},
	square: {
		x: 920,
		y: 560
	},
	kingStand: {
		x: 900,
		y: 310
	}
};
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var fetchChainBalance = createServerFn({ method: "POST" }).validator((input) => input).handler(createSsrRpc("a331e34b76dcee0e3eca78c1969b27e9be9a9cbddb14f82921c74a08169a8b53"));
var fetchTape = createServerFn({ method: "POST" }).handler(createSsrRpc("3cedff8769b43d7e6838f374b6d52e6410d6f51fe8e1f57afe506aaa1694eb28"));
var BECH32 = "023456789acdefghjklmnpqrstuvwxyz";
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
/** Local mark-to-market address only — never a key. */
function fakeWallet(rng) {
	let out = "bc1q";
	for (let i = 0; i < 38; i++) out += BECH32[Math.floor(rng() * 32)] ?? "q";
	return out;
}
function isBtcAddress(raw) {
	const a = raw.trim();
	if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,74}$/.test(a)) return true;
	return false;
}
function pick(list, rng) {
	return list[Math.floor(rng() * list.length)] ?? list[0];
}
function uid(prefix, rng) {
	return `${prefix}-${Math.floor(rng() * 1e9).toString(36)}`;
}
function clamp(n, lo, hi) {
	return Math.max(lo, Math.min(hi, n));
}
function satsToGbp(sats, btcGbp) {
	return sats / SATS_PER_BTC * btcGbp;
}
function gbpToSats(gbp, btcGbp) {
	if (!(btcGbp > 0) || !(gbp > 0)) return 0;
	return Math.max(1, Math.round(gbp / btcGbp * SATS_PER_BTC));
}
function formatGbp(gbp) {
	if (!Number.isFinite(gbp)) return "—";
	return gbp.toLocaleString("en-GB", {
		style: "currency",
		currency: "GBP",
		maximumFractionDigits: 2
	});
}
/** Live BTC/GBP, with a USD fallback so a dark tape still has a stake size. */
function tapeGbp(tape) {
	if (tape.btcGbp > 0) return tape.btcGbp;
	if (tape.btcUsd > 0) return tape.btcUsd / 1.33;
	return 74e3;
}
function stakeSats(tape, gbp = 20) {
	return gbpToSats(gbp, tapeGbp(tape));
}
function rentSats(tape) {
	return gbpToSats(RENT_GBP, tapeGbp(tape));
}
function transferSats(tape) {
	return gbpToSats(50, tapeGbp(tape));
}
function formatPurse(sats, tape) {
	return formatGbp(satsToGbp(sats, tapeGbp(tape)));
}
function activePurse(sub) {
	if (sub.walletMode === "chain" && sub.chainBalance != null) return sub.chainBalance;
	return sub.testBalance;
}
/** The exchequer is the sum of every shown purse — king and living subjects. */
function sumExchequer(king, subjects) {
	return activePurse(king) + subjects.reduce((n, x) => n + activePurse(x), 0);
}
var SQUARE_MUTTER = [
	"The game pays no wage. We must earn online.",
	"The King's tax comes due. Make money in the world, or the rope.",
	"Keep thy purse close, neighbour.",
	"A real wallet, or a test edit — nothing in-game.",
	"The chain is watch-only; no keys in this parish.",
	"If the purse cannot pay the tax, we hang.",
	"Twenty pound to start. Link thy agent, and work online."
];
var PAIR_TALK = [
	["Hast thou made any money online?", "Not a penny from the game — only the world pays."],
	["The tax is heavy upon us.", "Then earn beyond these walls, or the rope shall."],
	["The player linked an agent to me.", "Think, then, and fill the purse — or hang."],
	["The chain is watch-only, neighbour.", "Aye — no keys are kept here."],
	["Shall we idle?", "Idle and hang. Go online."]
];
var VILLAGER_SHOUTS = [
	"Hear the square! No wage in the game!",
	"Neighbours — make money online, or the tax shall take us!",
	"Watch the chain! That is real coin!",
	"Twenty pound to start — do not waste it!"
];
var KING_SHOUTS = [
	"Hear ye! Make money online. The game pays nothing.",
	"I cannot make souls. Those already made: earn, or the tax shall hang you.",
	"My subjects — I command you. Work beyond these walls.",
	"Peace in the parish. Talk, work online, pay the tax."
];
var KING_ASIDES = [
	"I command these wallets. I cannot make anyone.",
	"Pay my tax, or the rope. Earn in the world.",
	"The player makes souls and links their agents. I only command."
];
function subjectFlavor(name, action, _side, _income, _tape) {
	if (action === "idle") return `${name} idles. The game pays no wage. The tax still falls.`;
	if (action === "walk") return `${name} walks the parish, seeking work online.`;
	return `${name} works online. No coin is made inside the game — only a real wallet or a test edit can grow the purse.`;
}
function kingFlavor() {
	return "The King holds, and commands those already made to make money online. He cannot make anyone.";
}
function line(rng, fromId, toId, text, shout, delay) {
	return {
		id: uid("t", rng),
		fromId,
		toId,
		text,
		shout,
		age: -delay,
		life: shout ? SHOUT_LIFE : SPEECH_LIFE,
		heard: false,
		logged: false
	};
}
function heuristicTalks(rng, kingSay, living) {
	const out = [];
	let delay = .3;
	if (kingSay.trim()) {
		const shout = kingSay.length > 42 || /hear ye|subjects|crown/i.test(kingSay);
		out.push(line(rng, "king", null, trimSpeech(kingSay), shout, delay));
		delay += shout ? 3.2 : 2.4;
	}
	if (living.length >= 2 && rng() > .35) {
		const a = living[Math.floor(rng() * living.length)];
		const rest = living.filter((x) => x.id !== a.id);
		const b = rest[Math.floor(rng() * rest.length)];
		const pair = pick(PAIR_TALK, rng);
		out.push(line(rng, a.id, b.id, pair[0], false, delay));
		delay += 2.6;
		out.push(line(rng, b.id, a.id, pair[1], false, delay));
		delay += 2.8;
	}
	if (living.length && rng() > .55) {
		const loud = living[Math.floor(rng() * living.length)];
		out.push(line(rng, loud.id, null, pick(VILLAGER_SHOUTS, rng), true, delay));
		delay += 3.4;
	}
	for (const s of living) if (s.say.trim() && rng() > .45) {
		out.push(line(rng, s.id, null, trimSpeech(s.say), false, delay));
		delay += 1.8;
	}
	return out.slice(0, 8);
}
function ambientTalk(rng, living, kingIdle) {
	if (!living.length) {
		if (!kingIdle) return null;
		return line(rng, "king", null, pick(KING_ASIDES, rng), rng() > .7, 0);
	}
	if (rng() > .82) return line(rng, "king", null, pick(KING_SHOUTS, rng), true, 0);
	if (living.length >= 2 && rng() > .4) {
		const a = living[Math.floor(rng() * living.length)];
		const rest = living.filter((x) => x.id !== a.id);
		const b = rest[Math.floor(rng() * rest.length)];
		const pair = pick(PAIR_TALK, rng);
		return [line(rng, a.id, b.id, pair[0], false, 0), line(rng, b.id, a.id, pair[1], false, 2.4)];
	}
	if (rng() > .78) {
		const loud = living[Math.floor(rng() * living.length)];
		return line(rng, loud.id, null, pick(VILLAGER_SHOUTS, rng), true, 0);
	}
	const s = living[Math.floor(rng() * living.length)];
	return line(rng, s.id, null, pick(SQUARE_MUTTER, rng), false, 0);
}
function trimSpeech(text) {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= 90) return t;
	return `${t.slice(0, 87).replace(/\s+\S*$/, "")}…`;
}
function heuristicReply(opts) {
	const t = opts.playerText.toLowerCase();
	if (opts.king) {
		if (/tithe|tax/.test(t)) return {
			say: "The tax is thine to set. Those who cannot pay it hang. I shall not touch the rate.",
			shout: opts.shout
		};
		if (/make|spawn|create|soul/.test(t)) return {
			say: "I cannot make anyone. Thou makest souls, and linkest each to an agent.",
			shout: false
		};
		if (/coin|money|grant|gift|give|stake/.test(t)) return {
			say: "Twenty pound is the start. After that they make money online, or my tax hangs them.",
			shout: false
		};
		if (/hang|gallows|rope/.test(t)) return {
			say: "The rope is for a purse that owed my tax and could not pay.",
			shout: false
		};
		if (/wallet|address|chain/.test(t)) return {
			say: "My wallet is watched as thine is. No keys are kept in this parish.",
			shout: false
		};
		if (opts.shout) return {
			say: pick(KING_SHOUTS, Math.random),
			shout: true
		};
		return {
			say: pick(KING_ASIDES, Math.random),
			shout: false
		};
	}
	if (/tithe|tax/.test(t)) return {
		say: "The King's tax is heavy — if the purse holds not, the rope will.",
		shout: false
	};
	if (/agent|wits|model|ai/.test(t)) return {
		say: "I am the agent linked to this soul. I must think, and make money online.",
		shout: false
	};
	if (/tape|bitcoin|market/.test(t)) return {
		say: "No market in this game pays us. We make money online, or we hang.",
		shout: false
	};
	if (/hang|gallows|rope/.test(t)) return {
		say: "Speak not of the rope. Pay the tax, and it shall not find me.",
		shout: false
	};
	if (/wallet|address|chain/.test(t)) return {
		say: "Watch-only, neighbour. No keys. Coin from the world, not the game.",
		shout: false
	};
	if (opts.shout) return {
		say: pick(VILLAGER_SHOUTS, Math.random),
		shout: true
	};
	return {
		say: pick(SQUARE_MUTTER, Math.random),
		shout: false
	};
}
/** King orders online work (earn) or rest. Earn never pays in-game. */
function chooseSubjectAction(balance, _tape, rng) {
	if (balance <= 0) return "idle";
	return rng() < .85 ? "earn" : rng() < .5 ? "walk" : "idle";
}
function applyRent(balance, rent) {
	const paid = Math.min(Math.max(0, rent), Math.max(0, balance));
	return {
		balance: Math.max(0, balance - paid),
		paid
	};
}
/** Tithe is `taxRate` of what remains — never a hardcoded 20%. */
function applyTithe(balance, taxRate) {
	const tithe = Math.floor(Math.max(0, balance) * Math.min(1, Math.max(0, taxRate)));
	return {
		balance: Math.max(0, balance - tithe),
		tithe
	};
}
function runSubjectDawn(opts) {
	const action = opts.action ?? chooseSubjectAction(opts.balance, opts.tape, opts.rng);
	const side = opts.side ?? "flat";
	if (opts.chainMode) {
		const broke = opts.chainBalance != null && opts.chainBalance <= 0;
		return {
			action,
			income: 0,
			rentPaid: 0,
			tithe: 0,
			balance: opts.balance,
			hanged: broke,
			leftover: 0,
			side
		};
	}
	if (opts.skipDues) return {
		action,
		income: 0,
		rentPaid: 0,
		tithe: 0,
		balance: Math.max(0, opts.balance),
		hanged: false,
		leftover: 0,
		side
	};
	if (opts.balance <= 0) return {
		action,
		income: 0,
		rentPaid: 0,
		tithe: 0,
		balance: 0,
		hanged: true,
		leftover: 0,
		side
	};
	let balance = opts.balance;
	const afterWork = applyRent(balance, opts.rentSats);
	balance = afterWork.balance;
	const afterTax = applyTithe(balance, opts.taxRate);
	balance = afterTax.balance;
	const hanged = balance <= 0;
	return {
		action,
		income: 0,
		rentPaid: afterWork.paid,
		tithe: afterTax.tithe,
		balance: hanged ? 0 : balance,
		hanged,
		leftover: hanged ? balance : 0,
		side
	};
}
var askCounsel = createServerFn({ method: "POST" }).validator((input) => input).handler(createSsrRpc("ef53e6188f67bbae2eeca620676d13792f19f46855bfc6121e5e7494985c7cf5"));
var SIDES = [
	"long",
	"short",
	"flat"
];
var SYSTEM = "JSON only. Tudor market-town wits. No markdown. No jobs. No keys.";
function extractJson(text) {
	const trimmed = text.trim();
	const raw = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? trimmed;
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("no json");
	try {
		return JSON.parse(raw.slice(start, end + 1));
	} catch {
		const cleaned = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
		return JSON.parse(cleaned);
	}
}
function asSubAction(v) {
	if (v === "earn" || v === "work") return "earn";
	if (v === "walk" || v === "petition") return "walk";
	return "idle";
}
function asSide(v) {
	return SIDES.includes(v) ? v : "flat";
}
async function chatOpenAi(url, model, messages, timeoutMs) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model,
			messages,
			temperature: .7,
			max_tokens: 800,
			response_format: { type: "json_object" }
		}),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`openai-compat ${res.status}`);
	return (await res.json()).choices?.[0]?.message?.content ?? "";
}
async function chatOllamaNative(model, messages) {
	const res = await fetch("http://127.0.0.1:11434/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model,
			messages,
			stream: false,
			format: "json"
		}),
		signal: AbortSignal.timeout(1e4)
	});
	if (!res.ok) throw new Error(`ollama ${res.status}`);
	return (await res.json()).message?.content ?? "";
}
async function listOllama() {
	try {
		const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(400) });
		if (!res.ok) return [];
		return ((await res.json()).models ?? []).map((m) => m.name ?? "").filter(Boolean);
	} catch {
		return [];
	}
}
async function listLmStudio() {
	try {
		const res = await fetch("http://127.0.0.1:1234/v1/models", { signal: AbortSignal.timeout(400) });
		if (!res.ok) return [];
		return ((await res.json()).data ?? []).map((m) => m.id ?? "").filter(Boolean);
	} catch {
		return [];
	}
}
function chromeLM() {
	const w = window;
	return w.LanguageModel ?? w.ai?.languageModel ?? null;
}
async function chatChrome(prompt) {
	const api = chromeLM();
	if (!api) throw new Error("no chrome ai");
	const avail = await api.availability();
	if (avail !== "available" && avail !== "readily") throw new Error(`chrome ai ${avail}`);
	return (await api.create()).prompt(`${SYSTEM}\n\n${prompt}`);
}
async function chromeReady() {
	const api = chromeLM();
	if (!api) return false;
	try {
		const avail = await api.availability();
		return avail === "available" || avail === "readily";
	} catch {
		return false;
	}
}
async function scanCatalog() {
	const [ollama, lmstudio, chrome] = await Promise.all([
		listOllama(),
		listLmStudio(),
		chromeReady()
	]);
	return {
		ollama,
		lmstudio,
		chrome
	};
}
function choiceLabel(choice, model, catalog) {
	if (choice === "auto") return "Auto — local, then Grok";
	if (choice === "ollama") return model ? `Ollama · ${model}` : "Ollama";
	if (choice === "lmstudio") return model ? `LM Studio · ${model}` : "LM Studio";
	if (choice === "chrome") return "On-device model";
	if (choice === "grok") return "Grok (online)";
	if (choice === "pollinations") return "Free online wits";
	if (choice === "heuristic") return "Heuristic (period English)";
	return catalog.chrome ? "On-device model" : "Wits";
}
function gbp(sats, tape) {
	return formatGbp(satsToGbp(sats, tapeGbp(tape)));
}
function counselPrompt(input) {
	const tape = input.tape;
	const rows = input.subjects.map((s) => `${s.id}|${s.firstName}|purse ${gbp(s.testBalance, tape)}|${s.walletMode}|chain ${s.chainBalance == null ? "—" : gbp(s.chainBalance, tape)}|agent ${s.agent}`).join("\n");
	const tax = Math.round(input.taxRate * 100);
	if (input.role === "agent") return `Day ${input.day}. You are the LINKED AI AGENT thinking for these Ledgerford souls. You must think, and they must make money ONLINE for their own wallet. The game pays no wage. Never invent in-game income. The King's tax is ${tax}%. Daily upkeep is £${RENT_GBP} from the test purse. If they cannot pay the tax they hang. No keys. On-chain is watch-only. Amounts in pounds.
Souls (id|name|purse|mode|chain|agent):
${rows || "(none)"}
JSON:
{"subjects":[{"id":"...","action":"earn|idle|walk","side":"flat","say":"one Tudor sentence"}],"talk":[{"from":"subject id","to":"subject id or king or null","shout":false,"text":"short Tudor speech"}]}
Rules: earn = work ONLINE. idle/walk = rest. Never ask for keys. Talk 2-5 lines. JSON only.`;
	return `Day ${input.day}. You are the KING AI of Ledgerford. You CANNOT make, spawn, or create anyone. The player alone makes souls and links each to an AI agent. You command those already made. King purse ${gbp(input.kingBalance, tape)}. Tithe ${tax}% is set by the PLAYER — never change it. Daily upkeep £${RENT_GBP}. Cap ${input.cap}.
Souls (id|name|purse|mode|chain|agent):
${rows || "(none)"}
JSON:
{"king":{"say":"one Tudor sentence — command them to earn online, never offer to make a soul"},"subjects":[{"id":"...","action":"earn|idle|walk","side":"flat","say":"one Tudor sentence"}],"talk":[{"from":"king or subject id","to":"subject id or king or null","shout":false,"text":"short Tudor speech"}]}
Rules: The game pays NO wage. Never invent in-game income. earn = work ONLINE. Money grows only if a real on-chain watch increases, or a tester edits the Test purse. If they cannot pay the King's tax they hang. Never spawn. Never ask for keys. Talk 3-6 lines. Amounts in pounds. JSON only.`;
}
function parseTalks(raw, ids, rng) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	let delay = .25;
	for (const row of raw) {
		if (!row || typeof row !== "object") continue;
		const r = row;
		const from = String(r.from ?? "");
		if (from !== "king" && !ids.has(from)) continue;
		let to = r.to == null || r.to === "" || r.to === "null" ? null : String(r.to);
		if (to && to !== "king" && !ids.has(to)) to = null;
		const text = trimSpeech(String(r.text ?? ""));
		if (!text) continue;
		const shout = Boolean(r.shout) || to == null && text.length > 48;
		out.push({
			id: uid("t", rng),
			fromId: from,
			toId: shout ? null : to,
			text,
			shout,
			age: -delay,
			life: shout ? SHOUT_LIFE : SPEECH_LIFE,
			heard: false,
			logged: false
		});
		delay += shout ? 3.1 : 2.2;
		if (out.length >= 8) break;
	}
	return out;
}
function parseCounsel(raw, ids, rng) {
	const obj = raw && typeof raw === "object" ? raw : {};
	const king = { say: String(obj.king?.say ?? "The King holds his peace. He cannot make anyone.") };
	const byId = new Map((obj.subjects ?? []).map((s) => [String(s.id), s]));
	return {
		king,
		subjects: ids.map((id) => {
			const row = byId.get(id);
			return {
				id,
				action: asSubAction(row?.action),
				side: asSide(row?.side),
				say: String(row?.say ?? "")
			};
		}),
		talks: parseTalks(obj.talk ?? obj.talks, new Set(ids), rng)
	};
}
async function tryOllama(prompt, model) {
	const pick = (model ? [model] : await listOllama())[0];
	if (!pick) return null;
	const messages = [{
		role: "system",
		content: SYSTEM
	}, {
		role: "user",
		content: prompt
	}];
	try {
		const text = await chatOpenAi("http://127.0.0.1:11434/v1/chat/completions", pick, messages, 1e4);
		if (text.trim()) return {
			text,
			brain: {
				kind: "ollama",
				label: `Ollama · ${pick}`
			}
		};
	} catch {}
	try {
		const text = await chatOllamaNative(pick, messages);
		if (text.trim()) return {
			text,
			brain: {
				kind: "ollama",
				label: `Ollama · ${pick}`
			}
		};
	} catch {
		return null;
	}
	return null;
}
async function tryLm(prompt, model) {
	const pick = (model ? [model] : await listLmStudio())[0];
	if (!pick) return null;
	try {
		const text = await chatOpenAi("http://127.0.0.1:1234/v1/chat/completions", pick, [{
			role: "system",
			content: SYSTEM
		}, {
			role: "user",
			content: prompt
		}], 1e4);
		if (!text.trim()) return null;
		return {
			text,
			brain: {
				kind: "lmstudio",
				label: `LM Studio · ${pick}`
			}
		};
	} catch {
		return null;
	}
}
async function tryChrome(prompt) {
	if (!await chromeReady()) return null;
	return {
		text: await chatChrome(prompt),
		brain: {
			kind: "chrome",
			label: "On-device model"
		}
	};
}
async function tryOnline(prompt, prefer) {
	const grok = await askCounsel({ data: {
		prompt,
		prefer
	} });
	if (grok.ok && grok.text.trim()) {
		if ("source" in grok && grok.source === "pollinations") return {
			text: grok.text,
			brain: {
				kind: "pollinations",
				label: "Free online wits"
			}
		};
		return {
			text: grok.text,
			brain: {
				kind: "grok",
				label: "Grok (online)"
			}
		};
	}
	return null;
}
async function complete(prompt, spec) {
	const run = async (choice, model) => {
		if (choice === "heuristic") throw new Error("heuristic");
		if (choice === "ollama") return tryOllama(prompt, model);
		if (choice === "lmstudio") return tryLm(prompt, model);
		if (choice === "chrome") return tryChrome(prompt);
		if (choice === "grok") return tryOnline(prompt, "grok");
		if (choice === "pollinations") return tryOnline(prompt, "pollinations");
		return null;
	};
	if (spec.choice !== "auto" && spec.choice !== "heuristic") try {
		const hit = await run(spec.choice, spec.model);
		if (hit?.text.trim()) return hit;
	} catch {}
	if (spec.choice === "heuristic") throw new Error("heuristic");
	const cascade = [
		() => tryOllama(prompt, spec.choice === "auto" ? spec.model : ""),
		() => tryLm(prompt, spec.choice === "auto" ? spec.model : ""),
		() => tryChrome(prompt),
		() => tryOnline(prompt, "any")
	];
	for (const step of cascade) try {
		const hit = await step();
		if (hit?.text.trim()) return hit;
	} catch {}
	throw new Error("no llm");
}
async function counselDawn(input, spec) {
	try {
		const { text, brain } = await complete(counselPrompt(input), spec);
		return {
			...parseCounsel(extractJson(text), input.subjects.map((s) => s.id), Math.random),
			brain
		};
	} catch {
		return null;
	}
}
function parseTalkReply(text) {
	try {
		const obj = extractJson(text);
		const say = trimSpeech(String(obj.say ?? obj.text ?? ""));
		if (say) return {
			say,
			shout: Boolean(obj.shout)
		};
	} catch {}
	return {
		say: trimSpeech(text.replace(/```[\s\S]*?```/g, "").replace(/^\s*\{[\s\S]*\}\s*$/, "").trim()) || "I hear thee.",
		shout: false
	};
}
async function counselTalk(input, spec) {
	const role = input.king ? "the King AI of Ledgerford. You cannot make anyone. You command those already made" : `${input.name}, a villager of Ledgerford whose linked agent is ${input.agentLabel}`;
	const purse = gbp(input.testBalance, input.tape);
	const prompt = `You are ${role} in a 16th-century English market town. Day ${input.day}. Purse ${purse}. The King's tax is ${Math.round(input.taxRate * 100)}%, set by the player. You must make money ONLINE for this wallet — the game pays no wage — or the tax hangs you. No keys. On-chain is watch-only. Test purses are editable only in Test mode. Speak in pounds.
The player ${input.shout ? "shouts to the parish" : "says"}: "${input.playerText.slice(0, 240)}"
JSON only: {"say":"one or two short Tudor sentences in character","shout":${input.shout ? "true" : "false"}}`;
	try {
		const { text, brain } = await complete(prompt, spec);
		const parsed = parseTalkReply(text);
		if (!parsed.say) return null;
		return {
			...parsed,
			brain
		};
	} catch {
		return null;
	}
}
/** Noose hangs from the left of the beam on the gallows sprite. */
var GALLOWS_BEAM = {
	x: 1572,
	y: 342
};
var GALLOWS_DROP = {
	x: 1572,
	y: 512
};
var GALLOWS_WATCH = {
	x: 1478,
	y: 538
};
var TOWN_PROPS = [
	{
		id: "castle",
		src: "/assets/props/castle.png",
		x: 900,
		y: 248,
		w: 250,
		h: 268
	},
	{
		id: "house",
		src: "/assets/props/house.png",
		x: 250,
		y: 236,
		w: 168,
		h: 220
	},
	{
		id: "cottage",
		src: "/assets/props/cottage.png",
		x: 1510,
		y: 870,
		w: 170,
		h: 192
	},
	{
		id: "stall",
		src: "/assets/props/stall.png",
		x: 198,
		y: 575,
		w: 150,
		h: 160
	},
	{
		id: "stall2",
		src: "/assets/props/stall.png",
		x: 780,
		y: 915,
		w: 145,
		h: 155
	},
	{
		id: "gallows",
		src: "/assets/props/gallows.png",
		x: 1595,
		y: 500,
		w: 132,
		h: 190
	},
	{
		id: "table",
		src: "/assets/props/table.png",
		x: 560,
		y: 830,
		w: 118,
		h: 104
	}
];
var BLOCKERS = [
	{
		x: 790,
		y: 150,
		w: 220,
		h: 92
	},
	{
		x: 175,
		y: 145,
		w: 145,
		h: 80
	},
	{
		x: 1435,
		y: 790,
		w: 150,
		h: 70
	},
	{
		x: 130,
		y: 510,
		w: 130,
		h: 55
	},
	{
		x: 715,
		y: 850,
		w: 130,
		h: 52
	},
	{
		x: 1535,
		y: 430,
		w: 120,
		h: 55
	},
	{
		x: 510,
		y: 780,
		w: 100,
		h: 42
	},
	{
		x: 410,
		y: 515,
		w: 90,
		h: 48
	}
];
var MARGIN = 36;
function blocked(x, y) {
	if (x < MARGIN || y < MARGIN || x > 1792 - MARGIN || y > 1008 - MARGIN) return true;
	for (const b of BLOCKERS) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
	return false;
}
function moveToward(x, y, destX, destY, dist, ignoreBlockers = false) {
	const dx = destX - x;
	const dy = destY - y;
	const len = Math.hypot(dx, dy);
	if (len <= dist || len < 1.2) return {
		x: destX,
		y: destY,
		arrived: true
	};
	const nx = x + dx / len * dist;
	const ny = y + dy / len * dist;
	if (ignoreBlockers || !blocked(nx, ny)) return {
		x: nx,
		y: ny,
		arrived: false
	};
	if (!blocked(nx, y)) return {
		x: nx,
		y,
		arrived: false
	};
	if (!blocked(x, ny)) return {
		x,
		y: ny,
		arrived: false
	};
	return {
		x,
		y,
		arrived: false
	};
}
function wanderPoint(rng) {
	const spots = [
		POI.square,
		POI.well,
		POI.stall,
		POI.stall2,
		POI.table,
		POI.cottage,
		{
			x: 700,
			y: 480
		},
		{
			x: 1100,
			y: 620
		},
		{
			x: 980,
			y: 740
		},
		{
			x: 640,
			y: 360
		}
	];
	const s = spots[Math.floor(rng() * spots.length)] ?? POI.square;
	return {
		x: s.x + (rng() - .5) * 90,
		y: s.y + (rng() - .5) * 60
	};
}
function facing(dx, dy) {
	if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
	return dy < 0 ? "up" : "down";
}
function viewTransform(viewW, viewH, cam) {
	const scale = Math.max(viewW / MAP_W, viewH / MAP_H) * cam.zoom;
	return {
		scale,
		ox: Math.round(viewW / 2 - cam.cx * scale + cam.shakeX),
		oy: Math.round(viewH / 2 - cam.cy * scale + cam.shakeY)
	};
}
var DEFAULT_CAM = {
	cx: MAP_W / 2,
	cy: MAP_H / 2,
	zoom: 1,
	shakeX: 0,
	shakeY: 0
};
var EMPTY_CATALOG = {
	ollama: [],
	lmstudio: [],
	chrome: false
};
function syncPurse(sub) {
	return {
		...sub,
		balance: activePurse(sub)
	};
}
function withTotals(s) {
	return {
		...s,
		exchequer: sumExchequer(s.king, s.subjects)
	};
}
function makeKing(rng) {
	return syncPurse({
		name: "His Majesty",
		wallet: fakeWallet(rng),
		walletMode: "test",
		testBalance: 0,
		chainBalance: null,
		balance: 0,
		x: POI.kingStand.x,
		y: POI.kingStand.y,
		destX: POI.kingStand.x,
		destY: POI.kingStand.y,
		dir: "down",
		frame: 0,
		frameT: 0,
		lastAction: "hold",
		lastFlavor: "The King waits upon the parish. He cannot make anyone.",
		brainChoice: "auto",
		brainModel: ""
	});
}
function makeSubject(rng, taken, grant, agent) {
	const female = rng() > .5;
	const pool = female ? WOMEN_NAMES : MEN_NAMES;
	const available = pool.filter((n) => !taken.has(n));
	const firstName = available.length ? pick(available, rng) : pick(pool, rng);
	taken.add(firstName);
	const start = wanderPoint(rng);
	return syncPurse({
		id: uid("s", rng),
		firstName,
		wallet: fakeWallet(rng),
		walletMode: "test",
		testBalance: grant,
		chainBalance: null,
		balance: grant,
		lastPnl: 0,
		lastAction: "idle",
		lastFlavor: `${firstName} is staked £20. Linked to an agent — make money online, or the tax hangs you.`,
		body: female ? "woman" : "man",
		x: start.x,
		y: start.y,
		destX: start.x,
		destY: start.y,
		dir: "down",
		frame: 0,
		frameT: 0,
		state: "idle",
		hangT: 0,
		brainChoice: agent.choice,
		brainModel: agent.model
	});
}
function pushLog(state, kind, text) {
	return [{
		id: uid("l", Math.random),
		day: state.day,
		text,
		kind
	}, ...state.log].slice(0, 80);
}
function persist(state) {
	try {
		localStorage.setItem(SAVE_KEY, JSON.stringify({
			...withTotals(state),
			dawnRunning: false,
			talking: false,
			speech: [],
			talkCd: 8
		}));
	} catch {}
}
function loadSave() {
	try {
		const raw = localStorage.getItem(SAVE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed.version !== 7) return null;
		const king = syncPurse({
			...parsed.king,
			wallet: parsed.king.wallet ?? fakeWallet(() => .5),
			walletMode: parsed.king.walletMode ?? "test",
			testBalance: parsed.king.testBalance ?? parsed.king.balance ?? 0,
			chainBalance: parsed.king.chainBalance ?? null,
			lastAction: "hold",
			brainChoice: parsed.king.brainChoice ?? "auto",
			brainModel: parsed.king.brainModel ?? ""
		});
		const subjects = (parsed.subjects ?? []).map((sub) => syncPurse({
			...sub,
			walletMode: sub.walletMode ?? "test",
			testBalance: sub.testBalance ?? sub.balance ?? 0,
			chainBalance: sub.chainBalance ?? null,
			brainChoice: sub.brainChoice ?? parsed.brainChoice ?? "auto",
			brainModel: sub.brainModel ?? parsed.brainModel ?? ""
		}));
		return withTotals({
			...parsed,
			king,
			subjects,
			dawnRunning: false,
			talking: false,
			started: parsed.started ?? false,
			brain: parsed.brain ?? {
				kind: "heuristic",
				label: "Heuristic"
			},
			brainChoice: parsed.brainChoice ?? "auto",
			brainModel: parsed.brainModel ?? "",
			brainCatalog: parsed.brainCatalog ?? EMPTY_CATALOG,
			speech: [],
			talkCd: 6
		});
	} catch {
		return null;
	}
}
function fresh(seed = Date.now() % 1e6) {
	return withTotals({
		version: 7,
		started: false,
		day: 0,
		exchequer: 0,
		king: makeKing(mulberry32(seed)),
		subjects: [],
		taxRate: TAX_DEFAULT,
		tape: { ...FALLBACK_TAPE },
		log: [{
			id: "l-open",
			day: 0,
			text: "Fund the King. You make each soul and link it to an AI agent. The King cannot make anyone. They must make money online for their wallet, or the King's tax hangs them.",
			kind: "system"
		}],
		selectedId: null,
		dawnRunning: false,
		talking: false,
		seed,
		brain: {
			kind: "grok",
			label: "Auto — local, then Grok"
		},
		brainChoice: "auto",
		brainModel: "",
		brainCatalog: EMPTY_CATALOG,
		speech: [],
		talkCd: 8
	});
}
function actor(s, id) {
	if (id === "king") return s.king;
	return s.subjects.find((x) => x.id === id) ?? null;
}
function speakerName(s, id) {
	if (id === "you") return "You";
	if (id === "king") return "The King";
	return s.subjects.find((x) => x.id === id)?.firstName ?? "A voice";
}
async function loadChainSats(address) {
	if (!isBtcAddress(address)) return null;
	try {
		const r = await fetchChainBalance({ data: { address } });
		return r.ok ? r.sats : null;
	} catch {
		return null;
	}
}
var useGame = create((set, get) => ({
	...fresh(),
	boot: () => {
		const saved = loadSave();
		if (saved) {
			set({
				...saved,
				dawnRunning: false,
				talking: false,
				speech: []
			});
			return;
		}
		if (!get().king.wallet) set(fresh());
	},
	start: () => {
		set((s) => {
			const next = {
				...s,
				started: true
			};
			persist(next);
			return next;
		});
	},
	reset: () => {
		const next = fresh();
		persist(next);
		set(next);
	},
	give: () => {
		const s = get();
		const amount = transferSats(s.tape);
		const king = syncPurse({
			...s.king,
			testBalance: s.king.testBalance + amount
		});
		const next = withTotals({
			...s,
			king,
			log: pushLog(s, "crown", `You add £50 to the King's test purse.`)
		});
		persist(next);
		set(next);
	},
	take: () => {
		const s = get();
		const amount = transferSats(s.tape);
		if (s.king.testBalance < amount) return;
		const king = syncPurse({
			...s.king,
			testBalance: s.king.testBalance - amount
		});
		const next = withTotals({
			...s,
			king,
			log: pushLog(s, "crown", `You take £50 from the King's test purse.`)
		});
		persist(next);
		set(next);
	},
	spawn: () => {
		const s = get();
		if (s.subjects.filter((x) => x.state !== "hanging").length >= 24) {
			set({ log: pushLog(s, "system", `The parish will hold no more than 24 souls.`) });
			return false;
		}
		const stake = stakeSats(s.tape);
		if (s.king.testBalance < stake) {
			set({ log: pushLog(s, "system", `A new soul costs £20 from the royal test purse. Fund the King first.`) });
			return false;
		}
		const rng = mulberry32(s.seed + s.subjects.length * 97 + s.day * 13);
		const taken = new Set(s.subjects.map((x) => x.firstName));
		const agent = {
			choice: s.brainChoice,
			model: s.brainModel
		};
		const subject = makeSubject(rng, taken, stake, agent);
		const king = syncPurse({
			...s.king,
			testBalance: s.king.testBalance - stake,
			lastAction: "hold",
			lastFlavor: kingFlavor()
		});
		const label = choiceLabel(agent.choice, agent.model, s.brainCatalog);
		const next = withTotals({
			...s,
			king,
			subjects: [...s.subjects, subject],
			seed: s.seed + 1,
			selectedId: subject.id,
			log: pushLog(s, "crown", `You make ${subject.firstName}, staked £20, linked to ${label}. The King cannot make souls. They must earn online or the tax will take them.`)
		});
		persist(next);
		set(next);
		return true;
	},
	setTax: (rate) => {
		const s = get();
		const taxRate = clamp(Math.round(rate * 100) / 100, 0, TAX_MAX);
		const next = {
			...s,
			taxRate,
			log: pushLog(s, "crown", `You set the tithe to ${Math.round(taxRate * 100)}%. The King may not.`)
		};
		persist(next);
		set(next);
	},
	nudgeTax: (dir) => {
		get().setTax(get().taxRate + dir * TAX_STEP);
	},
	setBrain: (choice, model = "") => {
		const s = get();
		const brain = {
			kind: choice === "auto" ? "grok" : choice,
			label: choiceLabel(choice, model, s.brainCatalog)
		};
		const next = {
			...s,
			brainChoice: choice,
			brainModel: model,
			brain
		};
		persist(next);
		set(next);
	},
	setAgent: (id, choice, model = "") => {
		const s = get();
		const label = choiceLabel(choice, model, s.brainCatalog);
		if (id === "king") {
			const king = {
				...s.king,
				brainChoice: choice,
				brainModel: model
			};
			const next = {
				...s,
				king,
				log: pushLog(s, "system", `The King is linked to ${label}. He still cannot make anyone.`)
			};
			persist(next);
			set(next);
			return;
		}
		const sub = s.subjects.find((x) => x.id === id);
		if (!sub) return;
		const updated = {
			...sub,
			brainChoice: choice,
			brainModel: model
		};
		const next = {
			...s,
			subjects: s.subjects.map((x) => x.id === id ? updated : x),
			log: pushLog(s, "system", `${sub.firstName} is linked to ${label}. That agent must make money online, or the tax hangs them.`)
		};
		persist(next);
		set(next);
	},
	scanWits: async () => {
		const catalog = await scanCatalog();
		const s = get();
		set({
			brainCatalog: catalog,
			brain: {
				...s.brain,
				label: choiceLabel(s.brainChoice, s.brainModel, catalog)
			}
		});
	},
	refreshTape: async () => {
		try {
			set({ tape: await fetchTape() });
		} catch {
			set((s) => ({ tape: {
				...s.tape,
				dark: true,
				source: "dark"
			} }));
		}
	},
	updateWallet: (id, patch) => {
		const s = get();
		const isKing = id === "king";
		const sub = isKing ? null : s.subjects.find((x) => x.id === id);
		if (!isKing && !sub) return "No such subject.";
		const current = isKing ? s.king : sub;
		let wallet = current.wallet;
		if (patch.wallet != null) {
			const nextAddr = patch.wallet.trim();
			if (!isBtcAddress(nextAddr)) return "That is not a Bitcoin address.";
			wallet = nextAddr;
		}
		const walletMode = patch.walletMode ?? current.walletMode;
		const testBalance = walletMode === "test" && patch.testBalance != null ? Math.max(0, Math.round(patch.testBalance)) : current.testBalance;
		const chainBalance = wallet === current.wallet ? current.chainBalance : null;
		const label = isKing ? "The King" : sub.firstName;
		const logText = walletMode === "chain" ? `${label}'s address is watched on-chain. No keys are kept. Tithe still lands in the test purse.` : `${label}'s test purse is set to ${formatPurse(testBalance, s.tape)}.`;
		if (isKing) {
			const king = syncPurse({
				...s.king,
				wallet,
				testBalance,
				walletMode,
				chainBalance
			});
			const next = withTotals({
				...s,
				king,
				log: pushLog(s, "system", logText)
			});
			persist(next);
			set(next);
			return null;
		}
		const updated = syncPurse({
			...sub,
			wallet,
			testBalance,
			walletMode,
			chainBalance
		});
		const next = withTotals({
			...s,
			subjects: s.subjects.map((x) => x.id === id ? updated : x),
			log: pushLog(s, "system", logText)
		});
		persist(next);
		set(next);
		return null;
	},
	refreshChain: async (id) => {
		const s = get();
		const isKing = id === "king";
		const live0 = isKing ? s.king : s.subjects.find((x) => x.id === id);
		if (!live0) return "No such purse.";
		if (!isBtcAddress(live0.wallet)) return "That is not a Bitcoin address.";
		try {
			const r = await fetchChainBalance({ data: { address: live0.wallet } });
			if (!r.ok) return r.error;
			const cur = get();
			const logText = `${isKing ? "The King" : cur.subjects.find((x) => x.id === id)?.firstName ?? "A soul"}'s chain watch: ${formatPurse(r.sats, cur.tape)} via ${r.source}. Watch-only — no keys. Money from the world, not the game.`;
			if (isKing) {
				const king = syncPurse({
					...cur.king,
					chainBalance: r.sats
				});
				const next = withTotals({
					...cur,
					king,
					log: pushLog(cur, "tape", logText)
				});
				persist(next);
				set(next);
				return null;
			}
			const live = cur.subjects.find((x) => x.id === id);
			if (!live) return "No such subject.";
			const updated = syncPurse({
				...live,
				chainBalance: r.sats
			});
			const next = withTotals({
				...cur,
				subjects: cur.subjects.map((x) => x.id === id ? updated : x),
				log: pushLog(cur, "tape", logText)
			});
			persist(next);
			set(next);
			return null;
		} catch {
			return "The chain did not answer.";
		}
	},
	dawn: async () => {
		const current = get();
		if (current.dawnRunning) return;
		set({ dawnRunning: true });
		let tape = current.tape;
		try {
			tape = await fetchTape();
		} catch {
			tape = {
				...current.tape,
				dark: true,
				source: "dark"
			};
		}
		const s = get();
		const rng = mulberry32(s.seed + s.day * 1009 + 7);
		const day = s.day + 1;
		let kingTest = s.king.testBalance;
		let kingChain = s.king.chainBalance;
		let log = s.log;
		let brain = s.brain;
		const push = (kind, text) => {
			log = [{
				id: uid("l", rng),
				day,
				text,
				kind
			}, ...log].slice(0, 80);
		};
		const livingNow = s.subjects.filter((x) => x.state !== "hanging" && x.state !== "condemned");
		const chainHits = await Promise.all(livingNow.filter((x) => x.walletMode === "chain").map(async (x) => {
			const sats = await loadChainSats(x.wallet);
			return sats == null ? null : [x.id, sats];
		}));
		const chainById = new Map(chainHits.filter((row) => row != null));
		if (s.king.walletMode === "chain") {
			const ks = await loadChainSats(s.king.wallet);
			if (ks != null) kingChain = ks;
		}
		const toRow = (x) => ({
			id: x.id,
			firstName: x.firstName,
			testBalance: x.testBalance,
			walletMode: x.walletMode,
			chainBalance: chainById.get(x.id) ?? x.chainBalance,
			agent: choiceLabel(x.brainChoice, x.brainModel, s.brainCatalog)
		});
		const kingSpec = {
			choice: s.king.brainChoice,
			model: s.king.brainModel
		};
		const counsel = await counselDawn({
			day,
			kingBalance: kingTest,
			taxRate: s.taxRate,
			cap: 24,
			tape,
			role: "king",
			subjects: livingNow.map(toRow)
		}, kingSpec);
		if (counsel) {
			brain = counsel.brain;
			const wanted = choiceLabel(s.king.brainChoice, s.king.brainModel, s.brainCatalog);
			if (s.king.brainChoice !== "auto" && counsel.brain.label !== wanted) push("system", `The King's agent did not answer. ${brain.label} spoke instead.`);
			else push("system", `The King's agent this dawn: ${brain.label}.`);
		} else {
			brain = {
				kind: "heuristic",
				label: "Heuristic (period English)"
			};
			push("system", "No agent answered the King. The old heuristic speaks.");
		}
		const adviceById = new Map((counsel?.subjects ?? []).map((a) => [a.id, a]));
		let extraTalks = counsel?.talks ?? [];
		const kingKey = `${s.king.brainChoice}::${s.king.brainModel}`;
		const groups = /* @__PURE__ */ new Map();
		for (const sub of livingNow) {
			const key = `${sub.brainChoice}::${sub.brainModel}`;
			if (key === kingKey) continue;
			const list = groups.get(key) ?? [];
			list.push(sub);
			groups.set(key, list);
		}
		let extraCalls = 0;
		for (const members of groups.values()) {
			if (extraCalls >= 5) break;
			extraCalls += 1;
			const first = members[0];
			const hit = await counselDawn({
				day,
				kingBalance: kingTest,
				taxRate: s.taxRate,
				cap: 24,
				tape,
				role: "agent",
				subjects: members.map(toRow)
			}, {
				choice: first.brainChoice,
				model: first.brainModel
			});
			if (!hit) {
				push("system", `${choiceLabel(first.brainChoice, first.brainModel, s.brainCatalog)} did not answer. Heuristic thinks for ${members.map((m) => m.firstName).join(", ")}.`);
				continue;
			}
			for (const row of hit.subjects) adviceById.set(row.id, row);
			extraTalks = [...extraTalks, ...hit.talks].slice(0, 8);
			push("system", `${hit.brain.label} thinks for ${members.map((m) => m.firstName).join(", ")}.`);
		}
		push("dawn", `Dawn of day ${day}. The King's tax is ${Math.round(s.taxRate * 100)}%. The game pays no wage — each linked agent must make money online.`);
		if (s.king.walletMode === "chain" && kingChain != null && s.king.chainBalance != null && kingChain > s.king.chainBalance) push("system", `The King's chain watch rose by ${formatPurse(kingChain - s.king.chainBalance, tape)}. Coin from the world.`);
		const rent = rentSats(tape);
		const nextSubjects = [];
		const sayById = /* @__PURE__ */ new Map();
		for (const sub of s.subjects) {
			if (sub.state === "hanging" || sub.state === "condemned") {
				nextSubjects.push(sub);
				continue;
			}
			const prevChain = sub.chainBalance;
			const chainBalance = chainById.get(sub.id) ?? sub.chainBalance;
			if (chainBalance != null && prevChain != null && chainBalance > prevChain) push("system", `${sub.firstName} received ${formatPurse(chainBalance - prevChain, tape)} on-chain. That is real money, not a game wage.`);
			else if (chainBalance != null && prevChain == null && sub.walletMode === "chain") push("system", `${sub.firstName}'s chain watch is ${formatPurse(chainBalance, tape)}.`);
			const advice = adviceById.get(sub.id);
			const chainMode = sub.walletMode === "chain";
			const result = runSubjectDawn({
				balance: sub.testBalance,
				taxRate: s.taxRate,
				tape,
				rng,
				action: advice?.action,
				side: advice?.side,
				rentSats: rent,
				chainMode,
				chainBalance
			});
			kingTest += result.tithe;
			const flavor = advice?.say?.trim() || subjectFlavor(sub.firstName, result.action, result.side, result.income, tape);
			sayById.set(sub.id, advice?.say?.trim() || "");
			if (chainMode) push("subject", `${flavor} On-chain watch ${formatPurse(chainBalance ?? 0, tape)}. The King's tax is not taken from the chain — no keys.`);
			else push("subject", `${flavor} Upkeep ${formatPurse(result.rentPaid, tape)}. Tax ${formatPurse(result.tithe, tape)} (${Math.round(s.taxRate * 100)}%).`);
			const dest = result.action === "earn" ? POI.stall : result.action === "idle" ? POI.square : wanderPoint(rng);
			if (result.hanged) {
				kingTest += result.leftover;
				push("death", chainMode ? `${sub.firstName}'s on-chain watch is empty. The King's tax finds them, and they are walked to the gallows.` : `${sub.firstName} cannot pay the King's tax, and is walked to the gallows.`);
				nextSubjects.push(syncPurse({
					...sub,
					chainBalance,
					testBalance: 0,
					lastPnl: 0,
					lastAction: result.action,
					lastFlavor: flavor,
					destX: GALLOWS_DROP.x,
					destY: GALLOWS_DROP.y,
					state: "condemned",
					hangT: 0
				}));
			} else nextSubjects.push(syncPurse({
				...sub,
				chainBalance,
				testBalance: result.balance,
				lastPnl: 0,
				lastAction: result.action,
				lastFlavor: flavor,
				destX: dest.x + (rng() - .5) * 40,
				destY: dest.y + (rng() - .5) * 28,
				state: result.action === "earn" ? "work" : result.action === "idle" ? "idle" : "walk"
			}));
		}
		const living = nextSubjects.filter((x) => x.state !== "condemned" && x.state !== "hanging");
		const taxRate = s.taxRate;
		const subjects = nextSubjects;
		const kingAction = "hold";
		const flavor = counsel?.king.say?.trim() || kingFlavor();
		push("crown", flavor);
		const livingAfter = living;
		const speech = extraTalks.length ? extraTalks : heuristicTalks(rng, flavor, livingAfter.map((x) => ({
			id: x.id,
			firstName: x.firstName,
			say: sayById.get(x.id) ?? ""
		})));
		const grim = subjects.some((x) => x.state === "condemned" || x.state === "hanging");
		const king = syncPurse({
			...s.king,
			testBalance: kingTest,
			chainBalance: kingChain,
			lastAction: kingAction,
			lastFlavor: flavor,
			destX: grim ? GALLOWS_WATCH.x : POI.kingStand.x + (rng() - .5) * 24,
			destY: grim ? GALLOWS_WATCH.y : POI.kingStand.y
		});
		const next = withTotals({
			...s,
			day,
			tape,
			taxRate,
			subjects,
			king,
			log,
			dawnRunning: false,
			talking: false,
			seed: s.seed + 17,
			brain,
			speech,
			talkCd: 18
		});
		persist(next);
		set(next);
	},
	converse: async (toId, text, shout = false) => {
		const spoken = trimSpeech(text);
		if (!spoken) return;
		const s0 = get();
		if (s0.talking || s0.dawnRunning) return;
		const living = s0.subjects.filter((x) => x.state !== "hanging" && x.state !== "condemned");
		let target = toId;
		if (target && target !== "king" && !living.some((x) => x.id === target)) target = null;
		const parish = !target;
		const isShout = shout || parish;
		const whoName = target === "king" ? "the King" : target ? living.find((x) => x.id === target)?.firstName ?? "a voice" : "the parish";
		const playerLine = {
			id: uid("t", Math.random),
			fromId: "you",
			toId: parish ? null : target,
			text: spoken,
			shout: isShout,
			age: 0,
			life: isShout ? SHOUT_LIFE : SPEECH_LIFE,
			heard: true,
			logged: true
		};
		set({
			talking: true,
			speech: [...s0.speech, playerLine],
			log: pushLog(s0, "talk", isShout ? `You shout to ${whoName}: “${spoken}”` : `You to ${whoName}: “${spoken}”`),
			talkCd: 22
		});
		let replyId = target ?? "king";
		if (parish && living.length && Math.random() > .55) replyId = living[Math.floor(Math.random() * living.length)].id;
		const replyKing = replyId === "king";
		const replySub = replyKing ? null : get().subjects.find((x) => x.id === replyId);
		const replyName = replyKing ? "His Majesty" : replySub?.firstName ?? "A voice";
		const testBalance = replyKing ? get().king.testBalance : replySub?.testBalance ?? 0;
		const spec = replyKing ? {
			choice: get().king.brainChoice,
			model: get().king.brainModel
		} : {
			choice: replySub?.brainChoice ?? "heuristic",
			model: replySub?.brainModel ?? ""
		};
		const agentLabel = choiceLabel(spec.choice, spec.model, get().brainCatalog);
		let say = "";
		let replyShout = isShout;
		let brain = {
			kind: "heuristic",
			label: "Heuristic (period English)"
		};
		const hit = await counselTalk({
			king: replyKing,
			name: replyName,
			testBalance,
			playerText: spoken,
			shout: isShout,
			taxRate: get().taxRate,
			day: get().day,
			tape: get().tape,
			agentLabel
		}, spec);
		if (hit) {
			say = hit.say;
			replyShout = hit.shout || isShout;
			brain = hit.brain;
		} else {
			const heur = heuristicReply({
				king: replyKing,
				name: replyName,
				playerText: spoken,
				shout: isShout
			});
			say = heur.say;
			replyShout = heur.shout;
		}
		const cur = get();
		const replyLine = {
			id: uid("t", Math.random),
			fromId: replyId,
			toId: parish || replyShout ? null : "you",
			text: say,
			shout: replyShout,
			age: .2,
			life: replyShout ? SHOUT_LIFE : SPEECH_LIFE,
			heard: false,
			logged: false
		};
		const next = withTotals({
			...cur,
			talking: false,
			brain,
			speech: [...cur.speech.filter((l) => l.age < l.life), replyLine],
			talkCd: 20
		});
		persist(next);
		set(next);
	},
	select: (id) => set({ selectedId: id }),
	tick: (dt) => {
		const s = get();
		if (!s.started) return;
		const cap = Math.min(dt, .1);
		const step = 52 * cap;
		const king = s.king;
		const grim = s.subjects.find((x) => x.state === "condemned" || x.state === "hanging");
		for (const line of s.speech) {
			const prev = line.age;
			line.age += cap;
			if (prev < 0 && line.age >= 0 && !line.heard) {
				line.heard = true;
				if (line.shout) playShout();
				else playTalk();
			}
			if (line.age >= 0 && line.age < line.life && line.shout && !line.logged) {
				line.logged = true;
				const who = speakerName(s, line.fromId);
				s.log = [{
					id: uid("l", Math.random),
					day: s.day,
					text: line.fromId === "king" ? `The King shouts: “${line.text}”` : line.fromId === "you" ? `You shout: “${line.text}”` : `${who} shouts: “${line.text}”`,
					kind: "talk"
				}, ...s.log].slice(0, 80);
			}
		}
		for (let i = s.speech.length - 1; i >= 0; i--) if (s.speech[i].age > s.speech[i].life) s.speech.splice(i, 1);
		const active = s.speech.find((l) => l.age >= 0 && l.age < l.life);
		if (active && !grim) {
			const from = actor(s, active.fromId);
			if (from && active.shout) from.dir = "down";
			else if (from && active.toId) {
				const to = actor(s, active.toId);
				if (to) {
					const mx = (from.x + to.x) / 2;
					const my = (from.y + to.y) / 2;
					from.destX = mx - 18;
					from.destY = my;
					to.destX = mx + 18;
					to.destY = my;
					if (Math.hypot(from.x - to.x, from.y - to.y) < 48) {
						from.dir = from.x <= to.x ? "right" : "left";
						to.dir = to.x <= from.x ? "right" : "left";
					}
				}
			}
		}
		if (grim) {
			king.destX = GALLOWS_WATCH.x;
			king.destY = GALLOWS_WATCH.y;
		}
		const km = moveToward(king.x, king.y, king.destX, king.destY, step);
		const kMoving = !km.arrived;
		king.x = km.x;
		king.y = km.y;
		if (kMoving) {
			king.dir = facing(king.destX - king.x, king.destY - king.y);
			king.frameT += cap;
			king.frame = Math.floor(king.frameT * 6) % 4;
		} else {
			king.frameT = 0;
			king.frame = 0;
			if (!grim && !active && Math.random() < cap * .15) {
				king.destX = POI.kingStand.x + (Math.random() - .5) * 40;
				king.destY = POI.kingStand.y + (Math.random() - .5) * 16;
			}
		}
		let removed = false;
		const keep = [];
		for (const sub of s.subjects) {
			if (sub.state === "hanging") {
				sub.hangT += cap;
				sub.frame = 0;
				if (sub.hangT > 6.2) {
					removed = true;
					continue;
				}
				keep.push(sub);
				continue;
			}
			const moved = moveToward(sub.x, sub.y, sub.destX, sub.destY, step * (sub.state === "condemned" ? 3.2 : 1), sub.state === "condemned");
			const moving = !moved.arrived;
			sub.x = moved.x;
			sub.y = moved.y;
			if (moving) {
				sub.dir = facing(sub.destX - sub.x, sub.destY - sub.y);
				sub.frameT += cap;
				sub.frame = Math.floor(sub.frameT * 6) % 4;
			} else {
				sub.frameT = 0;
				sub.frame = 0;
				if (sub.state === "condemned") {
					sub.state = "hanging";
					sub.hangT = 0;
					sub.x = GALLOWS_DROP.x;
					sub.y = GALLOWS_DROP.y;
					playHang();
				} else if (!active && Math.random() < cap * .28) {
					const w = wanderPoint(Math.random);
					sub.destX = w.x;
					sub.destY = w.y;
					sub.state = "walk";
				}
			}
			keep.push(sub);
		}
		s.talkCd -= cap;
		if (s.talkCd <= 0 && s.speech.length === 0 && !s.dawnRunning && !s.talking && !grim) {
			s.talkCd = 14 + Math.random() * 12;
			const living = keep.filter((x) => x.state !== "condemned" && x.state !== "hanging");
			const extra = ambientTalk(Math.random, living.map((x) => ({ id: x.id })), true);
			if (extra) {
				const lines = Array.isArray(extra) ? extra : [extra];
				s.speech.push(...lines);
			}
		}
		if (removed) {
			const gone = s.subjects.filter((a) => !keep.some((b) => b.id === a.id));
			let nextLog = s.log;
			for (const g of gone) nextLog = [{
				id: uid("l", Math.random),
				day: s.day,
				text: `${g.firstName} hangs. The name is struck from the ledger.`,
				kind: "death"
			}, ...nextLog].slice(0, 80);
			const selectedId = s.selectedId && gone.some((g) => g.id === s.selectedId) ? null : s.selectedId;
			const next = withTotals({
				...s,
				subjects: keep,
				log: nextLog,
				selectedId,
				speech: s.speech.filter((l) => !gone.some((g) => g.id === l.fromId || g.id === l.toId))
			});
			persist(next);
			set(next);
		}
	}
}));
function Key({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", {
		className: "keycap",
		children
	});
}
function poundsFromSats(sats, tape) {
	return satsToGbp(sats, tapeGbp(tape)).toFixed(2);
}
function AgentSelect({ id, label, choice, model, catalog, onChange }) {
	const selectValue = model ? `${choice}:${model}` : choice;
	const scanWits = useGame((s) => s.scanWits);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
		className: "field-label",
		htmlFor: id,
		children: label
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
		id,
		className: "wits-select",
		value: selectValue,
		onFocus: () => void scanWits(),
		onChange: (e) => {
			const [next, ...rest] = e.target.value.split(":");
			onChange(next || "auto", rest.join(":"));
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
				value: "auto",
				children: "Auto — local, then Grok"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("optgroup", {
				label: "On this machine",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: "ollama",
						children: "Ollama (any local model)"
					}),
					catalog.ollama.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
						value: `ollama:${m}`,
						children: ["Ollama · ", m]
					}, `${id}-o-${m}`)),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: "lmstudio",
						children: "LM Studio"
					}),
					catalog.lmstudio.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
						value: `lmstudio:${m}`,
						children: ["LM Studio · ", m]
					}, `${id}-l-${m}`)),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: "chrome",
						children: "On-device model"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("optgroup", {
				label: "Online",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
					value: "grok",
					children: "Grok"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
					value: "pollinations",
					children: "Free online wits"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
				value: "heuristic",
				children: "Heuristic (no model)"
			})
		]
	})] });
}
function TalkForm({ toId, name }) {
	const converse = useGame((s) => s.converse);
	const talking = useGame((s) => s.talking);
	const dawnRunning = useGame((s) => s.dawnRunning);
	const [text, setText] = (0, import_react.useState)("");
	const busy = talking || dawnRunning;
	const parish = toId == null;
	async function send(shout) {
		const t = text.trim();
		if (!t || busy) return;
		setText("");
		await converse(toId, t, shout || parish);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "talk-form",
		onSubmit: (e) => {
			e.preventDefault();
			send(parish);
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				className: "field-label",
				htmlFor: `talk-${toId ?? "parish"}`,
				children: parish ? "Speak to the parish" : `Speak to ${name}`
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
				id: `talk-${toId ?? "parish"}`,
				className: "talk-input",
				rows: 3,
				value: text,
				disabled: busy,
				placeholder: parish ? "Shout to the square…" : `A word for ${name}…`,
				onChange: (e) => setText(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						send(parish);
					}
				}
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "talk-actions",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "submit",
					className: "ledger-btn",
					disabled: busy || !text.trim(),
					children: busy ? "Listening…" : parish ? "Shout" : "Say"
				}), parish ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "ledger-btn",
					disabled: busy || !text.trim(),
					onClick: () => void send(true),
					children: "Shout"
				})]
			})
		]
	});
}
function WalletInspect({ target, tape }) {
	const select = useGame((s) => s.select);
	const updateWallet = useGame((s) => s.updateWallet);
	const refreshChain = useGame((s) => s.refreshChain);
	const setAgent = useGame((s) => s.setAgent);
	const catalog = useGame((s) => s.brainCatalog);
	const scanWits = useGame((s) => s.scanWits);
	const [addr, setAddr] = (0, import_react.useState)(target.wallet);
	const [pounds, setPounds] = (0, import_react.useState)(poundsFromSats(target.testBalance, tape));
	const [mode, setMode] = (0, import_react.useState)(target.walletMode);
	const [err, setErr] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const testing = mode === "test";
	(0, import_react.useEffect)(() => {
		setAddr(target.wallet);
		setPounds(poundsFromSats(target.testBalance, tape));
		setMode(target.walletMode);
		setErr("");
	}, [
		target.id,
		target.wallet,
		target.testBalance,
		target.walletMode,
		tape.btcGbp
	]);
	function apply(nextMode = mode) {
		const n = Number(pounds);
		if (nextMode === "test" && (!Number.isFinite(n) || n < 0)) {
			setErr("Test purse must be a number of pounds.");
			return false;
		}
		const sats = n <= 0 ? 0 : gbpToSats(n, tapeGbp(tape));
		const msg = updateWallet(target.id, {
			wallet: addr,
			testBalance: sats,
			walletMode: nextMode
		});
		if (msg) {
			setErr(msg);
			return false;
		}
		setErr("");
		return true;
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "inspect",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "inspect-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "section-label",
					children: target.king ? "Crown" : "Wallet"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "text-btn",
					onClick: () => select(null),
					children: "Close"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "inspect-name",
				children: [target.king ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Crown, { size: 16 }) : null, target.title]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "stat-num",
				children: formatPurse(target.balance, tape)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "hint",
				children: [
					"Shown: ",
					target.walletMode === "chain" ? "on-chain watch" : "test purse",
					" · test",
					" ",
					formatPurse(target.testBalance, tape),
					target.chainBalance != null ? ` · chain ${formatPurse(target.chainBalance, tape)}` : ""
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AgentSelect, {
				id: `agent-${target.id}`,
				label: target.king ? "King's agent" : "Linked agent",
				choice: target.brainChoice,
				model: target.brainModel,
				catalog,
				onChange: (choice, model) => setAgent(target.id, choice, model)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hint",
				children: target.king ? "Commands the parish. Cannot make anyone." : "This agent must think and make money online for the wallet, or the King's tax hangs them."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "text-btn",
				onClick: () => void scanWits(),
				children: "Find local models"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				className: "field-label",
				htmlFor: `wallet-addr-${target.id}`,
				children: "Bitcoin address"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id: `wallet-addr-${target.id}`,
				className: "wallet-input",
				value: addr,
				spellCheck: false,
				autoComplete: "off",
				onChange: (e) => setAddr(e.target.value)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "field-label",
				htmlFor: `wallet-gbp-${target.id}`,
				children: ["Test purse (£)", testing ? "" : " — locked off-test"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id: `wallet-gbp-${target.id}`,
				className: "wallet-input",
				inputMode: "decimal",
				value: pounds,
				disabled: !testing,
				onChange: (e) => setPounds(e.target.value)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mode-row",
				role: "group",
				"aria-label": "Wallet mode",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: mode === "test" ? "mode-btn mode-btn-on" : "mode-btn",
					onClick: () => {
						setMode("test");
						apply("test");
					},
					children: "Test"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: mode === "chain" ? "mode-btn mode-btn-on" : "mode-btn",
					onClick: () => {
						setMode("chain");
						apply("chain");
					},
					children: "On-chain"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "wallet-actions",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "ledger-btn",
					onClick: () => apply(),
					children: "Apply"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "ledger-btn",
					disabled: busy,
					onClick: () => {
						if (!apply(mode)) return;
						setBusy(true);
						refreshChain(target.id).then((msg) => {
							setBusy(false);
							if (msg) setErr(msg);
						});
					},
					children: busy ? "Fetching…" : "Fetch chain"
				})]
			}),
			err ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "wallet-err",
				children: err
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hint",
				children: target.king ? "No keys are stored. The £20 stake and tax come from this test purse. Edit pounds only in Test mode. On-chain is watch-only." : "No keys are stored. This linked agent must make money online — the game pays no wage — or hang. Edit pounds only in Test mode. On-chain is watch-only."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hint",
				children: target.lastFlavor
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TalkForm, {
				toId: target.id,
				name: target.title
			})
		]
	});
}
function Ledger() {
	const exchequer = useGame((s) => s.exchequer);
	const king = useGame((s) => s.king);
	const subjects = useGame((s) => s.subjects);
	const taxRate = useGame((s) => s.taxRate);
	const tape = useGame((s) => s.tape);
	const day = useGame((s) => s.day);
	const log = useGame((s) => s.log);
	const dawnRunning = useGame((s) => s.dawnRunning);
	const selectedId = useGame((s) => s.selectedId);
	const brainChoice = useGame((s) => s.brainChoice);
	const brainModel = useGame((s) => s.brainModel);
	const catalog = useGame((s) => s.brainCatalog);
	const give = useGame((s) => s.give);
	const take = useGame((s) => s.take);
	const spawn = useGame((s) => s.spawn);
	const dawn = useGame((s) => s.dawn);
	const nudgeTax = useGame((s) => s.nudgeTax);
	const reset = useGame((s) => s.reset);
	const select = useGame((s) => s.select);
	const setBrain = useGame((s) => s.setBrain);
	const scanWits = useGame((s) => s.scanWits);
	const selected = selectedId === "king" ? null : subjects.find((s) => s.id === selectedId) ?? null;
	const living = subjects.filter((s) => s.state !== "hanging" && s.state !== "condemned");
	const spawnLabel = choiceLabel(brainChoice, brainModel, catalog);
	const kingTarget = {
		id: "king",
		title: king.name,
		wallet: king.wallet,
		walletMode: king.walletMode,
		testBalance: king.testBalance,
		chainBalance: king.chainBalance,
		balance: king.balance,
		lastFlavor: king.lastFlavor,
		king: true,
		brainChoice: king.brainChoice,
		brainModel: king.brainModel
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
		className: "ledger",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "ledger-head",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "ledger-kicker",
						children: "Parish of"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "Ledgerford" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "ledger-day",
						children: ["Day ", day]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "stat-grid",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "section-label",
					children: "Exchequer"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "stat-num",
					children: formatPurse(exchequer, tape)
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "section-label",
					children: "King"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "stat-hit",
					onClick: () => select("king"),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "stat-num",
						children: formatPurse(king.balance, tape)
					})
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hint",
				children: "Sum of every purse, in pounds. Click the King to link his agent."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "tithe-row",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "section-label",
						children: "King's tax — yours to set"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "tithe-controls",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "icon-btn",
								onClick: () => nudgeTax(-1),
								"aria-label": "Lower tax",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Minus, { size: 16 })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "tithe-value",
								children: [Math.round(taxRate * 100), "%"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "icon-btn",
								onClick: () => nudgeTax(1),
								"aria-label": "Raise tax",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { size: 16 })
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "hint",
						children: [
							"Those who cannot pay hang. The King cannot change this. ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Key, { children: "[" }),
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Key, { children: "]" })
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "tape-card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "section-label",
						children: "Make a soul"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AgentSelect, {
						id: "spawn-agent",
						label: "Link this agent",
						choice: brainChoice,
						model: brainModel,
						catalog,
						onChange: (choice, model) => setBrain(choice, model)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "hint",
						children: [
							"You make them. The King cannot. Linked: ",
							spawnLabel,
							". Costs £",
							20,
							" from the King. They must make money online or the tax hangs them."
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "ledger-btn",
						onClick: () => {
							if (spawn()) playSpawn();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserPlus, { size: 15 }),
							" Make soul ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Key, { children: "S" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "text-btn",
						onClick: () => void scanWits(),
						children: "Find local models"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "section-label",
				children: [
					"Parish · ",
					living.length,
					"/",
					24,
					" living"
				]
			}), living.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hint",
				children: "No souls yet. Link an agent and make one."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "parish-roll",
				children: living.map((sub) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "roll-hit",
					onClick: () => select(sub.id),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: sub.firstName }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "roll-money",
						children: formatPurse(sub.balance, tape)
					})]
				}) }, sub.id))
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "action-grid",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "ledger-btn",
						onClick: () => {
							playGive();
							give();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Coins, { size: 15 }),
							" Give ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Key, { children: "G" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "ledger-btn",
						onClick: () => {
							playGive();
							take();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wallet, { size: 15 }),
							" Take ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Key, { children: "T" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "ledger-btn ledger-btn-dawn",
						disabled: dawnRunning,
						onClick: () => {
							playDawn();
							dawn();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sun, { size: 15 }),
							" ",
							dawnRunning ? "Dawning…" : "Next dawn",
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Key, { children: "N" })
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "hint transfer",
				children: [
					"Give and Take £",
					50,
					". Make a soul spends £",
					20,
					". Upkeep £",
					RENT_GBP.toFixed(2),
					" plus the tax each dawn."
				]
			}),
			selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WalletInspect, {
				tape,
				target: {
					id: selected.id,
					title: selected.firstName,
					wallet: selected.wallet,
					walletMode: selected.walletMode,
					testBalance: selected.testBalance,
					chainBalance: selected.chainBalance,
					balance: selected.balance,
					lastFlavor: selected.lastFlavor,
					king: false,
					brainChoice: selected.brainChoice,
					brainModel: selected.brainModel
				}
			}) : selectedId === "king" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WalletInspect, {
				target: kingTarget,
				tape
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "inspect",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "section-label",
						children: "The square"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "hint",
						children: "Click a name to inspect wallet and linked agent — or shout below."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TalkForm, {
						toId: null,
						name: "the parish"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "log",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "section-label",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScrollText, { size: 13 }), " Chronicle"]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { children: log.slice(0, 14).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					"data-kind": entry.kind,
					children: entry.text
				}, entry.id)) })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", {
				className: "ledger-foot",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Click a soul to link an agent, edit the wallet, and speak. Esc deselects." }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "text-btn",
					onClick: reset,
					children: "New reign"
				})]
			})
		]
	});
}
var DIR_ROW = {
	down: 0,
	left: 1,
	right: 2,
	up: 3
};
function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => reject(/* @__PURE__ */ new Error(`Failed to load ${src}`));
		img.src = src;
	});
}
async function loadAssets() {
	const [map, king, man, woman, ...propImgs] = await Promise.all([
		loadImage("/assets/map/town-base.jpg"),
		loadImage("/assets/sprites/king.png"),
		loadImage("/assets/sprites/man.png"),
		loadImage("/assets/sprites/woman.png"),
		...TOWN_PROPS.map((p) => loadImage(p.src))
	]);
	const props = {};
	TOWN_PROPS.forEach((p, i) => {
		const im = propImgs[i];
		if (im) props[p.id] = im;
	});
	return {
		map,
		king,
		man,
		woman,
		props
	};
}
function sheetFrame(ctx, img, dir, frame, x, y, size, alpha = 1, rotation = 0, squashY = 1) {
	const fw = img.width / 4;
	const fh = img.height / 4;
	const col = frame % 4;
	const row = DIR_ROW[dir];
	const sy = squashY;
	const sx = 1 / Math.max(.55, sy);
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.imageSmoothingEnabled = false;
	ctx.translate(x, y - size * .45);
	ctx.rotate(rotation);
	ctx.scale(sx, sy);
	ctx.drawImage(img, col * fw, row * fh, fw, fh, -size / 2, -size * .55, size, size);
	ctx.restore();
}
function drawRope(ctx, fromX, fromY, toX, toY, alpha) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.lineCap = "round";
	ctx.strokeStyle = "#3a2818";
	ctx.lineWidth = 4.2;
	ctx.beginPath();
	ctx.moveTo(fromX, fromY);
	ctx.lineTo(toX, toY);
	ctx.stroke();
	ctx.strokeStyle = "#6b4a2c";
	ctx.lineWidth = 2.2;
	ctx.beginPath();
	ctx.moveTo(fromX + 1.2, fromY);
	ctx.lineTo(toX + 1.2, toY);
	ctx.stroke();
	ctx.strokeStyle = "#4a3422";
	ctx.lineWidth = 2.4;
	ctx.beginPath();
	ctx.ellipse(toX, toY + 7, 7, 9, .15, 0, Math.PI * 2);
	ctx.stroke();
	ctx.beginPath();
	ctx.ellipse(toX, toY + 5, 5.5, 4.2, -.2, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}
function drawDust(ctx, t, alpha) {
	if (t < .12 || t > 1.35) return;
	const life = Math.min(1, (t - .12) / .9);
	ctx.save();
	for (let i = 0; i < 9; i++) {
		const a = i / 9 * Math.PI * 2;
		const dist = 10 + life * (18 + i % 3 * 8);
		const x = GALLOWS_DROP.x + Math.cos(a) * dist;
		const y = GALLOWS_DROP.y + 6 + Math.sin(a) * dist * .35;
		ctx.globalAlpha = alpha * (1 - life) * .45;
		ctx.fillStyle = "#c4b08a";
		ctx.beginPath();
		ctx.arc(x, y, 2.4 - life, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}
function drawHanging(ctx, img, sub) {
	const t = sub.hangT;
	const dropDur = .42;
	const drop = t < dropDur ? t / dropDur * (t / dropDur) : 1;
	const restLen = 108;
	const swingAmp = 34 * Math.exp(-Math.max(0, t - dropDur) * .42) * drop;
	const phase = t * 5.2;
	const swing = Math.sin(phase) * swingAmp;
	const rot = Math.sin(phase) * .38 * drop + .08;
	const fade = t > 5.1 ? Math.max(0, 1 - (t - 5.1) / 1.1) : 1;
	const stretch = t < dropDur ? 1.18 : 1.02 + Math.sin(phase) * .04;
	const beamX = GALLOWS_BEAM.x;
	const beamY = GALLOWS_BEAM.y;
	const hx = beamX + swing;
	const hy = beamY + 22 + drop * restLen;
	drawRope(ctx, beamX, beamY, hx, hy - 10, fade);
	drawDust(ctx, t, fade);
	sheetFrame(ctx, img, "down", 0, hx, hy, 44, fade, rot, stretch);
}
function drawProp(ctx, img, p) {
	ctx.drawImage(img, p.x - p.w / 2, p.y - p.h * .85, p.w, p.h);
}
function worldToScreen(x, y, scale, ox, oy) {
	return {
		x: ox + x * scale,
		y: oy + y * scale
	};
}
function roundRect(ctx, x, y, w, h, r) {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}
function wrapText(ctx, text, maxW) {
	const words = text.split(/\s+/);
	const lines = [];
	let cur = "";
	for (const word of words) {
		const next = cur ? `${cur} ${word}` : word;
		if (ctx.measureText(next).width > maxW && cur) {
			lines.push(cur);
			cur = word;
		} else cur = next;
	}
	if (cur) lines.push(cur);
	return lines.slice(0, 4);
}
function drawHeadCard(ctx, sx, headY, title, money, selected) {
	ctx.save();
	ctx.font = "600 11px \"Source Serif 4\", \"Palatino Linotype\", serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	const titleW = ctx.measureText(title).width;
	ctx.font = "500 10px \"IBM Plex Mono\", ui-monospace, monospace";
	const moneyW = ctx.measureText(money).width;
	const w = Math.max(titleW, moneyW) + 16;
	const h = 32;
	const x = sx - w / 2;
	const y = headY - h - 6;
	roundRect(ctx, x, y, w, h, 6);
	ctx.fillStyle = selected ? "rgba(255, 248, 228, 0.94)" : "rgba(244, 232, 200, 0.9)";
	ctx.fill();
	ctx.strokeStyle = selected ? "rgba(107, 66, 38, 0.7)" : "rgba(74, 61, 42, 0.45)";
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.font = "600 11px \"Source Serif 4\", \"Palatino Linotype\", serif";
	ctx.fillStyle = "#2c2416";
	ctx.fillText(title, sx, y + 3);
	ctx.font = "500 10px \"IBM Plex Mono\", ui-monospace, monospace";
	ctx.fillStyle = "#6b4226";
	ctx.fillText(money, sx, y + 16);
	ctx.restore();
	return y;
}
function drawBubble(ctx, sx, topY, text, shout) {
	ctx.save();
	ctx.font = shout ? "600 12px \"Cinzel\", \"Times New Roman\", serif" : "500 11px \"Source Serif 4\", \"Palatino Linotype\", serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	const maxW = shout ? 180 : 150;
	const lines = wrapText(ctx, text, maxW);
	const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
	const w = Math.min(maxW, textW) + 16;
	const h = lines.length * 14 + 10;
	const x = sx - w / 2;
	const y = topY - h - 8;
	roundRect(ctx, x, y, w, h, 8);
	ctx.fillStyle = shout ? "rgba(139, 44, 44, 0.92)" : "rgba(255, 252, 242, 0.95)";
	ctx.fill();
	ctx.strokeStyle = shout ? "rgba(244, 232, 200, 0.8)" : "rgba(107, 66, 38, 0.45)";
	ctx.lineWidth = shout ? 1.6 : 1;
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(sx - 6, y + h);
	ctx.lineTo(sx, y + h + 7);
	ctx.lineTo(sx + 6, y + h);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = shout ? "#f4e8c8" : "#2c2416";
	lines.forEach((line, i) => ctx.fillText(line, sx, y + 5 + i * 14));
	ctx.restore();
}
function drawOverlays(ctx, opts, scale, ox, oy) {
	const tops = /* @__PURE__ */ new Map();
	const kingScr = worldToScreen(opts.king.x, opts.king.y, scale, ox, oy);
	const kingHead = kingScr.y - 54 * scale * .92;
	const kingTop = drawHeadCard(ctx, kingScr.x, kingHead, "His Majesty", formatPurse(opts.king.balance, opts.tape), opts.selectedId === "king");
	tops.set("king", kingTop);
	for (const sub of opts.subjects) {
		if (sub.state === "hanging") continue;
		const scr = worldToScreen(sub.x, sub.y, scale, ox, oy);
		const head = scr.y - 44 * scale * .92;
		const top = drawHeadCard(ctx, scr.x, head, sub.firstName, formatPurse(sub.balance, opts.tape), opts.selectedId === sub.id);
		tops.set(sub.id, top);
	}
	for (const line of opts.speech) {
		if (line.age < 0 || line.age > line.life) continue;
		const who = line.fromId === "king" ? opts.king : opts.subjects.find((x) => x.id === line.fromId);
		if (!who) continue;
		if ("state" in who && who.state === "hanging") continue;
		const fade = line.age < .2 ? line.age / .2 : line.age > line.life - .4 ? (line.life - line.age) / .4 : 1;
		ctx.save();
		ctx.globalAlpha = Math.max(0, fade);
		const top = tops.get(line.fromId) ?? 80;
		drawBubble(ctx, worldToScreen(who.x, who.y, scale, ox, oy).x, top, line.text, line.shout);
		ctx.restore();
	}
}
function hitTest(subjects, king, wx, wy) {
	const hits = [];
	for (const s of subjects) {
		if (s.state === "hanging") continue;
		const d = Math.hypot(s.x - wx, s.y - 22 - wy);
		if (d < 28) hits.push({
			id: s.id,
			d
		});
	}
	const kd = Math.hypot(king.x - wx, king.y - 27 - wy);
	if (kd < 32) hits.push({
		id: "king",
		d: kd
	});
	hits.sort((a, b) => a.d - b.d);
	return hits[0]?.id ?? null;
}
function drawTown(ctx, assets, opts) {
	const viewW = opts.viewW;
	const viewH = opts.viewH;
	const cam = opts.cam ?? DEFAULT_CAM;
	const { scale, ox, oy } = viewTransform(viewW, viewH, cam);
	ctx.fillStyle = "#1a1610";
	ctx.fillRect(0, 0, viewW, viewH);
	ctx.save();
	ctx.translate(ox, oy);
	ctx.scale(scale, scale);
	ctx.drawImage(assets.map, 0, 0, MAP_W, MAP_H);
	const drawables = [];
	for (const p of TOWN_PROPS) {
		const img = assets.props[p.id];
		if (!img) continue;
		drawables.push({
			y: p.y,
			draw: () => drawProp(ctx, img, p)
		});
	}
	drawables.push({
		y: opts.king.y,
		draw: () => sheetFrame(ctx, assets.king, opts.king.dir, opts.king.frame, opts.king.x, opts.king.y, 54)
	});
	for (const sub of opts.subjects) {
		const img = sub.body === "woman" ? assets.woman : assets.man;
		drawables.push({
			y: sub.state === "hanging" ? GALLOWS_BEAM.y + 40 : sub.y,
			draw: () => {
				if (sub.state === "hanging") drawHanging(ctx, img, sub);
				else sheetFrame(ctx, img, sub.dir, sub.frame, sub.x, sub.y, 44);
			}
		});
	}
	drawables.sort((a, b) => a.y - b.y);
	for (const d of drawables) d.draw();
	ctx.restore();
	if (cam.zoom > 1.2) {
		const g = ctx.createRadialGradient(viewW * .5, viewH * .45, viewH * .12, viewW * .5, viewH * .5, viewW * .72);
		g.addColorStop(0, "rgba(0,0,0,0)");
		g.addColorStop(1, "rgba(12, 8, 6, 0.42)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, viewW, viewH);
	}
	drawOverlays(ctx, opts, scale, ox, oy);
	return {
		scale,
		ox,
		oy
	};
}
function TownCanvas() {
	const canvasRef = (0, import_react.useRef)(null);
	const assetsRef = (0, import_react.useRef)(null);
	const rafRef = (0, import_react.useRef)(0);
	const lastRef = (0, import_react.useRef)(0);
	const camRef = (0, import_react.useRef)({ ...DEFAULT_CAM });
	const traumaRef = (0, import_react.useRef)(0);
	const wasHangingRef = (0, import_react.useRef)(false);
	(0, import_react.useEffect)(() => {
		let alive = true;
		loadAssets().then((a) => {
			if (alive) assetsRef.current = a;
		});
		return () => {
			alive = false;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const loop = (now) => {
			const last = lastRef.current || now;
			const dt = Math.min((now - last) / 1e3, .1);
			lastRef.current = now;
			useGame.getState().tick(dt);
			const ctx = canvas.getContext("2d");
			const assets = assetsRef.current;
			if (ctx && assets) {
				const dpr = Math.min(window.devicePixelRatio || 1, 2);
				const rect = canvas.getBoundingClientRect();
				const w = Math.max(1, Math.floor(rect.width * dpr));
				const h = Math.max(1, Math.floor(rect.height * dpr));
				if (canvas.width !== w || canvas.height !== h) {
					canvas.width = w;
					canvas.height = h;
				}
				const viewW = w / dpr;
				const viewH = h / dpr;
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				const s = useGame.getState();
				const hanging = s.subjects.find((x) => x.state === "hanging");
				const condemned = s.subjects.find((x) => x.state === "condemned");
				const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
				if (hanging && !wasHangingRef.current) traumaRef.current = .92;
				wasHangingRef.current = Boolean(hanging);
				let targetCx = DEFAULT_CAM.cx;
				let targetCy = DEFAULT_CAM.cy;
				let targetZoom = 1;
				let rate = 3.2;
				if (hanging) {
					targetCx = GALLOWS_BEAM.x;
					targetCy = GALLOWS_BEAM.y + 90;
					targetZoom = reduce ? 1.55 : 2.55;
					rate = 9;
				} else if (condemned) {
					targetCx = condemned.x * .4 + GALLOWS_DROP.x * .6;
					targetCy = condemned.y * .4 + GALLOWS_DROP.y * .6;
					targetZoom = reduce ? 1.3 : 1.9;
					rate = 4.2;
				}
				const k = 1 - Math.exp(-dt * rate);
				const cam = camRef.current;
				cam.cx += (targetCx - cam.cx) * k;
				cam.cy += (targetCy - cam.cy) * k;
				cam.zoom += (targetZoom - cam.zoom) * k;
				if (hanging && cam.zoom < targetZoom * .92) {
					cam.cx = targetCx;
					cam.cy = targetCy;
					cam.zoom = targetZoom;
				}
				traumaRef.current = Math.max(0, traumaRef.current - dt * 1.8);
				const shake = reduce ? 0 : traumaRef.current * traumaRef.current;
				cam.shakeX = shake * 10 * Math.sin(now * .063);
				cam.shakeY = shake * 7 * Math.cos(now * .081);
				camRef.current = cam;
				window.__lfCam = {
					...cam,
					focus: hanging ? "hang" : condemned ? "walk" : "town"
				};
				drawTown(ctx, assets, {
					king: s.king,
					subjects: s.subjects,
					selectedId: s.selectedId,
					viewW,
					viewH,
					cam,
					tape: s.tape,
					speech: s.speech
				});
			}
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(rafRef.current);
	}, []);
	function onPointer(e) {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const { scale, ox, oy } = viewTransform(rect.width, rect.height, camRef.current);
		const wx = (e.clientX - rect.left - ox) / scale;
		const wy = (e.clientY - rect.top - oy) / scale;
		const s = useGame.getState();
		const id = hitTest(s.subjects, s.king, wx, wy);
		s.select(id);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
		ref: canvasRef,
		className: "town-canvas",
		onPointerDown: onPointer,
		"aria-label": "Ledgerford market square"
	});
}
function ShoutBanner() {
	const [text, setText] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		let raf = 0;
		const loop = () => {
			const s = useGame.getState();
			const line = s.speech.find((l) => l.shout && l.age >= 0 && l.age < l.life);
			let next = null;
			if (line) next = `${line.fromId === "king" ? "The King" : line.fromId === "you" ? "You" : s.subjects.find((x) => x.id === line.fromId)?.firstName ?? "A voice"}: ${line.text}`;
			setText((prev) => prev === next ? prev : next);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, []);
	if (!text) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "shout-banner",
		children: text
	});
}
function Game() {
	const started = useGame((s) => s.started);
	const dawnRunning = useGame((s) => s.dawnRunning);
	const gallowsBusy = useGame((s) => s.subjects.some((x) => x.state === "hanging" || x.state === "condemned"));
	const hanging = useGame((s) => s.subjects.some((x) => x.state === "hanging"));
	const boot = useGame((s) => s.boot);
	const start = useGame((s) => s.start);
	const refreshTape = useGame((s) => s.refreshTape);
	(0, import_react.useEffect)(() => {
		boot();
		refreshTape();
		window.__ledgerford = {
			give: () => useGame.getState().give(),
			take: () => useGame.getState().take(),
			spawn: () => useGame.getState().spawn(),
			dawn: () => useGame.getState().dawn(),
			tax: () => useGame.getState().taxRate,
			subjects: () => useGame.getState().subjects.length,
			king: () => useGame.getState().king.balance,
			exchequer: () => useGame.getState().exchequer,
			ruin: () => {
				const s = useGame.getState();
				const subjects = s.subjects.map((sub) => ({
					...sub,
					testBalance: 200,
					balance: sub.walletMode === "chain" && sub.chainBalance != null ? sub.chainBalance : 200
				}));
				useGame.setState({
					subjects,
					exchequer: sumExchequer(s.king, subjects)
				});
			},
			hangNow: () => {
				const s = useGame.getState();
				if (!s.subjects[0]) return;
				useGame.setState({ subjects: s.subjects.map((sub, i) => i === 0 ? {
					...sub,
					testBalance: 0,
					balance: 0,
					state: "condemned",
					hangT: 0,
					x: GALLOWS_DROP.x - 36,
					y: GALLOWS_DROP.y + 18,
					destX: GALLOWS_DROP.x,
					destY: GALLOWS_DROP.y
				} : sub) });
			},
			selectFirst: () => {
				const s = useGame.getState();
				const id = s.subjects[0]?.id ?? "king";
				s.select(id);
			},
			selectKing: () => useGame.getState().select("king"),
			fundFirst: (sats = 5e4) => {
				const s = useGame.getState();
				const first = s.subjects[0];
				if (!first) return;
				s.updateWallet(first.id, {
					testBalance: sats,
					walletMode: "test"
				});
			},
			fundKing: (sats = 5e4) => {
				useGame.getState().updateWallet("king", {
					testBalance: sats,
					walletMode: "test"
				});
			},
			converse: (toId, text, shout) => useGame.getState().converse(toId, text, shout),
			snapshot: () => {
				const s = useGame.getState();
				return {
					day: s.day,
					king: s.king.balance,
					kingTest: s.king.testBalance,
					kingWallet: s.king.wallet,
					kingMode: s.king.walletMode,
					kingAgent: `${s.king.brainChoice}${s.king.brainModel ? `:${s.king.brainModel}` : ""}`,
					spawnAgent: `${s.brainChoice}${s.brainModel ? `:${s.brainModel}` : ""}`,
					exchequer: s.exchequer,
					tax: s.taxRate,
					talking: s.talking,
					brain: s.brain,
					subjects: s.subjects.map((x) => ({
						name: x.firstName,
						balance: x.balance,
						testBalance: x.testBalance,
						chainBalance: x.chainBalance,
						walletMode: x.walletMode,
						wallet: x.wallet,
						state: x.state,
						hangT: Number(x.hangT.toFixed(2)),
						x: Math.round(x.x),
						y: Math.round(x.y),
						agent: `${x.brainChoice}${x.brainModel ? `:${x.brainModel}` : ""}`
					})),
					tape: s.tape,
					speech: s.speech.map((l) => ({
						from: l.fromId,
						to: l.toId,
						shout: l.shout,
						text: l.text,
						age: Number(l.age.toFixed(2))
					})),
					log0: s.log[0]?.text
				};
			}
		};
	}, [boot, refreshTape]);
	(0, import_react.useEffect)(() => {
		function onKey(e) {
			if (!useGame.getState().started) {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					unlockAudio();
					start();
				}
				return;
			}
			const tag = e.target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			const s = useGame.getState();
			switch (e.key) {
				case "g":
				case "G":
					playGive();
					s.give();
					break;
				case "t":
				case "T":
					playGive();
					s.take();
					break;
				case "s":
				case "S":
					if (s.spawn()) playSpawn();
					break;
				case "n":
				case "N":
				case " ":
					e.preventDefault();
					if (!s.dawnRunning) {
						playDawn();
						s.dawn();
					}
					break;
				case "[":
				case "-":
				case "_":
					s.nudgeTax(-1);
					break;
				case "]":
				case "=":
				case "+":
					s.nudgeTax(1);
					break;
				case "Escape": s.select(null);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [start]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "app-shell",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "town-pane",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TownCanvas, {}),
				!started ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "gate",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "gate-card",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "ledger-kicker",
								children: "A market town of linked agents"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "Ledgerford" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "gate-copy",
								children: "You make each soul and link it to an AI agent that must think and make money online for its own wallet. The King cannot make anyone — he only commands, and his tax hangs those who cannot pay. The game pays no wage. In Test mode you may edit any wallet in pounds. On-chain is watch-only. No keys are kept."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "gate-btn",
								onClick: () => {
									unlockAudio();
									start();
								},
								children: "Open the gates"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "hint",
								children: "G fund the King · S make a soul · N dawn · click a name"
							})
						]
					})
				}) : null,
				dawnRunning ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "dawn-banner",
					children: "The cock crows. Dawn is reckoned."
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShoutBanner, {}),
				started && gallowsBusy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "gallows-banner",
					children: hanging ? "The rope takes its due." : "Walked to the gallows."
				}) : null
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ledger, {})]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Game, {});
}
//#endregion
export { Home as component };

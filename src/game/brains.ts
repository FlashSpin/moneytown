import { SHOUT_LIFE, SPEECH_LIFE } from "./constants";
import type { Side } from "./dawn";
import type { SpeechLine, SubjectAction, Tape } from "./types";
import { pick, uid } from "./wallets";

const SQUARE_MUTTER = [
  "The game pays no wage. We must earn online.",
  "The King's tax comes due. Make money in the world, or the rope.",
  "Keep thy purse close, neighbour.",
  "A real wallet, or a test edit — nothing in-game.",
  "The chain is watch-only; no keys in this parish.",
  "If the purse cannot pay the tax, we hang.",
  "Twenty pound to start. Link thy agent, and work online.",
];

const PAIR_TALK: [string, string][] = [
  ["Hast thou made any money online?", "Not a penny from the game — only the world pays."],
  ["The tax is heavy upon us.", "Then earn beyond these walls, or the rope shall."],
  ["The player linked an agent to me.", "Think, then, and fill the purse — or hang."],
  ["The chain is watch-only, neighbour.", "Aye — no keys are kept here."],
  ["Shall we idle?", "Idle and hang. Go online."],
];

const VILLAGER_SHOUTS = [
  "Hear the square! No wage in the game!",
  "Neighbours — make money online, or the tax shall take us!",
  "Watch the chain! That is real coin!",
  "Twenty pound to start — do not waste it!",
];

const KING_SHOUTS = [
  "Hear ye! Make money online. The game pays nothing.",
  "I cannot make souls. Those already made: earn, or the tax shall hang you.",
  "My subjects — I command you. Work beyond these walls.",
  "Peace in the parish. Talk, work online, pay the tax.",
];

const KING_ASIDES = [
  "I command these wallets. I cannot make anyone.",
  "Pay my tax, or the rope. Earn in the world.",
  "The player makes souls and links their agents. I only command.",
];

export function subjectFlavor(
  name: string,
  action: SubjectAction,
  _side: Side,
  _income: number,
  _tape: Tape,
): string {
  if (action === "idle") {
    return `${name} idles. The game pays no wage. The tax still falls.`;
  }
  if (action === "walk") {
    return `${name} walks the parish, seeking work online.`;
  }
  return `${name} works online. No coin is made inside the game — only a real wallet or a test edit can grow the purse.`;
}

export function kingFlavor(): string {
  return "The King holds, and commands those already made to make money online. He cannot make anyone.";
}

function line(
  rng: () => number,
  fromId: string,
  toId: string | null,
  text: string,
  shout: boolean,
  delay: number,
): SpeechLine {
  return {
    id: uid("t", rng),
    fromId,
    toId,
    text,
    shout,
    age: -delay,
    life: shout ? SHOUT_LIFE : SPEECH_LIFE,
    heard: false,
    logged: false,
  };
}

export function heuristicTalks(
  rng: () => number,
  kingSay: string,
  living: { id: string; firstName: string; say: string }[],
): SpeechLine[] {
  const out: SpeechLine[] = [];
  let delay = 0.3;
  if (kingSay.trim()) {
    const shout = kingSay.length > 42 || /hear ye|subjects|crown/i.test(kingSay);
    out.push(line(rng, "king", null, trimSpeech(kingSay), shout, delay));
    delay += shout ? 3.2 : 2.4;
  }
  if (living.length >= 2 && rng() > 0.35) {
    const a = living[Math.floor(rng() * living.length)]!;
    const rest = living.filter((x) => x.id !== a.id);
    const b = rest[Math.floor(rng() * rest.length)]!;
    const pair = pick(PAIR_TALK, rng);
    out.push(line(rng, a.id, b.id, pair[0], false, delay));
    delay += 2.6;
    out.push(line(rng, b.id, a.id, pair[1], false, delay));
    delay += 2.8;
  }
  if (living.length && rng() > 0.55) {
    const loud = living[Math.floor(rng() * living.length)]!;
    out.push(line(rng, loud.id, null, pick(VILLAGER_SHOUTS, rng), true, delay));
    delay += 3.4;
  }
  for (const s of living) {
    if (s.say.trim() && rng() > 0.45) {
      out.push(line(rng, s.id, null, trimSpeech(s.say), false, delay));
      delay += 1.8;
    }
  }
  return out.slice(0, 8);
}

export function ambientTalk(
  rng: () => number,
  living: { id: string }[],
  kingIdle: boolean,
): SpeechLine | SpeechLine[] | null {
  if (!living.length) {
    if (!kingIdle) return null;
    return line(rng, "king", null, pick(KING_ASIDES, rng), rng() > 0.7, 0);
  }
  if (rng() > 0.82) {
    return line(rng, "king", null, pick(KING_SHOUTS, rng), true, 0);
  }
  if (living.length >= 2 && rng() > 0.4) {
    const a = living[Math.floor(rng() * living.length)]!;
    const rest = living.filter((x) => x.id !== a.id);
    const b = rest[Math.floor(rng() * rest.length)]!;
    const pair = pick(PAIR_TALK, rng);
    return [
      line(rng, a.id, b.id, pair[0], false, 0),
      line(rng, b.id, a.id, pair[1], false, 2.4),
    ];
  }
  if (rng() > 0.78) {
    const loud = living[Math.floor(rng() * living.length)]!;
    return line(rng, loud.id, null, pick(VILLAGER_SHOUTS, rng), true, 0);
  }
  const s = living[Math.floor(rng() * living.length)]!;
  return line(rng, s.id, null, pick(SQUARE_MUTTER, rng), false, 0);
}

export function trimSpeech(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 90) return t;
  return `${t.slice(0, 87).replace(/\s+\S*$/, "")}…`;
}

export function heuristicReply(opts: {
  king: boolean;
  name: string;
  playerText: string;
  shout: boolean;
}): { say: string; shout: boolean } {
  const t = opts.playerText.toLowerCase();
  if (opts.king) {
    if (/tithe|tax/.test(t)) {
      return { say: "The tax is thine to set. Those who cannot pay it hang. I shall not touch the rate.", shout: opts.shout };
    }
    if (/make|spawn|create|soul/.test(t)) {
      return { say: "I cannot make anyone. Thou makest souls, and linkest each to an agent.", shout: false };
    }
    if (/coin|money|grant|gift|give|stake/.test(t)) {
      return { say: "Twenty pound is the start. After that they make money online, or my tax hangs them.", shout: false };
    }
    if (/hang|gallows|rope/.test(t)) {
      return { say: "The rope is for a purse that owed my tax and could not pay.", shout: false };
    }
    if (/wallet|address|chain/.test(t)) {
      return { say: "My wallet is watched as thine is. No keys are kept in this parish.", shout: false };
    }
    if (opts.shout) return { say: pick(KING_SHOUTS, Math.random), shout: true };
    return { say: pick(KING_ASIDES, Math.random), shout: false };
  }
  if (/tithe|tax/.test(t)) {
    return { say: "The King's tax is heavy — if the purse holds not, the rope will.", shout: false };
  }
  if (/agent|wits|model|ai/.test(t)) {
    return { say: "I am the agent linked to this soul. I must think, and make money online.", shout: false };
  }
  if (/tape|bitcoin|market/.test(t)) {
    return { say: "No market in this game pays us. We make money online, or we hang.", shout: false };
  }
  if (/hang|gallows|rope/.test(t)) {
    return { say: "Speak not of the rope. Pay the tax, and it shall not find me.", shout: false };
  }
  if (/wallet|address|chain/.test(t)) {
    return { say: "Watch-only, neighbour. No keys. Coin from the world, not the game.", shout: false };
  }
  if (opts.shout) return { say: pick(VILLAGER_SHOUTS, Math.random), shout: true };
  return { say: pick(SQUARE_MUTTER, Math.random), shout: false };
}

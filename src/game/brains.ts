import { SHOUT_LIFE, SPEECH_LIFE } from "./constants";
import type { Asset } from "./dawn";
import type { SpeechLine } from "./types";
import { pick, uid } from "./wallets";

const SQUARE_MUTTER = [
  "The markets move whether we watch or no. Mind thy position.",
  "The King's tax comes due. Trade well, or the rope.",
  "Keep thy purse close, neighbour.",
  "Long, short, or flat — choose, and live with it.",
  "The chain is watch-only; no keys in this parish.",
  "If the purse cannot pay the tax, we hang.",
  "Twenty pound to start. Link thy agent, and trade wisely.",
];

const PAIR_TALK: [string, string][] = [
  ["Hast thou made any money on the markets?", "Some days the tape favours me, some days not."],
  ["The tax is heavy upon us.", "Then trade well beyond these walls, or the rope shall."],
  ["The King linked an agent to me.", "Think, then, and mind the purse — or hang."],
  ["The chain is watch-only, neighbour.", "Aye — no keys are kept here."],
  ["Shall we sit flat?", "Sit too long and the tax still comes. Choose a side."],
];

const VILLAGER_SHOUTS = [
  "Hear the square! Watch the tape, mind thy purse!",
  "Neighbours — trade with care, or the tax shall take us!",
  "Watch the chain! That is real coin!",
  "Twenty pound to start — do not waste it on a bad bet!",
];

const KING_SHOUTS = [
  "Hear ye! Trade the markets with care. The purse that gambles ill shall hang.",
  "My treasury opens new souls only while the old ones prove they can trade. Prosper, or the rope.",
  "My subjects — I favour a market. Weigh my counsel, but think for yourselves.",
  "Peace in the parish. Talk, trade well, pay the tax.",
];

const KING_ASIDES = [
  "I command these wallets, and my treasury opens new souls for those who trade well.",
  "Pay my tax, or the rope. Mind the markets.",
  "The treasury opens new souls of its own accord. I set the favoured market and command.",
];

const ASSET_NOUN: Record<Asset, string> = { BTC: "Bitcoin", ETH: "Ether", SOL: "Solana" };

export function kingFlavor(favorAsset: Asset): string {
  return `The King commands the parish and favours ${ASSET_NOUN[favorAsset] ?? favorAsset} this day. His treasury opens new souls only while they trade well.`;
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

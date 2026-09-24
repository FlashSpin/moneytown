import { SHOUT_LIFE, SPEECH_LIFE } from "./constants";
import { FUNDS, type FundId } from "./merchant";
import type { SpeechLine } from "./types";
import { pick, uid } from "./wallets";

const SQUARE_MUTTER = [
  "The markets move whether we watch or no. Mind thy funds.",
  "A thousand pound in an ISA — invest it well, and let time work.",
  "Keep thy money spread, neighbour. No single storm sinks a wide purse.",
  "Shares for growth, bonds for ballast, gold for the storm.",
  "The guild's dues are only on gains. Grow, and pay gladly.",
  "Trade seldom. Every trade costs a little.",
  "Beat the sixty-forty, and the season is ours.",
];

const PAIR_TALK: [string, string][] = [
  ["Hast thou grown thine ISA this month?", "A little. The bonds held while the shares wobbled."],
  ["Art thou above the sixty-forty?", "By a whisker — ask me again at the season's end."],
  ["The trend guard sold my shares.", "Aye — it steps aside when prices fall below their average."],
  ["Why not put it all in one fund?", "Because one fund can fall by half. I have seen it."],
  ["Momentum has me in gold now.", "Then gold has been the strongest of late."],
];

const VILLAGER_SHOUTS = [
  "Hear the square! Spread thy money, mind the costs!",
  "Neighbours — the funds closed higher today!",
  "Patience, all! An ISA grows over years, not days!",
  "Beat the sixty-forty, and the season is won!",
];

const KING_SHOUTS = [
  "Hear ye! Invest with care and patience. The purse that squanders its stake shall hang.",
  "My treasury stakes new merchants while the old ones prove they can grow their ISAs.",
  "My subjects — I favour a fund. Weigh my counsel, but think for yourselves.",
  "Peace in the guild. Invest wisely, trade seldom, pay the dues.",
];

const KING_ASIDES = [
  "I stake these merchants, and my treasury opens more for those who grow their funds.",
  "Beat the sixty-forty, and the guild prospers.",
  "The treasury stakes new merchants of its own accord. I set the favoured fund and command.",
];

export function kingFlavor(favorAsset: FundId): string {
  return `The King commands the guild and favours ${FUNDS[favorAsset]?.name ?? favorAsset} this day. His treasury stakes new merchants while the guild grows.`;
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

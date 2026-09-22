import type { Asset } from "./dawn.ts";

/**
 * Sats — there's no more player "Give" button to fund the treasury by hand,
 * so the King needs a real bootstrap balance or the parish would never open
 * its first soul. ~£222 at a ~74k £/BTC rate: enough to clear the reserve
 * (2x stake) plus several stakes; `maxSpawnsPerDawn` still gates growth to
 * one soul a day regardless.
 */
export const KING_START = 300_000;
export const RENT_GBP = 1.5;
export const STAKE_GBP = 20;
export const TAX_MIN = 0;
export const TAX_MAX = 0.6;
export const TAX_DEFAULT = 0.2;
export const SATS_PER_BTC = 100_000_000;
export const LIVING_CAP = 24;

/** Petitions to the King — every limit is enforced in code, whatever the King's AI says. */
export const SUMMONS_PER_PETITION = 3;
/** Souls the King may summon by petition per day, across every visitor. */
export const SUMMONS_PER_DAY = 6;
/** Hard ceiling on petitions (AI calls) per day, across every visitor. */
export const PETITIONS_PER_DAY = 300;
export const PETITION_MAX_CHARS = 280;

/** How often the client re-fetches the shared world. The world itself only changes once a day. */
export const WORLD_POLL_MS = 60_000;

export const MAP_W = 1792;
export const MAP_H = 1008;

export const WALK_SPEED = 52;
export const FRAME_FPS = 6;
export const SUBJECT_DRAW = 44;
export const KING_DRAW = 54;
export const HANG_SECS = 6.2;
export const SPEECH_LIFE = 5.4;
export const SHOUT_LIFE = 7.2;

export const MEN_NAMES = [
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
  "Simon",
];

export const WOMEN_NAMES = [
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
  "Ellen",
];

export const FALLBACK_TAPE = {
  btcUsd: 100_000,
  btcGbp: 74_000,
  change24h: 0,
  fearGreed: 50,
  fearGreedLabel: "Neutral",
  dark: true,
  source: "dark",
  fetchedAt: 0,
  assets: {
    BTC: { usd: 100_000, change24h: 0 },
    ETH: { usd: 0, change24h: 0 },
    SOL: { usd: 0, change24h: 0 },
  },
};

export const POI = {
  castle: { x: 900, y: 268 },
  house: { x: 268, y: 250 },
  cottage: { x: 1490, y: 860 },
  stall: { x: 210, y: 575 },
  stall2: { x: 760, y: 900 },
  well: { x: 455, y: 575 },
  gallows: { x: 1588, y: 520 },
  table: { x: 560, y: 820 },
  square: { x: 920, y: 560 },
  kingStand: { x: 900, y: 310 },
} as const;

/** Each tradable asset has its own building — a trading villager walks there. */
export const ASSET_POI: Record<Asset, keyof typeof POI> = {
  BTC: "stall",
  ETH: "stall2",
  SOL: "table",
};

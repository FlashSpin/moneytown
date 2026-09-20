export const SAVE_VERSION = 7;
export const SAVE_KEY = "ledgerford-save-v7";

export const KING_START = 0;
export const RENT_GBP = 1.5;
export const STAKE_GBP = 20;
export const TRANSFER_GBP = 50;
export const TAX_MIN = 0;
export const TAX_MAX = 0.6;
export const TAX_DEFAULT = 0.2;
export const TAX_STEP = 0.01;
export const SATS_PER_BTC = 100_000_000;
export const LIVING_CAP = 24;

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

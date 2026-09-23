import type { Asset, Side } from "./dawn.ts";

export type SubjectAction = "earn" | "idle" | "walk";
export type KingAction = "hold";
export type WalkDir = "down" | "left" | "right" | "up";
export type AgentState = "idle" | "walk" | "work" | "condemned" | "hanging";
export type BodySheet = "king" | "man" | "woman";
export type BrainKind = "gemini" | "groq" | "claude" | "grok" | "pollinations" | "heuristic";

export type BrainInfo = { kind: BrainKind; label: string };

/** Silent FX for showing Bitcoin wallets in £ — never shown as a game tape. */
export type Tape = {
  btcUsd: number;
  btcGbp: number;
  change24h: number;
  fearGreed: number;
  fearGreedLabel: string;
  dark: boolean;
  source: string;
  fetchedAt: number;
  /** Live price + 24h change per coin (BTC mirrors the fields above); `name` is the coin's full name. */
  assets: Record<Asset, { usd: number; change24h: number; name?: string }>;
  /** The market's tradable coins in market-cap rank order (the parish's 20 shops). */
  coins?: Asset[];
};

export type SpeechLine = {
  id: string;
  fromId: string;
  toId: string | null;
  text: string;
  shout: boolean;
  age: number;
  life: number;
  heard: boolean;
  logged: boolean;
};

export type PurseFields = {
  /** Flavor-only placeholder address — never a real key, never editable by a visitor. */
  wallet: string;
  balance: number;
};

export type Subject = PurseFields & {
  id: string;
  firstName: string;
  lastPnl: number;
  lastAction: SubjectAction;
  lastFlavor: string;
  body: BodySheet;
  x: number;
  y: number;
  destX: number;
  destY: number;
  dir: WalkDir;
  frame: number;
  frameT: number;
  state: AgentState;
  hangT: number;
  bornDay?: number;
  /** This villager's current trading position, ordered by the King at each review. */
  asset?: Asset;
  side?: Side;
  /** Share of the purse committed to the position (0.1..1). */
  size?: number;
  /** Asset price (USD) the position was last marked at; P&L runs from here. */
  entryUsd?: number;
  /** Purse at the start of the current day — the King's tax is on gains above it. */
  dayStart?: number;
  /** The King's latest advice to this villager. */
  advice?: string;
  /** How this villager trades — its own temperament, fixed at birth. */
  temper?: import("./trading.ts").Temper;
  /** This villager's own reasoning for its current trade, in its words. */
  plan?: string;
  /** Whether its current trade follows the King's advice. */
  followsKing?: boolean;
  /** Track record across every closed trade (net of fees). */
  record?: { wins: number; losses: number; pnl: number };
  /** The day-trading strategy it runs every tick (chosen at the council; see ./strategies.ts). */
  strategy?: import("./strategies.ts").Strategy;
  /** Its open trade, if any. */
  position?: import("./strategies.ts").Position;
  /** Fills today (opens and closes). */
  trades?: number;
  cooldownUntil?: number;
  cooldownCoin?: Asset;
  /** What it has learned from every trade it has closed, plus its written lessons (./knowledge.ts). */
  knowledge?: import("./knowledge.ts").Knowledge;
};

export type King = PurseFields & {
  name: string;
  x: number;
  y: number;
  destX: number;
  destY: number;
  dir: WalkDir;
  frame: number;
  frameT: number;
  lastAction: KingAction;
  lastFlavor: string;
  /** The asset the King currently directs the parish to favor. */
  favorAsset?: Asset;
};

export type LogEntry = {
  id: string;
  day: number;
  text: string;
  kind: "dawn" | "crown" | "subject" | "death" | "tape" | "system" | "talk";
};

/** The whole shared, server-authoritative world — the JSON stored in world_state.state. */
export type GameState = {
  day: number;
  exchequer: number;
  king: King;
  subjects: Subject[];
  taxRate: number;
  tape: Tape;
  log: LogEntry[];
  seed: number;
  brain: BrainInfo;
  speech: SpeechLine[];
  /** Today's petitions to the King — resets when the day changes. Absent on older saves. */
  petitions?: { day: number; count: number; summoned: number };
  /** The latest parish council: the King's plan and the villagers' strategy debate. */
  council?: { at: number; day: number; kingPlan: string; lines: { fromId: string; toId: string | null; text: string }[] };
  /** Rolling prices for every coin, one sample per trading tick (server-side; stripped before reaching the browser). */
  ticks?: import("./indicators.ts").Ticks;
  /** The trading floor: recent fills, newest first. */
  trades?: import("./strategies.ts").TradeEvent[];
  /** When `speech` was last written by the server — the browser replays it only when this changes. */
  speechAt?: number;
  /** When the villagers last traded (the 5-minute tick). */
  lastTickAt?: number;
  /** The trading desk: when the villagers next look at the market with the AI to place their own trades, and what it said last. */
  desk?: { at: number; nextAt: number; say: string; orders: number; brain?: BrainInfo };
  /** When the King last reviewed the parish's trades (ms since epoch). */
  lastReviewAt?: number;
  /** Standing royal orders from the seal-bearer; the daily tick honours them over the King's AI. */
  decree?: { taxRate?: number; favorAsset?: Asset };
};

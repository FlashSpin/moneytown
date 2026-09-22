import type { Asset, Side } from "./dawn.ts";

export type SubjectAction = "earn" | "idle" | "walk";
export type KingAction = "hold";
export type WalkDir = "down" | "left" | "right" | "up";
export type AgentState = "idle" | "walk" | "work" | "condemned" | "hanging";
export type BodySheet = "king" | "man" | "woman";
export type BrainKind = "claude" | "grok" | "pollinations" | "heuristic";

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
  /** Live price + 24h change per tradable asset — BTC mirrors the fields above. */
  assets: Record<Asset, { usd: number; change24h: number }>;
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
  /** This villager's current trading position, chosen by their linked agent each day. */
  asset?: Asset;
  side?: Side;
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
};

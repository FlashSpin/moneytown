export type SubjectAction = "earn" | "idle" | "walk";
export type KingAction = "hold";
export type WalkDir = "down" | "left" | "right" | "up";
export type AgentState = "idle" | "walk" | "work" | "condemned" | "hanging";
export type BodySheet = "king" | "man" | "woman";
export type WalletMode = "test" | "chain";
export type BrainKind = "ollama" | "lmstudio" | "chrome" | "grok" | "pollinations" | "heuristic";
export type BrainChoice = "auto" | BrainKind;

export type BrainInfo = { kind: BrainKind; label: string };

export type BrainCatalog = {
  ollama: string[];
  lmstudio: string[];
  chrome: boolean;
};

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
  wallet: string;
  walletMode: WalletMode;
  testBalance: number;
  chainBalance: number | null;
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
  brainChoice: BrainChoice;
  brainModel: string;
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
  brainChoice: BrainChoice;
  brainModel: string;
};

export type LogEntry = {
  id: string;
  day: number;
  text: string;
  kind: "dawn" | "crown" | "subject" | "death" | "tape" | "system" | "talk";
};

export type GameState = {
  version: number;
  started: boolean;
  day: number;
  exchequer: number;
  king: King;
  subjects: Subject[];
  taxRate: number;
  tape: Tape;
  log: LogEntry[];
  selectedId: string | null;
  dawnRunning: boolean;
  talking: boolean;
  seed: number;
  brain: BrainInfo;
  /** Default agent linked onto the next soul you make. */
  brainChoice: BrainChoice;
  brainModel: string;
  brainCatalog: BrainCatalog;
  speech: SpeechLine[];
  talkCd: number;
};

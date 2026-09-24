
export type SubjectAction = "earn" | "idle" | "walk";
export type KingAction = "hold";
export type WalkDir = "down" | "left" | "right" | "up";
export type AgentState = "idle" | "walk" | "work" | "condemned" | "hanging";
export type BodySheet = "king" | "man" | "woman";
export type BrainKind = "gemini" | "groq" | "claude" | "grok" | "pollinations" | "heuristic";

export type BrainInfo = { kind: BrainKind; label: string };

/** One fund's latest close on the market board. */
export type FundQuote = {
  /** The close, in the fund's own currency (US dollars for the proxies), dividends included. */
  close: number;
  /** Change on the previous close. */
  change1d: number;
  /** Change over a year of trading days, when there is the history. */
  change1y?: number;
  /** Whether it closed above its 200-day average (the trend guard's test). */
  above200?: boolean;
};

/** The market board: every fund at the latest close the guild has heard of. */
export type Board = {
  /** The market day of the close (YYYY-MM-DD). */
  d: string;
  /** When the guild heard of it (ms since epoch). */
  at: number;
  funds: Partial<Record<import("./merchant.ts").FundId, FundQuote>>;
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

/**
 * A villager: a merchant of the guild. `balance` (from PurseFields) is the
 * cash in its purse, in pence; the rest of its money is in funds
 * (./guild.ts MerchantFields).
 */
export type Subject = PurseFields &
  Omit<import("./guild.ts").MerchantFields, "id" | "firstName" | "balance"> & {
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
    /** Worth at the start of the current season (its dues are a share of the gain from here). */
    seasonStart?: number;
    /** The King's latest advice to this villager. */
    advice?: string;
    /** How this villager invests — its own temperament, fixed at birth. */
    temper?: import("./trading.ts").Temper;
    /** This villager's own reasoning for its strategy, in its words. */
    plan?: string;
    /** Whether its strategy follows the King's advice. */
    followsKing?: boolean;
    /** Lessons it has written down at the councils, newest last. */
    lessons?: string[];
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
  /** The fund the King currently favours. */
  favorAsset?: import("./merchant.ts").FundId;
};

export type LogEntry = {
  id: string;
  day: number;
  /** When it happened (ms since epoch); absent on older entries. */
  at?: number;
  text: string;
  kind: "dawn" | "crown" | "subject" | "death" | "tape" | "system" | "talk";
};

/** The whole shared, server-authoritative world — the JSON stored in world_state.state. */
export type GameState = {
  /** "guild" once the parish invests in funds (worlds before it traded crypto, and are re-founded). */
  era?: "guild";
  day: number;
  exchequer: number;
  king: King;
  subjects: Subject[];
  /** The guild's dues: the share of each merchant's season gain paid to the treasury. */
  taxRate: number;
  /** The funds at the latest close. */
  board?: Board;
  /** The 60/40 and US-shares indexes (100 when the guild began), to judge everyone fairly. */
  bench?: { sf: number; us: number };
  log: LogEntry[];
  seed: number;
  brain: BrainInfo;
  speech: SpeechLine[];
  /** Today's petitions to the King — resets when the day changes. */
  petitions?: { day: number; count: number; summoned: number };
  /** The latest parish council: the King's plan and the villagers' strategy debate. */
  council?: { at: number; day: number; kingPlan: string; lines: { fromId: string; toId: string | null; text: string }[] };
  /** The guild's recent fills, newest first. */
  trades?: import("./guild.ts").FundTrade[];
  /** When `speech` was last written by the server — the browser replays it only when this changes. */
  speechAt?: number;
  /** When the guild last stepped through a market day, and which day. */
  lastMarketAt?: number;
  lastMarketDay?: string;
  /** The guild's book: the lab's best fund strategies (./merchant.ts), for councils and newcomers. */
  book?: import("./merchant.ts").MEntry[];
  /**
   * Postings made by this change, not yet saved — written to the append-only
   * ledger in the same statement as the world, then dropped (src/lib/world.server.ts).
   */
  postings?: import("./ledger.ts").Posting[];
  /** The ledger: when it opened, and the latest check of every purse against it. */
  ledger?: { since: number; check?: import("./ledger.ts").Reconciliation };
  /** New orders halted: nothing is bought or sold until resumed (by the seal-bearer, or after a failed ledger check). */
  halt?: { at: number; reason: string; by: "seal" | "ledger" };
  /** The season now running: the parish's objective (./progress.ts). */
  season?: import("./progress.ts").Season;
  /** Seasons already judged, newest first. */
  seasons?: import("./progress.ts").SeasonResult[];
  /** Milestones reached, by id, with when. */
  milestones?: Record<string, { at: number; day: number }>;
  /** What the last dawn moved. */
  lastDawn?: import("./progress.ts").DawnBook;
  /** Standing royal orders from the seal-bearer; the daily tick honours them over the King's AI. */
  decree?: { taxRate?: number; favorAsset?: import("./merchant.ts").FundId };
};

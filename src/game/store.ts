import { create } from "zustand";
import { fetchChainBalance } from "@/lib/chain";
import { fetchTape } from "@/lib/tape";
import { playHang, playShout, playTalk } from "./audio";
import {
  ambientTalk,
  heuristicReply,
  heuristicTalks,
  kingFlavor,
  subjectFlavor,
  trimSpeech,
} from "./brains";
import {
  FALLBACK_TAPE,
  HANG_SECS,
  KING_START,
  LIVING_CAP,
  MEN_NAMES,
  POI,
  SAVE_KEY,
  SAVE_VERSION,
  SHOUT_LIFE,
  SPEECH_LIFE,
  STAKE_GBP,
  TAX_DEFAULT,
  TAX_MAX,
  TAX_MIN,
  TAX_STEP,
  TRANSFER_GBP,
  WALK_SPEED,
  WOMEN_NAMES,
} from "./constants";
import { runSubjectDawn } from "./dawn";
import {
  DRY_DAYS_LIMIT,
  defaultKingPolicy,
  isStarved,
  kingSpawnCount,
  nextDryDays,
  pickParent,
  walletIncome,
} from "./economy";
import { choiceLabel, counselDawn, counselTalk, scanCatalog } from "./llm";
import { facing, GALLOWS_DROP, GALLOWS_WATCH, moveToward, wanderPoint } from "./town";
import type {
  BrainCatalog,
  BrainChoice,
  BrainInfo,
  GameState,
  King,
  LogEntry,
  SpeechLine,
  Subject,
  Tape,
  WalletMode,
} from "./types";
import {
  activePurse,
  clamp,
  fakeWallet,
  formatPurse,
  isBtcAddress,
  mulberry32,
  pick,
  rentSats,
  stakeSats,
  sumExchequer,
  transferSats,
  uid,
} from "./wallets";


const EMPTY_CATALOG: BrainCatalog = { ollama: [], lmstudio: [], chrome: false };

function syncPurse<T extends { walletMode: WalletMode; testBalance: number; chainBalance: number | null; balance: number }>(
  sub: T,
): T {
  return { ...sub, balance: activePurse(sub) };
}

function withTotals<T extends { king: King; subjects: Subject[] }>(s: T): T & { exchequer: number } {
  return { ...s, exchequer: sumExchequer(s.king, s.subjects) };
}

function makeKing(rng: () => number): King {
  return syncPurse({
    name: "His Majesty",
    wallet: fakeWallet(rng),
    walletMode: "test",
    testBalance: KING_START,
    chainBalance: null,
    balance: KING_START,
    x: POI.kingStand.x,
    y: POI.kingStand.y,
    destX: POI.kingStand.x,
    destY: POI.kingStand.y,
    dir: "down",
    frame: 0,
    frameT: 0,
    lastAction: "hold",
    lastFlavor: "The King waits upon the parish. His treasury opens new souls while the parish earns.",
    brainChoice: "auto",
    brainModel: "",
  });
}


function makeSubject(
  rng: () => number,
  taken: Set<string>,
  grant: number,
  agent: { choice: BrainChoice; model: string },
  bornDay = 0,
): Subject {
  const female = rng() > 0.5;
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
    lastFlavor: `${firstName} is staked £${STAKE_GBP}. Linked to an agent — make money online, or the tax hangs you.`,
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
    brainModel: agent.model,
    earnedSats: 0,
    dryDays: 0,
    bornDay,
  });
}

function pushLog(state: GameState, kind: LogEntry["kind"], text: string): LogEntry[] {
  const entry: LogEntry = {
    id: uid("l", Math.random),
    day: state.day,
    text,
    kind,
  };
  return [entry, ...state.log].slice(0, 80);
}

function persist(state: GameState) {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        ...withTotals(state),
        dawnRunning: false,
        talking: false,
        speech: [],
        talkCd: 8,
      }),
    );
  } catch {
    /* private mode */
  }
}

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (parsed.version !== SAVE_VERSION) return null;
    const king = syncPurse({
      ...parsed.king,
      wallet: parsed.king.wallet ?? fakeWallet(() => 0.5),
      walletMode: parsed.king.walletMode ?? "test",
      testBalance: parsed.king.testBalance ?? parsed.king.balance ?? 0,
      chainBalance: parsed.king.chainBalance ?? null,
      lastAction: "hold" as const,
      brainChoice: parsed.king.brainChoice ?? "auto",
      brainModel: parsed.king.brainModel ?? "",
    });
    const subjects = (parsed.subjects ?? []).map((sub) =>
      syncPurse({
        ...sub,
        walletMode: sub.walletMode ?? "test",
        testBalance: sub.testBalance ?? sub.balance ?? 0,
        chainBalance: sub.chainBalance ?? null,
        brainChoice: sub.brainChoice ?? parsed.brainChoice ?? "auto",
        brainModel: sub.brainModel ?? parsed.brainModel ?? "",
      }),
    );
    return withTotals({
      ...parsed,
      king,
      subjects,
      dawnRunning: false,
      talking: false,
      started: parsed.started ?? false,
      brain: parsed.brain ?? { kind: "heuristic", label: "Heuristic" },
      brainChoice: parsed.brainChoice ?? "auto",
      brainModel: parsed.brainModel ?? "",
      brainCatalog: parsed.brainCatalog ?? EMPTY_CATALOG,
      speech: [],
      talkCd: 6,
    });
  } catch {
    return null;
  }
}

function fresh(seed = Date.now() % 1_000_000): GameState {
  const rng = mulberry32(seed);
  const king = makeKing(rng);
  return withTotals({
    version: SAVE_VERSION,
    started: false,
    day: 0,
    exchequer: 0,
    king,
    subjects: [],
    taxRate: TAX_DEFAULT,
    tape: { ...FALLBACK_TAPE },
    log: [
      {
        id: "l-open",
        day: 0,
        text: "Fund the King. His treasury opens each new soul and links it to an agent. A soul must keep making money for its own wallet, or it hangs.",
        kind: "system",
      },
    ],
    selectedId: null,
    dawnRunning: false,
    talking: false,
    seed,
    brain: { kind: "grok", label: "Auto — local, then Grok" },
    brainChoice: "auto",
    brainModel: "",
    brainCatalog: EMPTY_CATALOG,
    speech: [],
    talkCd: 8,
  });
}

function actor(s: GameState, id: string): King | Subject | null {
  if (id === "king") return s.king;
  return s.subjects.find((x) => x.id === id) ?? null;
}

function speakerName(s: GameState, id: string): string {
  if (id === "you") return "You";
  if (id === "king") return "The King";
  return s.subjects.find((x) => x.id === id)?.firstName ?? "A voice";
}


async function loadChainSats(address: string): Promise<number | null> {
  if (!isBtcAddress(address)) return null;
  try {
    const r = await fetchChainBalance({ data: { address } });
    return r.ok ? r.sats : null;
  } catch {
    return null;
  }
}

type Actions = {
  boot: () => void;
  start: () => void;
  reset: () => void;
  give: () => void;
  take: () => void;
  spawn: () => boolean;
  setTax: (rate: number) => void;
  nudgeTax: (dir: -1 | 1) => void;
  setBrain: (choice: BrainChoice, model?: string) => void;
  setAgent: (id: string, choice: BrainChoice, model?: string) => void;
  scanWits: () => Promise<void>;
  dawn: () => Promise<void>;
  select: (id: string | null) => void;
  tick: (dt: number) => void;
  refreshTape: () => Promise<void>;
  updateWallet: (
    id: string,
    patch: { wallet?: string; testBalance?: number; walletMode?: WalletMode },
  ) => string | null;
  refreshChain: (id: string) => Promise<string | null>;
  converse: (toId: string | null, text: string, shout?: boolean) => Promise<void>;
};


export const useGame = create<GameState & Actions>((set, get) => ({
  ...fresh(),

  boot: () => {
    const saved = loadSave();
    if (saved) {
      set({ ...saved, dawnRunning: false, talking: false, speech: [] });
      return;
    }
    const s = get();
    if (!s.king.wallet) set(fresh());
  },


  start: () => {
    set((s) => {
      const next = { ...s, started: true };
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
    if (get().dawnRunning) return;
    const s = get();
    const amount = transferSats(s.tape);
    const king = syncPurse({ ...s.king, testBalance: s.king.testBalance + amount });
    const next = withTotals({
      ...s,
      king,
      log: pushLog(s, "crown", `You add £${TRANSFER_GBP} to the King's test purse.`),
    });
    persist(next);
    set(next);
  },

  take: () => {
    if (get().dawnRunning) return;
    const s = get();
    const amount = transferSats(s.tape);
    if (s.king.testBalance < amount) return;
    const king = syncPurse({ ...s.king, testBalance: s.king.testBalance - amount });
    const next = withTotals({
      ...s,
      king,
      log: pushLog(s, "crown", `You take £${TRANSFER_GBP} from the King's test purse.`),
    });
    persist(next);
    set(next);
  },

  spawn: () => {
    if (get().dawnRunning) return false;
    const s = get();
    const living = s.subjects.filter((x) => x.state !== "hanging").length;
    if (living >= LIVING_CAP) {
      set({
        log: pushLog(s, "system", `The parish will hold no more than ${LIVING_CAP} souls.`),
      });
      return false;
    }
    const stake = stakeSats(s.tape);
    if (s.king.testBalance < stake) {
      set({
        log: pushLog(
          s,
          "system",
          `A new soul costs £${STAKE_GBP} from the royal test purse. Fund the King first.`,
        ),
      });
      return false;
    }
    const rng = mulberry32(s.seed + s.subjects.length * 97 + s.day * 13);
    const taken = new Set(s.subjects.map((x) => x.firstName));
    const agent = { choice: s.brainChoice, model: s.brainModel };
    const subject = makeSubject(rng, taken, stake, agent, s.day);
    const king = syncPurse({
      ...s.king,
      testBalance: s.king.testBalance - stake,
      lastAction: "hold" as const,
      lastFlavor: kingFlavor(),
    });
    const label = choiceLabel(agent.choice, agent.model, s.brainCatalog);
    const next: GameState = withTotals({
      ...s,
      king,
      subjects: [...s.subjects, subject],
      seed: s.seed + 1,
      selectedId: subject.id,
      log: pushLog(
        s,
        "crown",
        `You make ${subject.firstName}, staked £${STAKE_GBP}, linked to ${label}. Souls must earn online or the tax will take them.`,
      ),
    });

    persist(next);
    set(next);
    return true;
  },

  setTax: (rate) => {
    if (get().dawnRunning) return;
    const s = get();
    const taxRate = clamp(Math.round(rate * 100) / 100, TAX_MIN, TAX_MAX);
    const next = {
      ...s,
      taxRate,
      log: pushLog(s, "crown", `You set the tithe to ${Math.round(taxRate * 100)}%. `),
    };
    persist(next);
    set(next);
  },

  nudgeTax: (dir) => {
    get().setTax(get().taxRate + dir * TAX_STEP);
  },

  setBrain: (choice, model = "") => {
    const s = get();
    const brain: BrainInfo = {
      kind: choice === "auto" ? "grok" : choice,
      label: choiceLabel(choice, model, s.brainCatalog),
    };
    const next = { ...s, brainChoice: choice, brainModel: model, brain };
    persist(next);
    set(next);
  },

  setAgent: (id, choice, model = "") => {
    if (get().dawnRunning) return;
    const s = get();
    const label = choiceLabel(choice, model, s.brainCatalog);
    if (id === "king") {
      const king = { ...s.king, brainChoice: choice, brainModel: model };
      const next = {
        ...s,
        king,
        log: pushLog(s, "system", `The King is linked to ${label}. `),
      };
      persist(next);
      set(next);
      return;
    }
    const sub = s.subjects.find((x) => x.id === id);
    if (!sub) return;
    const updated = { ...sub, brainChoice: choice, brainModel: model };
    const next = {
      ...s,
      subjects: s.subjects.map((x) => (x.id === id ? updated : x)),
      log: pushLog(s, "system", `${sub.firstName} is linked to ${label}. That agent must make money online, or the tax hangs them.`),
    };
    persist(next);
    set(next);
  },

  scanWits: async () => {
    const catalog = await scanCatalog();
    const s = get();
    const brain = {
      ...s.brain,
      label: choiceLabel(s.brainChoice, s.brainModel, catalog),
    };
    set({ brainCatalog: catalog, brain });
  },

  refreshTape: async () => {
    try {
      const tape = await fetchTape();
      set({ tape });
    } catch {
      set((s) => ({ tape: { ...s.tape, dark: true, source: "dark" } }));
    }
  },

  updateWallet: (id, patch) => {
    if (get().dawnRunning) return "Wait for dawn to finish.";
    const s = get();
    const isKing = id === "king";
    const sub = isKing ? null : s.subjects.find((x) => x.id === id);
    if (!isKing && !sub) return "No such subject.";
    const current = isKing ? s.king : sub!;
    let wallet = current.wallet;
    if (patch.wallet != null) {
      const nextAddr = patch.wallet.trim();
      if (!isBtcAddress(nextAddr)) return "That is not a Bitcoin address.";
      wallet = nextAddr;
    }
    const walletMode = patch.walletMode ?? current.walletMode;
    const testBalance =
      walletMode === "test" && patch.testBalance != null
        ? Math.max(0, Math.round(patch.testBalance))
        : current.testBalance;
    const chainBalance = wallet === current.wallet ? current.chainBalance : null;
    const label = isKing ? "The King" : sub!.firstName;
    const logText =
      walletMode === "chain"
        ? `${label}'s address is watched on-chain. No keys are kept. Tithe still lands in the test purse.`
        : `${label}'s test purse is set to ${formatPurse(testBalance, s.tape)}.`;
    if (isKing) {
      const king = syncPurse({ ...s.king, wallet, testBalance, walletMode, chainBalance });
      const next = withTotals({ ...s, king, log: pushLog(s, "system", logText) });
      persist(next);
      set(next);
      return null;
    }
    const updated = syncPurse({
      ...sub!,
      wallet,
      testBalance,
      walletMode,
      chainBalance,
    });
    const next = withTotals({
      ...s,
      subjects: s.subjects.map((x) => (x.id === id ? updated : x)),
      log: pushLog(s, "system", logText),
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
      const label = isKing ? "The King" : (cur.subjects.find((x) => x.id === id)?.firstName ?? "A soul");
      const logText = `${label}'s chain watch: ${formatPurse(r.sats, cur.tape)} via ${r.source}. Watch-only — no keys. Money from the world, not the game.`;
      if (isKing) {
        const king = syncPurse({ ...cur.king, chainBalance: r.sats });
        const next = withTotals({ ...cur, king, log: pushLog(cur, "tape", logText) });
        persist(next);
        set(next);
        return null;
      }
      const live = cur.subjects.find((x) => x.id === id);
      if (!live) return "No such subject.";
      const updated = syncPurse({ ...live, chainBalance: r.sats });
      const next = withTotals({
        ...cur,
        subjects: cur.subjects.map((x) => (x.id === id ? updated : x)),
        log: pushLog(cur, "tape", logText),
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
    try {

    let tape: Tape = current.tape;
    try {
      tape = await fetchTape();
    } catch {
      tape = { ...current.tape, dark: true, source: "dark" };
    }

    const s = get();
    const rng = mulberry32(s.seed + s.day * 1009 + 7);
    const day = s.day + 1;
    let kingTest = s.king.testBalance;
    let kingChain = s.king.chainBalance;
    let log = s.log;
    let brain: BrainInfo = s.brain;


    const push = (kind: LogEntry["kind"], text: string) => {
      log = [{ id: uid("l", rng), day, text, kind }, ...log].slice(0, 80);
    };

    const livingNow = s.subjects.filter((x) => x.state !== "hanging" && x.state !== "condemned");

    const chainHits = await Promise.all(
      livingNow
        .filter((x) => x.walletMode === "chain")
        .map(async (x) => {
          const sats = await loadChainSats(x.wallet);
          return sats == null ? null : ([x.id, sats] as const);
        }),
    );
    const chainById = new Map(chainHits.filter((row): row is readonly [string, number] => row != null));
    if (s.king.walletMode === "chain") {
      const ks = await loadChainSats(s.king.wallet);
      if (ks != null) kingChain = ks;
    }

    const toRow = (x: Subject) => ({
      id: x.id,
      firstName: x.firstName,
      testBalance: x.testBalance,
      walletMode: x.walletMode,
      chainBalance: chainById.get(x.id) ?? x.chainBalance,
      agent: choiceLabel(x.brainChoice, x.brainModel, s.brainCatalog),
    });

    const kingSpec = { choice: s.king.brainChoice, model: s.king.brainModel };
    const counsel = await counselDawn(
      {
        day,
        kingBalance: kingTest,
        taxRate: s.taxRate,
        cap: LIVING_CAP,
        tape,
        role: "king",
        subjects: livingNow.map(toRow),
      },
      kingSpec,
    );

    if (counsel) {
      brain = counsel.brain;
      const wanted = choiceLabel(s.king.brainChoice, s.king.brainModel, s.brainCatalog);
      if (s.king.brainChoice !== "auto" && counsel.brain.label !== wanted) {
        push("system", `The King's agent did not answer. ${brain.label} spoke instead.`);
      } else {
        push("system", `The King's agent this dawn: ${brain.label}.`);
      }
    } else {
      brain = { kind: "heuristic", label: "Heuristic (period English)" };
      push("system", "No agent answered the King. The old heuristic speaks.");
    }

    const adviceById = new Map((counsel?.subjects ?? []).map((a) => [a.id, a]));
    let extraTalks = counsel?.talks ?? [];

    const kingKey = `${s.king.brainChoice}::${s.king.brainModel}`;
    const groups = new Map<string, Subject[]>();
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
      const first = members[0]!;
      const hit = await counselDawn(
        {
          day,
          kingBalance: kingTest,
          taxRate: s.taxRate,
          cap: LIVING_CAP,
          tape,
          role: "agent",
          subjects: members.map(toRow),
        },
        { choice: first.brainChoice, model: first.brainModel },
      );
      if (!hit) {
        push("system", `${choiceLabel(first.brainChoice, first.brainModel, s.brainCatalog)} did not answer. Heuristic thinks for ${members.map((m) => m.firstName).join(", ")}.`);
        continue;
      }
      for (const row of hit.subjects) adviceById.set(row.id, row);
      extraTalks = [...extraTalks, ...hit.talks].slice(0, 8);
      push("system", `${hit.brain.label} thinks for ${members.map((m) => m.firstName).join(", ")}.`);
    }

    push(
      "dawn",
      `Dawn of day ${day}. The King's tax is ${Math.round(s.taxRate * 100)}%. The game pays no wage — each linked agent must make money online.`,
    );

    if (s.king.walletMode === "chain" && kingChain != null && s.king.chainBalance != null && kingChain > s.king.chainBalance) {
      push(
        "system",
        `The King's chain watch rose by ${formatPurse(kingChain - s.king.chainBalance, tape)}. Coin from the world.`,
      );
    }

    const rent = rentSats(tape);
    const nextSubjects: Subject[] = [];
    const sayById = new Map<string, string>();
    for (const sub of s.subjects) {
      if (sub.state === "hanging" || sub.state === "condemned") {
        nextSubjects.push(sub);
        continue;
      }
      const prevChain = sub.chainBalance;
      const chainBalance = chainById.get(sub.id) ?? sub.chainBalance;
      if (chainBalance != null && prevChain != null && chainBalance > prevChain) {
        push(
          "system",
          `${sub.firstName} received ${formatPurse(chainBalance - prevChain, tape)} on-chain. That is real money, not a game wage.`,
        );
      } else if (chainBalance != null && prevChain == null && sub.walletMode === "chain") {
        push("system", `${sub.firstName}'s chain watch is ${formatPurse(chainBalance, tape)}.`);
      }
      const advice = adviceById.get(sub.id);
      const chainMode = sub.walletMode === "chain";
      // Income is whatever the watched wallet gained. A failed lookup this dawn never counts against a villager.
      const observed = chainMode && chainById.has(sub.id) && prevChain != null;
      const income = observed ? walletIncome(prevChain, chainBalance) : 0;
      const dry = observed ? nextDryDays(sub.dryDays ?? 0, income) : (sub.dryDays ?? 0);
      const earned = (sub.earnedSats ?? 0) + income;
      const starved = chainMode && isStarved(dry, chainBalance);
      const result = runSubjectDawn({
        balance: sub.testBalance,
        taxRate: s.taxRate,
        tape,
        rng,
        action: advice?.action,
        side: advice?.side,
        rentSats: rent,
        chainMode,
        chainBalance,
      });
      kingTest += result.tithe;
      const hanged = result.hanged || starved;
      const flavor =
        advice?.say?.trim() ||
        subjectFlavor(sub.firstName, result.action, result.side, result.income, tape);
      sayById.set(sub.id, advice?.say?.trim() || "");
      if (chainMode) {
        push(
          "subject",
          `${flavor} On-chain watch ${formatPurse(chainBalance ?? 0, tape)}. The King's tax is not taken from the chain — no keys.`,
        );
      } else {
        push(
          "subject",
          `${flavor} Upkeep ${formatPurse(result.rentPaid, tape)}. Tax ${formatPurse(result.tithe, tape)} (${Math.round(s.taxRate * 100)}%).`,
        );
      }

      const dest =
        result.action === "earn"
          ? POI.stall
          : result.action === "idle"
            ? POI.square
            : wanderPoint(rng);

      if (hanged) {
        kingTest += result.leftover;
        push(
          "death",
          chainMode
            ? (chainBalance ?? 1) <= 0
              ? `${sub.firstName}'s wallet is empty. They are walked to the gallows.`
              : `${sub.firstName} earned nothing for ${Math.min(dry, DRY_DAYS_LIMIT)} dawns. They are walked to the gallows.`
            : `${sub.firstName} cannot pay the King's tax, and is walked to the gallows.`,
        );
        nextSubjects.push(
          syncPurse({
            ...sub,
            chainBalance,
            testBalance: 0,
            earnedSats: earned,
            dryDays: dry,
            lastPnl: 0,
            lastAction: result.action,
            lastFlavor: flavor,
            destX: GALLOWS_DROP.x,
            destY: GALLOWS_DROP.y,
            state: "condemned",
            hangT: 0,
          }),
        );
      } else {
        nextSubjects.push(
          syncPurse({
            ...sub,
            chainBalance,
            testBalance: result.balance,
            earnedSats: earned,
            dryDays: dry,
            lastPnl: 0,
            lastAction: result.action,
            lastFlavor: flavor,
            destX: dest.x + (rng() - 0.5) * 40,
            destY: dest.y + (rng() - 0.5) * 28,
            state: result.action === "earn" ? "work" : result.action === "idle" ? "idle" : "walk",
          }),
        );
      }
    }

    // The King opens new villagers from his own treasury, by a fixed rule, and only while the parish earns.
    {
      const alive = nextSubjects.filter((x) => x.state !== "condemned" && x.state !== "hanging");
      const stake = stakeSats(tape);
      const count = kingSpawnCount({
        treasury: kingTest,
        living: alive.length,
        unproven: alive.filter((x) => (x.earnedSats ?? 0) === 0).length,
        policy: defaultKingPolicy(stake, LIVING_CAP),
      });
      const taken = new Set(nextSubjects.map((x) => x.firstName));
      for (let i = 0; i < count; i++) {
        const parent = pickParent(alive);
        const agent = parent
          ? { choice: parent.brainChoice, model: parent.brainModel }
          : { choice: s.brainChoice, model: s.brainModel };
        const child = makeSubject(rng, taken, stake, agent, day);
        kingTest -= stake;
        nextSubjects.push(child);
        push(
          "crown",
          `The King opens ${child.firstName} from the treasury, staked ${formatPurse(stake, tape)}${parent ? `, with the setup of ${parent.firstName}, his best earner` : ""}.`,
        );
      }
    }

    const living = nextSubjects.filter((x) => x.state !== "condemned" && x.state !== "hanging");
    const taxRate = s.taxRate;
    const subjects = nextSubjects;
    const kingAction = "hold" as const;
    const flavor = counsel?.king.say?.trim() || kingFlavor();
    push("crown", flavor);

    const livingAfter = living;
    const speech =
      extraTalks.length
        ? extraTalks
        : heuristicTalks(
            rng,
            flavor,
            livingAfter.map((x) => ({
              id: x.id,
              firstName: x.firstName,
              say: sayById.get(x.id) ?? "",
            })),
          );

    const grim = subjects.some((x) => x.state === "condemned" || x.state === "hanging");
    const king = syncPurse({
      ...s.king,
      testBalance: kingTest,
      chainBalance: kingChain,
      lastAction: kingAction,
      lastFlavor: flavor,
      destX: grim ? GALLOWS_WATCH.x : POI.kingStand.x + (rng() - 0.5) * 24,
      destY: grim ? GALLOWS_WATCH.y : POI.kingStand.y,
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
      talkCd: 18,
    });
    persist(next);
    set(next);
    } catch (err) {
      console.error("dawn failed", err);
      set({ dawnRunning: false });
    }
  },

  converse: async (toId, text, shout = false) => {
    const spoken = trimSpeech(text);
    if (!spoken) return;
    const s0 = get();
    if (s0.talking || s0.dawnRunning) return;

    const living = s0.subjects.filter((x) => x.state !== "hanging" && x.state !== "condemned");
    let target: string | null = toId;
    if (target && target !== "king" && !living.some((x) => x.id === target)) target = null;
    const parish = !target;
    const isShout = shout || parish;
    const whoName =
      target === "king" ? "the King" : target ? (living.find((x) => x.id === target)?.firstName ?? "a voice") : "the parish";

    const playerLine: SpeechLine = {
      id: uid("t", Math.random),
      fromId: "you",
      toId: parish ? null : target,
      text: spoken,
      shout: isShout,
      age: 0,
      life: isShout ? SHOUT_LIFE : SPEECH_LIFE,
      heard: true,
      logged: true,
    };

    set({
      talking: true,
      speech: [...s0.speech, playerLine],
      log: pushLog(
        s0,
        "talk",
        isShout ? `You shout to ${whoName}: “${spoken}”` : `You to ${whoName}: “${spoken}”`,
      ),
      talkCd: 22,
    });

    let replyId = target ?? "king";
    if (parish && living.length && Math.random() > 0.55) {
      replyId = living[Math.floor(Math.random() * living.length)]!.id;
    }
    const replyKing = replyId === "king";
    const replySub = replyKing ? null : get().subjects.find((x) => x.id === replyId);
    const replyName = replyKing ? "His Majesty" : (replySub?.firstName ?? "A voice");
    const testBalance = replyKing ? get().king.testBalance : (replySub?.testBalance ?? 0);
    const spec = replyKing
      ? { choice: get().king.brainChoice, model: get().king.brainModel }
      : { choice: replySub?.brainChoice ?? "heuristic", model: replySub?.brainModel ?? "" };
    const agentLabel = choiceLabel(spec.choice, spec.model, get().brainCatalog);

    let say = "";
    let replyShout = isShout;
    let brain: BrainInfo = { kind: "heuristic", label: "Heuristic (period English)" };
    const hit = await counselTalk(
      {
        king: replyKing,
        name: replyName,
        testBalance,
        playerText: spoken,
        shout: isShout,
        taxRate: get().taxRate,
        day: get().day,
        tape: get().tape,
        agentLabel,
      },
      spec,
    );
    if (hit) {
      say = hit.say;
      replyShout = hit.shout || isShout;
      brain = hit.brain;
    } else {
      const heur = heuristicReply({
        king: replyKing,
        name: replyName,
        playerText: spoken,
        shout: isShout,
      });
      say = heur.say;
      replyShout = heur.shout;
    }

    const cur = get();
    const replyLine: SpeechLine = {
      id: uid("t", Math.random),
      fromId: replyId,
      toId: parish || replyShout ? null : "you",
      text: say,
      shout: replyShout,
      age: 0.2,
      life: replyShout ? SHOUT_LIFE : SPEECH_LIFE,
      heard: false,
      logged: false,
    };
    const next = withTotals({
      ...cur,
      talking: false,
      brain,
      speech: [...cur.speech.filter((l) => l.age < l.life), replyLine],
      talkCd: 20,
    });
    persist(next);
    set(next);
  },

  select: (id) => set({ selectedId: id }),


  tick: (dt) => {
    const s = get();
    if (!s.started) return;
    const cap = Math.min(dt, 0.1);
    const step = WALK_SPEED * cap;
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
        s.log = [
          {
            id: uid("l", Math.random),
            day: s.day,
            text:
              line.fromId === "king"
                ? `The King shouts: “${line.text}”`
                : line.fromId === "you"
                  ? `You shout: “${line.text}”`
                  : `${who} shouts: “${line.text}”`,
            kind: "talk" as const,
          },
          ...s.log,
        ].slice(0, 80);
      }
    }
    for (let i = s.speech.length - 1; i >= 0; i--) {
      if (s.speech[i]!.age > s.speech[i]!.life) s.speech.splice(i, 1);
    }

    const active = s.speech.find((l) => l.age >= 0 && l.age < l.life);
    if (active && !grim) {
      const from = actor(s, active.fromId);
      if (from && active.shout) {
        from.dir = "down";
      } else if (from && active.toId) {
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
      if (!grim && !active && Math.random() < cap * 0.15) {
        king.destX = POI.kingStand.x + (Math.random() - 0.5) * 40;
        king.destY = POI.kingStand.y + (Math.random() - 0.5) * 16;
      }
    }

    let removed = false;
    const keep: Subject[] = [];
    for (const sub of s.subjects) {
      if (sub.state === "hanging") {
        sub.hangT += cap;
        sub.frame = 0;
        if (sub.hangT > HANG_SECS) {
          removed = true;
          continue;
        }
        keep.push(sub);
        continue;
      }

      const moved = moveToward(
        sub.x,
        sub.y,
        sub.destX,
        sub.destY,
        step * (sub.state === "condemned" ? 3.2 : 1),
        sub.state === "condemned",
      );
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
        } else if (!active && Math.random() < cap * 0.28) {
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
      const extra = ambientTalk(
        Math.random,
        living.map((x) => ({ id: x.id })),
        true,
      );
      if (extra) {
        const lines = Array.isArray(extra) ? extra : [extra];
        s.speech.push(...lines);
      }
    }

    if (removed) {
      const gone = s.subjects.filter((a) => !keep.some((b) => b.id === a.id));
      let nextLog = s.log;
      for (const g of gone) {
        nextLog = [
          {
            id: uid("l", Math.random),
            day: s.day,
            text: `${g.firstName} hangs. The name is struck from the ledger.`,
            kind: "death" as const,
          },
          ...nextLog,
        ].slice(0, 80);
      }
      const selectedId =
        s.selectedId && gone.some((g) => g.id === s.selectedId) ? null : s.selectedId;
      const next = withTotals({
        ...s,
        subjects: keep,
        log: nextLog,
        selectedId,
        speech: s.speech.filter((l) => !gone.some((g) => g.id === l.fromId || g.id === l.toId)),
      });
      persist(next);
      set(next);
    }
  },
}));

export function livingCapOf(): number {
  return LIVING_CAP;
}

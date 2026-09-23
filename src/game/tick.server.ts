/**
 * The daily tick — server-only, called once a day by the `/api/tick` cron
 * route. Ports the game's former client-side `dawn()` action: fetches the
 * live multi-asset price tape, asks the King's AI for the day's tax rate and
 * favoured asset, asks one combined call for the whole parish's own trading
 * decisions, applies real trade P&L + rent + tithe, and lets the King's
 * treasury open new souls by its existing rule. Pure enough to unit-test by
 * injecting a fake `prev` state (network calls aside).
 */
import { loadTape } from "@/lib/tape.server";
import { ASSET_POI, LIVING_CAP, POI } from "./constants";
import { chooseSide, runSubjectDawn, tradeIncome, type Side } from "./dawn";
import { defaultKingPolicy, kingSpawnCount } from "./economy";
import { heuristicTalks, kingFlavor, subjectFlavor } from "./brains";
import { counselDawn } from "./llm.server";
import { GALLOWS_DROP, wanderPoint } from "./town";
import type { GameState, King, Subject } from "./types";
import { makeSubject, pushLog, withTotals } from "./world";
import { mulberry32, rentSats, stakeSats } from "./wallets";

export async function runDailyTick(prev: GameState): Promise<GameState> {
  let tape = prev.tape;
  try {
    tape = await loadTape();
  } catch {
    tape = { ...prev.tape, dark: true, source: "dark" };
  }

  const day = prev.day + 1;
  const rng = mulberry32(prev.seed + prev.day * 1009 + 7);
  let log = prev.log;
  const push = (kind: Parameters<typeof pushLog>[1], text: string) => {
    log = pushLog({ day, log }, kind, text);
  };

  // Anyone already condemned/hanging from a previous day has had their day
  // to be seen and is struck from the ledger now — see brains.ts/render.ts
  // for how a freshly condemned soul still gets one visible hang animation
  // client-side before the next tick permanently removes them.
  const resolved = prev.subjects.filter((x) => x.state === "condemned" || x.state === "hanging");
  for (const s of resolved) push("death", `${s.firstName}'s name is struck from the ledger.`);
  const carried = prev.subjects.filter((x) => x.state !== "condemned" && x.state !== "hanging");

  const toRow = (x: Subject) => ({ id: x.id, firstName: x.firstName, balance: x.balance });

  const kingCounsel = await counselDawn({
    day,
    kingBalance: prev.king.balance,
    taxRate: prev.taxRate,
    cap: LIVING_CAP,
    tape,
    role: "king",
    subjects: carried.map(toRow),
  });

  const brain = kingCounsel?.brain ?? { kind: "heuristic" as const, label: "Heuristic (period English)" };
  push("system", kingCounsel ? `The King's agent this dawn: ${brain.label}.` : "No agent answered the King. The old heuristic speaks.");

  // A standing royal decree (from the seal-bearer's petition) outranks the King's AI.
  const kingFavorAsset = prev.decree?.favorAsset ?? kingCounsel?.king.favorAsset ?? prev.king.favorAsset ?? "BTC";
  const taxRate = prev.decree?.taxRate ?? kingCounsel?.king.taxRate ?? prev.taxRate;

  const adviceById = new Map((kingCounsel?.subjects ?? []).map((a) => [a.id, a]));
  let extraTalks = kingCounsel?.talks ?? [];

  // One combined call covers the whole parish's own thinking — everyone
  // shares the same fixed cascade now, so there's no more reason to group by
  // per-soul brain choice the way the old player-driven version did.
  const agentCounsel = await counselDawn({
    day,
    kingBalance: prev.king.balance,
    taxRate,
    cap: LIVING_CAP,
    tape,
    role: "agent",
    kingFavorAsset,
    subjects: carried.map(toRow),
  });
  if (agentCounsel) {
    for (const row of agentCounsel.subjects) adviceById.set(row.id, row);
    extraTalks = [...extraTalks, ...agentCounsel.talks].slice(0, 8);
    push("system", `${agentCounsel.brain.label} thinks for the parish.`);
  } else {
    push("system", "No agent answered for the parish. Old wits speak instead.");
  }

  push("dawn", `Dawn of day ${day}. The King's tax is ${Math.round(taxRate * 100)}%.`);

  const rent = rentSats(tape);
  const nextSubjects: Subject[] = [];
  const sayById = new Map<string, string>();
  let kingBalance = prev.king.balance;

  for (const sub of carried) {
    const advice = adviceById.get(sub.id);

    // No advice for this soul this dawn — fall back to the game's existing
    // momentum heuristic rather than defaulting to a permanent flat position
    // whenever the AI is unreachable.
    const asset = advice?.asset ?? kingFavorAsset;
    const side: Side = advice?.side ?? chooseSide(tape, rng);
    const canTrade = !tape.dark && !prev.tape.dark && sub.bornDay !== prev.day;
    const tradePnl = canTrade
      ? tradeIncome(sub.balance, prev.tape.assets[asset].usd, tape.assets[asset].usd, side)
      : 0;

    const result = runSubjectDawn({
      balance: sub.balance + tradePnl,
      taxRate,
      tape,
      rng,
      action: advice?.action,
      side: advice?.side,
      rentSats: rent,
    });
    kingBalance += result.tithe;
    const flavor = advice?.say?.trim() || subjectFlavor(sub.firstName, result.action, side, asset, tradePnl, tape);
    sayById.set(sub.id, advice?.say?.trim() || "");
    push(
      "subject",
      `${flavor} Upkeep ${rent} sats. Tax ${result.tithe} sats (${Math.round(taxRate * 100)}%).`,
    );

    const dest = side !== "flat" ? POI[ASSET_POI[asset]] : result.action === "idle" ? POI.square : wanderPoint(rng);

    if (result.hanged) {
      kingBalance += result.leftover;
      push("death", `${sub.firstName} cannot pay the King's tax, and is walked to the gallows.`);
      nextSubjects.push({
        ...sub,
        balance: 0,
        asset,
        side,
        lastPnl: tradePnl,
        lastAction: result.action,
        lastFlavor: flavor,
        destX: GALLOWS_DROP.x,
        destY: GALLOWS_DROP.y,
        state: "condemned",
        hangT: 0,
      });
    } else {
      nextSubjects.push({
        ...sub,
        balance: result.balance,
        asset,
        side,
        lastPnl: tradePnl,
        lastAction: result.action,
        lastFlavor: flavor,
        destX: dest.x + (rng() - 0.5) * 40,
        destY: dest.y + (rng() - 0.5) * 28,
        state: result.action === "earn" ? "work" : result.action === "idle" ? "idle" : "walk",
      });
    }
  }

  // The King opens new villagers from his own treasury, by a fixed rule, and only while the parish trades.
  {
    const alive = nextSubjects.filter((x) => x.state !== "condemned" && x.state !== "hanging");
    const stake = stakeSats(tape);
    const count = kingSpawnCount({
      treasury: kingBalance,
      living: alive.length,
      unproven: alive.filter((x) => x.bornDay === prev.day).length,
      policy: defaultKingPolicy(stake, LIVING_CAP),
    });
    const taken = new Set(nextSubjects.map((x) => x.firstName));
    for (let i = 0; i < count; i++) {
      const child = makeSubject(rng, taken, stake, day);
      kingBalance -= stake;
      nextSubjects.push(child);
      push("crown", `The King opens ${child.firstName} from the treasury, staked for trade.`);
    }
  }

  const living = nextSubjects.filter((x) => x.state !== "condemned" && x.state !== "hanging");
  const flavor = kingCounsel?.king.say?.trim() || kingFlavor(kingFavorAsset);
  push("crown", flavor);
  push("crown", `The King favors ${kingFavorAsset} in the markets today.`);

  const speech = extraTalks.length
    ? extraTalks
    : heuristicTalks(
        rng,
        flavor,
        living.map((x) => ({ id: x.id, firstName: x.firstName, say: sayById.get(x.id) ?? "" })),
      );

  const grim = nextSubjects.some((x) => x.state === "condemned" || x.state === "hanging");
  const king: King = {
    ...prev.king,
    balance: kingBalance,
    lastAction: "hold",
    lastFlavor: flavor,
    favorAsset: kingFavorAsset,
    destX: grim ? prev.king.destX : POI.kingStand.x,
    destY: grim ? prev.king.destY : POI.kingStand.y,
  };

  return withTotals({
    ...prev,
    day,
    tape,
    taxRate,
    subjects: nextSubjects,
    king,
    log,
    seed: prev.seed + 17,
    brain,
    speech,
  });
}

/**
 * The daily tick — server-only, called once a day by the `/api/tick` cron.
 * Dawn closes the old day and opens the new one:
 *   1. strike yesterday's hanged from the roll,
 *   2. mark every position to the live price (src/game/review.server.ts),
 *   3. settle the day: the King's tax on each villager's PROFIT, upkeep into
 *      the treasury, and the gallows for any purse below the floor,
 *   4. the treasury opens new souls by its fixed rule,
 *   5. the King's council sets the new day's tax, favoured market and every
 *      villager's orders (royal decrees from the seal-bearer win).
 * Between dawns, /api/review re-marks and re-orders every few hours.
 */
import { loadTape } from "@/lib/tape.server";
import { HANG_BELOW_GBP, LIVING_CAP } from "./constants";
import { defaultKingPolicy, kingSpawnCount } from "./economy";
import { kingFlavor } from "./brains";
import { appendHistory, councilAndOrders, isLiving, markParish, wealthLine } from "./review.server";
import { settleDay } from "./trading";
import { GALLOWS_DROP } from "./town";
import type { GameState, King, Subject } from "./types";
import { makeSubject, pushLog, withTotals } from "./world";
import { formatGbp, gbpToSats, mulberry32, rentSats, satsToGbp, stakeSats, tapeGbp } from "./wallets";

export async function runDailyTick(prev: GameState): Promise<GameState> {
  let tape = prev.tape;
  try {
    tape = await loadTape(prev.subjects.map((s) => s.asset ?? ""));
  } catch {
    tape = { ...prev.tape, dark: true, source: "dark" };
  }
  // Through a price outage the market keeps its stalls.
  if (tape.dark && !tape.coins) tape = { ...tape, coins: prev.tape.coins };

  const now = Date.now();
  const day = prev.day + 1;
  const rng = mulberry32(prev.seed + prev.day * 1009 + 7);
  const gbp = (sats: number) => formatGbp(satsToGbp(sats, tapeGbp(tape)));
  let log = prev.log;
  const push = (kind: Parameters<typeof pushLog>[1], text: string) => {
    log = pushLog({ day, log }, kind, text);
  };

  // Anyone condemned yesterday has had their day to be seen and is struck
  // from the ledger now (the client still plays one hang animation first).
  for (const s of prev.subjects.filter((x) => !isLiving(x))) push("death", `${s.firstName}'s name is struck from the ledger.`);
  const marked = markParish(prev.subjects.filter(isLiving), tape);

  // Settle the day that just ended, at the tax rate that ruled it.
  push("dawn", `Dawn of day ${day}. The King takes ${Math.round(prev.taxRate * 100)}% of yesterday's profits.`);
  const rent = rentSats(tape);
  const floor = gbpToSats(HANG_BELOW_GBP, tapeGbp(tape));
  let kingBalance = prev.king.balance;
  const settled: Subject[] = [];
  for (const sub of marked) {
    const dues = settleDay({
      balance: sub.balance,
      dayStart: sub.dayStart ?? sub.balance,
      taxRate: prev.taxRate,
      rent,
      floor,
    });
    kingBalance += dues.tithe + dues.rentPaid;
    const sign = dues.profit >= 0 ? "+" : "-";
    push(
      "subject",
      `${sub.firstName}: ${sign}${gbp(Math.abs(dues.profit))} on the day; tax ${gbp(dues.tithe)}, upkeep ${gbp(dues.rentPaid)}.`,
    );
    if (dues.hanged) {
      kingBalance += dues.balance;
      push("death", `${sub.firstName}'s purse has fallen below £${HANG_BELOW_GBP}. They are walked to the gallows.`);
      settled.push({
        ...sub,
        balance: 0,
        side: "flat",
        destX: GALLOWS_DROP.x,
        destY: GALLOWS_DROP.y,
        state: "condemned",
        hangT: 0,
      });
    } else {
      settled.push({ ...sub, balance: dues.balance, dayStart: dues.balance });
    }
  }

  // The treasury opens new souls by its fixed rule.
  const stake = stakeSats(tape);
  const alive = settled.filter(isLiving);
  const count = kingSpawnCount({
    treasury: kingBalance,
    living: alive.length,
    unproven: alive.filter((x) => x.bornDay === prev.day).length,
    policy: defaultKingPolicy(stake, LIVING_CAP),
  });
  const taken = new Set(settled.map((x) => x.firstName));
  for (let i = 0; i < count; i++) {
    const child = makeSubject(rng, taken, stake, day);
    child.dayStart = stake;
    kingBalance -= stake;
    settled.push(child);
    push("crown", `The King opens ${child.firstName} from the treasury, staked for trade.`);
  }

  // The King's council for the new day.
  const history = appendHistory(prev.priceHistory, tape, now);
  const opening: GameState = { ...prev, day, tape, king: { ...prev.king, balance: kingBalance } };
  const review = await councilAndOrders(opening, settled, tape, { dawn: true, rng, history, now });
  const council = review.council;
  const brain = review.parish?.brain ?? council?.brain ?? { kind: "heuristic" as const, label: "Heuristic (period English)" };

  // A standing royal decree (from the seal-bearer's petition) outranks the King's AI.
  const taxRate = prev.decree?.taxRate ?? council?.taxRate ?? prev.taxRate;
  const favorAsset = prev.decree?.favorAsset ?? council?.favorAsset ?? prev.king.favorAsset ?? "BTC";
  push("crown", `The King's tax for day ${day} is ${Math.round(taxRate * 100)}% of profits. He favours ${favorAsset}.`);
  const flavor = council?.say || kingFlavor(favorAsset);
  push("crown", flavor);
  push("system", review.summary);
  push("system", wealthLine(review.subjects, tape));

  const king: King = {
    ...prev.king,
    balance: kingBalance,
    lastAction: "hold",
    lastFlavor: flavor,
    favorAsset,
  };

  return withTotals({
    ...prev,
    day,
    tape,
    taxRate,
    subjects: review.subjects,
    king,
    log,
    seed: prev.seed + 17,
    brain,
    speech: review.speech,
    council: review.record,
    lastReviewAt: now,
    priceHistory: history,
  });
}

/**
 * A review between dawns: re-mark every position at the live price and take
 * the King's new orders. No dues are charged — those are settled at dawn.
 */
export async function runReview(prev: GameState): Promise<GameState> {
  let tape = await loadTape(prev.subjects.map((s) => s.asset ?? "")).catch(() => ({ ...prev.tape, dark: true, source: "dark" }));
  if (tape.dark && !tape.coins) tape = { ...tape, coins: prev.tape.coins };
  const now = Date.now();
  const rng = mulberry32(prev.seed + Math.floor(now / 60_000));
  const history = appendHistory(prev.priceHistory, tape, now);
  const marked = markParish(prev.subjects, tape);
  const review = await councilAndOrders({ ...prev, tape }, marked, tape, { dawn: false, rng, history, now });

  let log = prev.log;
  const push = (kind: Parameters<typeof pushLog>[1], text: string) => {
    log = pushLog({ day: prev.day, log }, kind, text);
  };
  if (review.council?.say) push("crown", review.council.say);
  push("system", review.summary);
  push("system", wealthLine(review.subjects, tape));

  return withTotals({
    ...prev,
    tape,
    subjects: review.subjects,
    log,
    brain: review.parish?.brain ?? review.council?.brain ?? prev.brain,
    speech: review.speech,
    council: review.record,
    lastReviewAt: now,
    priceHistory: history,
  });
}

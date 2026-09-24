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
import { priceOf } from "./dawn";
import { councilStrategies, isLiving, wealthLine } from "./review.server";
import { Journal, KING, MARKET, villagerAccount, withPostings } from "./ledger";
import { strategyChanges } from "./paper";
import { advanceSeason, checkMilestones, parishWealth, SEASONS_KEPT, type DawnBook } from "./progress";
import { crowdOf, needsRetraining, trainNewcomer } from "./lab";
import { BAR_LABEL, defaultStrategy, genesOf, unrealized } from "./strategies";
import { coinsNeeded } from "./trade.server";
import { settleDay, temperOf } from "./trading";
import { GALLOWS_DROP } from "./town";
import type { GameState, King, Subject } from "./types";
import { makeSubject, pushLog, withTotals } from "./world";
import { formatGbp, gbpToSats, mulberry32, rentSats, satsToGbp, stakeSats, tapeGbp } from "./wallets";

export async function runDailyTick(prev: GameState): Promise<GameState> {
  let tape = prev.tape;
  try {
    tape = await loadTape(coinsNeeded(prev));
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
  const marked = prev.subjects.filter(isLiving);

  // Settle the day that just ended, at the tax rate that ruled it. Only banked
  // (closed-trade) profit is taxed; open trades carry into the new day.
  push("dawn", `Dawn of day ${day}. The King takes ${Math.round(prev.taxRate * 100)}% of yesterday's profits.`);
  const rent = rentSats(tape);
  const floor = gbpToSats(HANG_BELOW_GBP, tapeGbp(tape));
  let kingBalance = prev.king.balance;
  const journal = new Journal({ at: now, day }, "dawn");
  const book: DawnBook = { day: prev.day, banked: 0, tax: 0, upkeep: 0, stakes: 0, gallows: 0 };
  let hangedToday = 0;
  const settled: Subject[] = [];
  for (const sub of marked) {
    const dues = settleDay({
      balance: sub.balance,
      dayStart: sub.dayStart ?? sub.balance,
      taxRate: prev.taxRate,
      rent,
      floor,
      carry: sub.lossCarry,
    });
    kingBalance += dues.tithe + dues.rentPaid;
    book.banked += dues.profit;
    book.tax += dues.tithe;
    book.upkeep += dues.rentPaid;
    journal.transfer(villagerAccount(sub.id), KING, dues.tithe, "tax", { memo: `${Math.round(prev.taxRate * 100)}% of the day's profit` });
    journal.transfer(villagerAccount(sub.id), KING, dues.rentPaid, "upkeep");
    // The gallows judge the whole purse, open trade included at today's price.
    const open = sub.position ? unrealized(sub.position, priceOf(tape, sub.position.coin)) : 0;
    const hanged = dues.balance + open < floor;
    const sign = dues.profit >= 0 ? "+" : "-";
    push(
      "subject",
      `${sub.firstName}: ${sign}${gbp(Math.abs(dues.profit))} on the day; tax ${gbp(dues.tithe)}${
        dues.offset > 0 ? ` (${gbp(dues.offset)} of the profit sheltered by earlier losses)` : ""
      }, upkeep ${gbp(dues.rentPaid)}${dues.profit < 0 ? `; ${gbp(dues.carry)} of losses carried forward` : ""}.`,
    );
    if (hanged) {
      hangedToday++;
      book.gallows += Math.max(0, dues.balance + open);
      kingBalance += Math.max(0, dues.balance + open);
      // The purse goes to the crown, and its open trade is settled at today's price against the market.
      journal.transfer(villagerAccount(sub.id), KING, dues.balance, "gallows", { memo: `${sub.firstName} hanged` });
      journal.transfer(MARKET, KING, Math.max(0, dues.balance + open) - dues.balance, "gallows", {
        coin: sub.position?.coin,
        memo: `${sub.firstName}'s open trade settled at the mark`,
      });
      push("death", `${sub.firstName}'s purse has fallen below £${HANG_BELOW_GBP}. They are walked to the gallows.`);
      settled.push({
        ...sub,
        balance: 0,
        side: "flat",
        position: undefined,
        destX: GALLOWS_DROP.x,
        destY: GALLOWS_DROP.y,
        state: "condemned",
        hangT: 0,
      });
    } else {
      settled.push({ ...sub, balance: dues.balance, dayStart: dues.balance, trades: 0, lossCarry: dues.carry || undefined });
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
    // Each newcomer is trained in a slightly adjusted copy of the guild book's best.
    const trained = trainNewcomer(
      prev.lab?.pool ?? [],
      rng,
      defaultStrategy(child.id, child.temper ?? temperOf(child.id), []),
      null,
      crowdOf(settled.filter(isLiving).map((x) => x.strategy)),
    );
    if (trained) child.strategy = trained;
    child.dayStart = stake;
    kingBalance -= stake;
    book.stakes += stake;
    journal.transfer(KING, villagerAccount(child.id), stake, "stake", { memo: `${child.firstName} opened from the treasury` });
    settled.push(child);
    push(
      "crown",
      `The King opens ${child.firstName} from the treasury, staked for trade${trained ? ` and trained in the guild's ${trained.kind} (${trained.genome?.book}, ${BAR_LABEL[genesOf(trained).bar]} bars)` : ""}.`,
    );
  }

  // The strategy council for the new day.
  const opening: GameState = { ...prev, day, tape, king: { ...prev.king, balance: kingBalance } };
  const review = await councilStrategies(opening, settled, tape, { dawn: true, rng, now });
  // The guild retrains strugglers: a villager losing money (or on a retired guild strategy) gets a book strategy instead.
  const pool = prev.lab?.pool ?? [];
  if (pool.length) {
    review.subjects = review.subjects.map((s) => {
      if (!isLiving(s)) return s;
      const why = needsRetraining(s, pool);
      if (!why) return s;
      const others = review.subjects.filter((x) => x.id !== s.id && isLiving(x)).map((x) => x.strategy);
      const trained = trainNewcomer(pool, rng, s.strategy ?? defaultStrategy(s.id, s.temper ?? temperOf(s.id), []), null, crowdOf(others));
      if (!trained || trained.genome?.book === (s.strategy?.genome?.book ?? s.strategy?.genome?.id)) return s;
      push("subject", `${s.firstName} ${why}, and is retrained by the guild in its ${trained.kind} (${trained.genome?.book}, ${BAR_LABEL[genesOf(trained).bar]} bars).`);
      // The new strategy is judged on its own trades, from here.
      return { ...s, strategy: { ...trained, note: "Retrained by the guild.", since: s.record ?? { wins: 0, losses: 0, pnl: 0 } } };
    });
  }
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
  const net = book.tax + book.upkeep + book.gallows - book.stakes;
  push(
    "crown",
    `The treasury's day: +${gbp(book.tax)} tax, +${gbp(book.upkeep)} upkeep${book.gallows ? `, +${gbp(book.gallows)} from the gallows` : ""}${
      book.stakes ? `, -${gbp(book.stakes)} to stake new souls` : ""
    } — ${net >= 0 ? "+" : "-"}${gbp(Math.abs(net))} in all. The parish ${book.banked >= 0 ? "banked" : "lost"} ${gbp(Math.abs(book.banked))} on the day.`,
  );

  // The season: the parish's objective, judged every few days on its whole wealth.
  const px = (coin: string) => priceOf(tape, coin);
  const wealth = parishWealth({ king: { ...prev.king, balance: kingBalance }, subjects: review.subjects }, px);
  const seasonStep = advanceSeason(prev.season, { day, at: now, wealth, hangedToday, money: gbp });
  for (const line of seasonStep.notes) push("crown", line);
  const seasons = seasonStep.result ? [seasonStep.result, ...(prev.seasons ?? [])].slice(0, SEASONS_KEPT) : prev.seasons;

  const king: King = {
    ...prev.king,
    balance: kingBalance,
    lastAction: "hold",
    lastFlavor: flavor,
    favorAsset,
  };

  const next: GameState = {
    ...withPostings(prev, journal.postings),
    day,
    tape,
    taxRate,
    subjects: review.subjects,
    king,
    log,
    season: seasonStep.season,
    seasons,
    lastDawn: book,
    strategyChanges: [...(prev.strategyChanges ?? []), ...strategyChanges(settled, review.subjects, "the dawn council", day, now)],
    seed: prev.seed + 17,
    brain,
    speech: review.speech,
    speechAt: now,
    council: review.record,
    lastReviewAt: now,
  };
  const reached = checkMilestones(next, now);
  for (const line of reached.notes) log = pushLog({ day, log }, "crown", line);
  return withTotals({ ...next, log, milestones: reached.milestones });
}

/**
 * A strategy review between dawns: the King advises and the villagers choose
 * their strategies again. No dues are charged — those are settled at dawn —
 * and no trades are made here; the 5-minute tick trades the new strategies.
 */
export async function runReview(prev: GameState): Promise<GameState> {
  let tape = await loadTape(coinsNeeded(prev)).catch(() => ({ ...prev.tape, dark: true, source: "dark" }));
  if (tape.dark && !tape.coins) tape = { ...tape, coins: prev.tape.coins };
  const now = Date.now();
  const rng = mulberry32(prev.seed + Math.floor(now / 60_000));
  const review = await councilStrategies({ ...prev, tape }, prev.subjects, tape, { dawn: false, rng, now });

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
    speechAt: now,
    council: review.record,
    lastReviewAt: now,
    strategyChanges: [...(prev.strategyChanges ?? []), ...strategyChanges(prev.subjects, review.subjects, "the strategy council", prev.day, now)],
  });
}

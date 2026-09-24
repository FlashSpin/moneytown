/**
 * Dawn — server-only, called once a day by the `/api/tick` cron. Money moves
 * on market days (src/game/market-day.ts, after each close); dawn keeps the
 * guild's calendar:
 *   1. strike yesterday's condemned from the roll,
 *   2. the gallows for any merchant whose ISA has fallen below RUIN_SHARE of
 *      its stake (its funds are sold at the latest close, the rest to the crown),
 *   3. the season: every SEASON_DAYS days the guild is judged against a
 *      60/40, and each merchant pays the guild's dues on its season gain,
 *   4. merchants far behind the 60/40 are retrained,
 *   5. the treasury stakes new merchants by its fixed rule,
 *   6. every COUNCIL_EVERY days the King advises and the merchants choose
 *      their strategies (royal decrees from the seal-bearer win).
 */
import { LIVING_CAP, STAKE_PENCE } from "./constants";
import { defaultKingPolicy, kingSpawnCount } from "./economy";
import { kingFlavor } from "./brains";
import { raiseCash, retrain, RUIN_SHARE, strategyForNewcomer, strategyLabel } from "./guild";
import { Journal, KING, villagerAccount, withPostings } from "./ledger";
import type { FundId } from "./merchant";
import { advanceSeason, checkMilestones, parishWealth, SEASONS_KEPT, type DawnBook } from "./progress";
import { COUNCIL_EVERY, councilStrategies, isLiving, wealthLine } from "./review.server";
import { temperOf } from "./trading";
import { GALLOWS_DROP } from "./town";
import type { GameState, King, Subject } from "./types";
import { makeSubject, pushLog, withTotals } from "./world";
import { money, mulberry32 } from "./wallets";

export async function runDailyTick(prev: GameState): Promise<GameState> {
  const now = Date.now();
  const day = prev.day + 1;
  const rng = mulberry32(prev.seed + prev.day * 1009 + 7);
  let log = prev.log;
  const push = (kind: Parameters<typeof pushLog>[1], text: string) => {
    log = pushLog({ day, log }, kind, text);
  };
  const price = (f: FundId) => prev.board?.funds[f]?.close ?? 0;
  const bench = prev.bench?.sf ?? 100;
  const book: DawnBook = { day: prev.day, dues: 0, stakes: 0, gallows: 0 };
  const journal = new Journal({ at: now, day }, "dawn");
  let kingBalance = prev.king.balance;

  push("dawn", `Dawn of day ${day}.${prev.board ? ` The market board stands at the close of ${prev.board.d}.` : ""}`);
  for (const s of prev.subjects.filter((x) => !isLiving(x))) push("death", `${s.firstName}'s name is struck from the ledger.`);

  // The gallows: an ISA fallen below RUIN_SHARE of its stake is sold up, and its money goes to the crown.
  let hangedToday = 0;
  let subjects: Subject[] = prev.subjects.filter(isLiving).map((s) => {
    const worth = s.worth ?? s.balance;
    const stake = s.track?.start ?? 0;
    if (!(stake > 0) || worth >= stake * RUIN_SHARE) return s;
    const sold = raiseCash(s, Number.MAX_SAFE_INTEGER, price);
    for (const f of sold.fills) {
      journal.trade({ t: now, d: prev.board?.d ?? "", id: s.id, name: s.firstName, fund: f.fund, value: f.value, cost: f.cost, why: "sold up at the gallows" });
    }
    const cash = sold.next.balance;
    journal.transfer(villagerAccount(s.id), KING, cash, "gallows", { memo: `${s.firstName}'s ISA, sold up` });
    kingBalance += cash;
    book.gallows += cash;
    hangedToday++;
    push("death", `${s.firstName}'s ISA has fallen below half its stake. The funds are sold and ${money(cash)} goes to the crown; ${s.firstName} is walked to the gallows.`);
    return { ...sold.next, balance: 0, holdings: {}, pending: undefined, worth: 0, destX: GALLOWS_DROP.x, destY: GALLOWS_DROP.y, state: "condemned" as const, hangT: 0 };
  });

  // The season: judged against the 60/40; at its close, the guild's dues on each merchant's gain.
  const wealth = parishWealth({ king: { ...prev.king, balance: kingBalance }, subjects });
  const seasonStep = advanceSeason(prev.season, { day, at: now, wealth, bench, hangedToday });
  for (const line of seasonStep.notes) push("crown", line);
  if (seasonStep.result || !prev.season) {
    subjects = subjects.map((s) => {
      if (!isLiving(s)) return s;
      const worth = s.worth ?? s.balance;
      const gain = worth - (s.seasonStart ?? worth);
      const due = seasonStep.result && gain > 0 ? Math.floor(gain * prev.taxRate) : 0;
      if (!(due > 0)) return { ...s, seasonStart: worth };
      const raised = raiseCash(s, due, price);
      for (const f of raised.fills) {
        journal.trade({ t: now, d: prev.board?.d ?? "", id: s.id, name: s.firstName, fund: f.fund, value: f.value, cost: f.cost, why: "sold to pay the guild's dues" });
      }
      const paid = Math.min(due, raised.next.balance);
      journal.transfer(villagerAccount(s.id), KING, paid, "tax", { memo: `the guild's dues: ${Math.round(prev.taxRate * 100)}% of the season's gain` });
      kingBalance += paid;
      book.dues += paid;
      const after = { ...raised.next, balance: raised.next.balance - paid };
      const newWorth = (after.worth ?? worth) - paid - raised.fills.reduce((n, f) => n + f.cost, 0);
      push("subject", `${s.firstName} grew ${money(gain)} this season and pays ${money(paid)} in dues.`);
      return { ...after, worth: newWorth, seasonStart: newWorth };
    });
  }

  // Merchants far behind the 60/40 are retrained.
  subjects = subjects.map((s) => {
    if (!isLiving(s)) return s;
    const r = retrain(s, bench, prev.book ?? []);
    if (!r) return s;
    push("subject", `${s.firstName} is ${r.why}, and is retrained by the guild in ${strategyLabel(r.strategy)}.`);
    return { ...s, strategy: r.strategy };
  });

  // The treasury stakes new merchants by its fixed rule.
  const alive = subjects.filter(isLiving);
  const count = kingSpawnCount({
    treasury: kingBalance,
    living: alive.length,
    unproven: alive.filter((x) => x.bornDay === prev.day).length,
    policy: defaultKingPolicy(STAKE_PENCE, LIVING_CAP),
  });
  const taken = new Set(subjects.map((x) => x.firstName));
  for (let i = 0; i < count; i++) {
    const child = makeSubject(rng, taken, STAKE_PENCE, day, bench);
    child.strategy = strategyForNewcomer(child.temper ?? temperOf(child.id), prev.book ?? [], rng);
    kingBalance -= STAKE_PENCE;
    book.stakes += STAKE_PENCE;
    journal.transfer(KING, villagerAccount(child.id), STAKE_PENCE, "stake", { memo: `${child.firstName} staked from the treasury` });
    subjects.push(child);
    push("crown", `The King stakes ${child.firstName} ${money(STAKE_PENCE)} from the treasury for an ISA, invested by ${strategyLabel(child.strategy)}.`);
  }

  // The council, every few days (strategies for an ISA shouldn't change often).
  const councilDue = !prev.council || day % COUNCIL_EVERY === 1;
  const opening: GameState = { ...prev, day, king: { ...prev.king, balance: kingBalance } };
  const review = councilDue ? await councilStrategies(opening, subjects, { dawn: true, rng, now }) : null;
  const council = review?.council ?? null;
  const taxRate = prev.decree?.taxRate ?? council?.taxRate ?? prev.taxRate;
  const favorAsset = prev.decree?.favorAsset ?? council?.favorAsset ?? prev.king.favorAsset ?? "SPY";
  if (review) {
    push("crown", `The guild's dues are ${Math.round(taxRate * 100)}% of each merchant's season gain. The King favours ${favorAsset}.`);
    push("crown", council?.say || kingFlavor(favorAsset));
    push("system", review.summary);
  }
  const finalSubjects = review?.subjects ?? subjects;
  push("system", wealthLine(finalSubjects));
  push("crown", `The treasury's day: ${book.dues ? `+${money(book.dues)} dues, ` : ""}${book.gallows ? `+${money(book.gallows)} from the gallows, ` : ""}${book.stakes ? `-${money(book.stakes)} to stake new merchants, ` : ""}now ${money(kingBalance)}.`);

  const seasons = seasonStep.result ? [seasonStep.result, ...(prev.seasons ?? [])].slice(0, SEASONS_KEPT) : prev.seasons;
  const king: King = { ...prev.king, balance: kingBalance, favorAsset, lastFlavor: council?.say || kingFlavor(favorAsset) };
  const next: GameState = {
    ...withPostings(prev, journal.postings),
    day,
    taxRate,
    subjects: finalSubjects,
    king,
    log,
    season: seasonStep.season,
    seasons,
    lastDawn: book,
    seed: prev.seed + 17,
    ...(review
      ? {
          brain: review.parish?.brain ?? council?.brain ?? { kind: "heuristic" as const, label: "Heuristic (period English)" },
          speech: review.speech,
          speechAt: now,
          council: review.record,
        }
      : {}),
  };
  const reached = checkMilestones(next, now);
  for (const line of reached.notes) log = pushLog({ day, log }, "crown", line);
  return withTotals({ ...next, log, milestones: reached.milestones });
}

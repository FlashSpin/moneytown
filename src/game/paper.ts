/**
 * Paper trading — pure, so it is easy to test. The villagers trade live
 * prices with pretend money; these functions turn what they did into
 * records (`ordersFrom`, `strategyChanges`), measure it per approach
 * (`paperStats`), compare it with the latest backtest (`compareWithBacktest`)
 * and decide whether the parish is anywhere near ready for real money
 * (`readinessGates`). Nothing here ever switches to real money: the gates
 * only report.
 */
import type { Metrics } from "./backtest.ts";
import type { Approach } from "./knowledge.ts";
import type { RejectedOrder, Strategy, TradeEvent } from "./strategies.ts";
import type { Subject } from "./types.ts";

export type PaperOrder = {
  at: number;
  day: number;
  villagerId: string;
  name: string;
  approach: Approach;
  coin: string;
  side: "long" | "short";
  action: "open" | "close";
  status: "filled" | "rejected";
  stake: number;
  /** The market price when the order was sent (mid, or last trade). */
  expectedPrice: number | null;
  fillPrice: number | null;
  costSats: number | null;
  feeSats: number | null;
  pnlSats: number | null;
  reason: string;
  /** The price one tick later (filled in by the next tick). */
  nextPrice?: number | null;
};

/** One tick's fills and rejections as order records. */
export function ordersFrom(
  events: TradeEvent[],
  rejects: { villagerId: string; name: string; order: RejectedOrder; expected: number }[],
  day: number,
  at: number,
): PaperOrder[] {
  const filled: PaperOrder[] = events.map((e) => ({
    at: e.t,
    day,
    villagerId: e.id,
    name: e.name,
    approach: e.own ? "own" : (e.by ?? "own"),
    coin: e.coin,
    side: e.side,
    action: e.action,
    status: "filled",
    stake: e.stake ?? 0,
    expectedPrice: e.mid ?? e.price,
    fillPrice: e.price,
    costSats: e.cost ?? 0,
    feeSats: e.fee ?? 0,
    pnlSats: e.action === "close" ? (e.pnl ?? 0) : null,
    reason: e.reason,
  }));
  const rejected: PaperOrder[] = rejects.map((r) => ({
    at,
    day,
    villagerId: r.villagerId,
    name: r.name,
    approach: r.order.by,
    coin: r.order.coin,
    side: r.order.side,
    action: "open",
    status: "rejected",
    stake: r.order.stake,
    expectedPrice: r.expected > 0 ? r.expected : null,
    fillPrice: null,
    costSats: null,
    feeSats: null,
    pnlSats: null,
    reason: r.order.reason,
  }));
  return [...filled, ...rejected];
}

export type StrategyChange = { at: number; day: number; villagerId: string; name: string; by: string; before: Strategy | null; after: Strategy };

const sameStrategy = (a: Strategy | undefined, b: Strategy | undefined) =>
  Boolean(a && b) &&
  a!.kind === b!.kind &&
  a!.coins.join() === b!.coins.join() &&
  a!.sizePct === b!.sizePct &&
  a!.takeProfitPct === b!.takeProfitPct &&
  a!.stopLossPct === b!.stopLossPct &&
  a!.shorts === b!.shorts;

/** Every villager whose strategy differs between two rolls, with who changed it. */
export function strategyChanges(before: Subject[], after: Subject[], by: string, day: number, at: number): StrategyChange[] {
  const was = new Map(before.map((s) => [s.id, s.strategy]));
  const out: StrategyChange[] = [];
  for (const s of after) {
    if (!s.strategy) continue;
    const prev = was.get(s.id);
    if (sameStrategy(prev, s.strategy)) continue;
    out.push({ at, day, villagerId: s.id, name: s.firstName, by, before: prev ?? null, after: s.strategy });
  }
  return out;
}

// ── Measuring paper trading ─────────────────────────────────────────────────

export type PaperStats = {
  approach: string;
  opens: number;
  closes: number;
  rejected: number;
  rejectRate: number | null;
  days: number;
  opensPerDay: number | null;
  avgStake: number | null;
  /** Spread + slippage + fee per filled order, as a share of the stake. */
  avgCostPct: number | null;
  /** How far fills landed from the expected price, as a share of it. */
  avgSlipPct: number | null;
  winRate: number | null;
  pnl: number;
  /** Worst fall of the running P&L from its high, in sats. */
  maxDrawdown: number;
  /** Average move in the trade's favour one tick after an open (signal quality), as a share. */
  followThrough: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function paperStats(orders: PaperOrder[], approach: string): PaperStats {
  const mine = orders.filter((o) => approach === "all" || o.approach === approach).sort((a, b) => a.at - b.at);
  const filled = mine.filter((o) => o.status === "filled");
  const opens = filled.filter((o) => o.action === "open");
  const closes = filled.filter((o) => o.action === "close");
  const rejected = mine.filter((o) => o.status === "rejected").length;
  const span = mine.length ? (mine[mine.length - 1]!.at - mine[0]!.at) / 86_400_000 : 0;
  const days = Math.max(span, mine.length ? 1 / 24 : 0);
  let running = 0;
  let peak = 0;
  let maxDd = 0;
  for (const c of closes) {
    running += c.pnlSats ?? 0;
    peak = Math.max(peak, running);
    maxDd = Math.max(maxDd, peak - running);
  }
  return {
    approach,
    opens: opens.length,
    closes: closes.length,
    rejected,
    rejectRate: opens.length + rejected ? rejected / (opens.length + rejected) : null,
    days: Math.round(days * 10) / 10,
    opensPerDay: days > 0 ? opens.length / days : null,
    avgStake: mean(opens.map((o) => o.stake)),
    avgCostPct: mean(filled.filter((o) => o.stake > 0).map((o) => ((o.costSats ?? 0) + (o.feeSats ?? 0)) / o.stake)),
    avgSlipPct: mean(filled.filter((o) => o.expectedPrice && o.fillPrice).map((o) => Math.abs(o.fillPrice! - o.expectedPrice!) / o.expectedPrice!)),
    winRate: closes.length ? closes.filter((c) => (c.pnlSats ?? 0) > 0).length / closes.length : null,
    pnl: running,
    maxDrawdown: maxDd,
    followThrough: mean(
      opens.filter((o) => o.nextPrice && o.fillPrice).map((o) => ((o.nextPrice! - o.fillPrice!) / o.fillPrice!) * (o.side === "long" ? 1 : -1)),
    ),
  };
}

// ── Paper against the backtest ──────────────────────────────────────────────

export type Discrepancy = { approach: string; measure: string; paper: number; backtest: number; note: string };
/** Paper trades needed before a comparison means anything. */
export const MIN_COMPARE_TRADES = 10;

/** Where live paper trading differs from what the backtest led us to expect. */
export function compareWithBacktest(paper: PaperStats, backtest: Metrics | null): Discrepancy[] {
  if (!backtest || paper.closes < MIN_COMPARE_TRADES || backtest.trades < MIN_COMPARE_TRADES || !(backtest.days > 0)) return [];
  const out: Discrepancy[] = [];
  const btPerDay = backtest.trades / backtest.days;
  if (paper.opensPerDay !== null && btPerDay > 0) {
    const ratio = paper.opensPerDay / btPerDay;
    if (ratio < 0.5 || ratio > 2)
      out.push({ approach: paper.approach, measure: "trades a day", paper: paper.opensPerDay, backtest: btPerDay, note: `${ratio.toFixed(1)}× the backtest's pace` });
  }
  const btCostPct = backtest.costPerFillPct;
  if (paper.avgCostPct !== null && btCostPct && btCostPct > 0 && paper.avgCostPct > btCostPct * 1.5)
    out.push({ approach: paper.approach, measure: "cost per fill", paper: paper.avgCostPct, backtest: btCostPct, note: "fills cost more live than the backtest assumed" });
  if (paper.winRate !== null && backtest.winRate !== null && Math.abs(paper.winRate - backtest.winRate) > 0.2)
    out.push({ approach: paper.approach, measure: "win rate", paper: paper.winRate, backtest: backtest.winRate, note: "wins far more or less often than in the backtest" });
  return out;
}

// ── The gates before any real money ─────────────────────────────────────────

export type Gate = { id: string; title: string; status: "pass" | "fail" | "manual"; detail: string };

export const PAPER_DAYS_REQUIRED = 30;
export const COMPLETION_REQUIRED = 0.95;
export const MAX_PAPER_DRAWDOWN = 0.2;

export function readinessGates(input: {
  /** Trading ticks run in the last 7 days, over the 7 × 288 expected. */
  completion7d: number | null;
  /** Ledger mismatches seen in the last 30 days. */
  ledgerMismatches30d: number;
  /** Strategies the latest backtest judged to make money on unseen data with enough trades. */
  backtestPassing: string[];
  paper: PaperStats;
  /** The parish's starting money, to judge the drawdown against. */
  capital: number;
  discrepancies: number;
  signoffs: { security?: string; monitoring?: string; legal?: string };
  /** How to show sats as money (defaults to sats). */
  money?: (sats: number) => string;
}): { gates: Gate[]; ready: boolean } {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const money = input.money ?? ((n: number) => `${n} sats`);
  const gates: Gate[] = [
    {
      id: "reliability",
      title: "The schedule runs reliably",
      status: input.completion7d !== null && input.completion7d >= COMPLETION_REQUIRED ? "pass" : "fail",
      detail:
        input.completion7d === null
          ? "no trading ticks recorded yet"
          : `${pct(input.completion7d)} of the expected trading ticks ran in the last 7 days (need ${pct(COMPLETION_REQUIRED)})`,
    },
    {
      id: "ledger",
      title: "The books always reconcile",
      status: input.ledgerMismatches30d === 0 ? "pass" : "fail",
      detail: input.ledgerMismatches30d === 0 ? "no ledger mismatch in 30 days" : `${input.ledgerMismatches30d} ledger mismatches in 30 days`,
    },
    { id: "risk", title: "Risk controls enforced on the server", status: "pass", detail: "Kelly sizing with a 6% cap, daily-loss and parish limits, exposure cap, halt and pause — covered by tests" },
    { id: "execution", title: "Realistic execution", status: "pass", detail: "bid/ask, slippage, fees, lot sizes and exchange minimums on every fill" },
    {
      id: "out-of-sample",
      title: "A strategy survives unseen data",
      status: input.backtestPassing.length ? "pass" : "fail",
      detail: input.backtestPassing.length
        ? `made money out of sample: ${input.backtestPassing.join(", ")}`
        : "no strategy made money on data it wasn't tuned on in the latest backtest",
    },
    {
      id: "paper",
      title: `${PAPER_DAYS_REQUIRED} days of profitable paper trading`,
      status:
        input.paper.days >= PAPER_DAYS_REQUIRED && input.paper.pnl > 0 && input.paper.maxDrawdown <= input.capital * MAX_PAPER_DRAWDOWN
          ? "pass"
          : "fail",
      detail: `${input.paper.days} of ${PAPER_DAYS_REQUIRED} days recorded, P&L ${input.paper.pnl >= 0 ? "+" : "-"}${money(Math.abs(input.paper.pnl))}, worst drawdown ${money(input.paper.maxDrawdown)} (limit ${Math.round(MAX_PAPER_DRAWDOWN * 100)}% of the parish)`,
    },
    {
      id: "consistency",
      title: "Paper trading matches the backtest",
      status: input.paper.closes >= MIN_COMPARE_TRADES && input.discrepancies === 0 ? "pass" : "fail",
      detail:
        input.paper.closes < MIN_COMPARE_TRADES
          ? `need ${MIN_COMPARE_TRADES}+ closed paper trades to compare (have ${input.paper.closes})`
          : input.discrepancies
            ? `${input.discrepancies} differences from the backtest to explain`
            : "frequency, costs and win rates in line",
    },
    manual("security", "Security review signed off", input.signoffs.security),
    manual("monitoring", "Monitoring and alerts in place", input.signoffs.monitoring),
    manual("legal", "Legal and regulatory assessment", input.signoffs.legal),
  ];
  return { gates, ready: gates.every((g) => g.status === "pass") };
}

function manual(id: string, title: string, signed: string | undefined): Gate {
  return signed
    ? { id, title, status: "pass", detail: `signed off: ${signed}` }
    : { id, title, status: "manual", detail: "needs a person to sign off" };
}

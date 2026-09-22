import type { SubjectAction, Tape } from "./types.ts";

export type Side = "long" | "short" | "flat";
export type Asset = "BTC" | "ETH" | "SOL";
export const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];

export function tapePnl(stake: number, changePct: number, side: Side): number {
  if (side === "flat" || stake <= 0 || !Number.isFinite(changePct)) return 0;
  const dir = side === "long" ? 1 : -1;
  return Math.round(stake * (changePct / 100) * dir);
}

/**
 * Real mark-to-market P&L for one villager's dawn: diffs their asset's price
 * since the LAST dawn against the new one, using their whole purse as stake.
 * Clamped so a single dawn can never drive the balance negative on its own.
 */
export function tradeIncome(
  balance: number,
  prevPriceUsd: number,
  currPriceUsd: number,
  side: Side,
): number {
  if (side === "flat" || balance <= 0 || !(prevPriceUsd > 0) || !(currPriceUsd > 0)) return 0;
  const changePct = ((currPriceUsd - prevPriceUsd) / prevPriceUsd) * 100;
  return Math.max(tapePnl(balance, changePct, side), -balance);
}

export function chooseSide(tape: Tape, rng: () => number): Side {
  if (tape.dark) return "flat";
  if (tape.change24h > 0.4) return "long";
  if (tape.change24h < -0.4) return "short";
  if (tape.fearGreed >= 70) return rng() > 0.55 ? "short" : "flat";
  if (tape.fearGreed <= 30) return rng() > 0.45 ? "long" : "flat";
  return rng() > 0.5 ? "long" : "flat";
}

/** King orders online work (earn) or rest — flavor for the town animation, not income. */
export function chooseSubjectAction(balance: number, _tape: Tape, rng: () => number): SubjectAction {
  if (balance <= 0) return "idle";
  return rng() < 0.85 ? "earn" : rng() < 0.5 ? "walk" : "idle";
}

export function applyRent(balance: number, rent: number): { balance: number; paid: number } {
  const due = Math.max(0, rent);
  const paid = Math.min(due, Math.max(0, balance));
  return { balance: Math.max(0, balance - paid), paid };
}

/** Tithe is `taxRate` of what remains — never a hardcoded 20%. */
export function applyTithe(
  balance: number,
  taxRate: number,
): { balance: number; tithe: number } {
  const rate = Math.min(1, Math.max(0, taxRate));
  const tithe = Math.floor(Math.max(0, balance) * rate);
  return { balance: Math.max(0, balance - tithe), tithe };
}

export function runSubjectDawn(opts: {
  balance: number;
  taxRate: number;
  tape: Tape;
  rng: () => number;
  action?: SubjectAction;
  side?: Side;
  rentSats: number;
}): {
  action: SubjectAction;
  income: number;
  rentPaid: number;
  tithe: number;
  balance: number;
  hanged: boolean;
  leftover: number;
  side: Side;
} {
  const action = opts.action ?? chooseSubjectAction(opts.balance, opts.tape, opts.rng);
  const side = opts.side ?? "flat";

  if (opts.balance <= 0) {
    return {
      action,
      income: 0,
      rentPaid: 0,
      tithe: 0,
      balance: 0,
      hanged: true,
      leftover: 0,
      side,
    };
  }

  let balance = opts.balance;
  const afterWork = applyRent(balance, opts.rentSats);
  balance = afterWork.balance;
  const afterTax = applyTithe(balance, opts.taxRate);
  balance = afterTax.balance;
  const hanged = balance <= 0;
  return {
    action,
    income: 0,
    rentPaid: afterWork.paid,
    tithe: afterTax.tithe,
    balance: hanged ? 0 : balance,
    hanged,
    leftover: hanged ? balance : 0,
    side,
  };
}

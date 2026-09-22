import { RENT_GBP, SATS_PER_BTC, STAKE_GBP } from "./constants.ts";

const BECH32 = "023456789acdefghjklmnpqrstuvwxyz";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local mark-to-market address only — never a key. */
export function fakeWallet(rng: () => number): string {
  let out = "bc1q";
  for (let i = 0; i < 38; i++) {
    out += BECH32[Math.floor(rng() * BECH32.length)] ?? "q";
  }
  return out;
}

export function pick<T>(list: readonly T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)] ?? list[0]!;
}

export function uid(prefix: string, rng: () => number): string {
  return `${prefix}-${Math.floor(rng() * 1e9).toString(36)}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function formatSats(sats: number): string {
  return `${Math.round(sats).toLocaleString("en-GB")} sats`;
}

export function satsToUsd(sats: number, btcUsd: number): number {
  return (sats / 100_000_000) * btcUsd;
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  if (Math.abs(usd) < 1) return `$${usd.toFixed(3)}`;
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function satsToGbp(sats: number, btcGbp: number): number {
  return (sats / SATS_PER_BTC) * btcGbp;
}

export function gbpToSats(gbp: number, btcGbp: number): number {
  if (!(btcGbp > 0) || !(gbp > 0)) return 0;
  return Math.max(1, Math.round((gbp / btcGbp) * SATS_PER_BTC));
}

export function formatGbp(gbp: number): string {
  if (!Number.isFinite(gbp)) return "—";
  return gbp.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  });
}

/** Live BTC/GBP, with a USD fallback so a dark tape still has a stake size. */
export function tapeGbp(tape: { btcGbp: number; btcUsd: number }): number {
  if (tape.btcGbp > 0) return tape.btcGbp;
  if (tape.btcUsd > 0) return tape.btcUsd / 1.33;
  return 74_000;
}

export function stakeSats(tape: { btcGbp: number; btcUsd: number }, gbp = STAKE_GBP): number {
  return gbpToSats(gbp, tapeGbp(tape));
}

export function rentSats(tape: { btcGbp: number; btcUsd: number }): number {
  return gbpToSats(RENT_GBP, tapeGbp(tape));
}

export function formatPurse(sats: number, tape: { btcGbp: number; btcUsd: number }): string {
  return formatGbp(satsToGbp(sats, tapeGbp(tape)));
}

export function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** The exchequer is the sum of every purse — king and living subjects. */
export function sumExchequer(king: { balance: number }, subjects: { balance: number }[]): number {
  return king.balance + subjects.reduce((n, x) => n + x.balance, 0);
}

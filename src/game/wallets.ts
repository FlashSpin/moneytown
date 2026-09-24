
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

/** A flavour-only account reference — never a real account. */
export function fakeWallet(rng: () => number): string {
  let out = "isa-";
  for (let i = 0; i < 12; i++) {
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

export function formatGbp(gbp: number): string {
  if (!Number.isFinite(gbp)) return "—";
  return gbp.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  });
}

/** Pence as pounds: £1,234.56. */
export function money(pence: number): string {
  return formatGbp(pence / 100);
}

export function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** The exchequer: the treasury plus every merchant's worth (cash and funds at the latest close). */
export function sumExchequer(king: { balance: number }, subjects: { balance: number; worth?: number }[]): number {
  return king.balance + subjects.reduce((n, x) => n + (x.worth ?? x.balance), 0);
}

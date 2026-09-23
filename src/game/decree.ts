/**
 * Royal commands from a petition — pure, so they are easy to test. The King's
 * AI only *proposes* a command; these helpers turn its raw JSON into exactly
 * what the rules allow (known names only, tax clamped to the legal range).
 */
import { TAX_MAX, TAX_MIN } from "./constants.ts";
import { ASSETS, type Asset } from "./dawn.ts";

/** A proposed change: a new value, "auto" (hand the choice back to the King's AI at dawn), or no change. */
export type DecreeChange<T> = T | "auto" | null;

export type Command = {
  summon: number;
  banish: string[];
  /** Tax as a fraction 0..TAX_MAX. */
  taxRate: DecreeChange<number>;
  favorAsset: DecreeChange<Asset>;
};

/** Standing royal orders the daily tick honours instead of the King's AI. */
export type Decree = { taxRate?: number; favorAsset?: Asset };

export function parseTaxPercent(v: unknown): DecreeChange<number> {
  if (v == null || v === "") return null;
  if (typeof v === "string" && v.trim().toLowerCase() === "auto") return "auto";
  const n = Number(typeof v === "string" ? v.replace("%", "") : v);
  if (!Number.isFinite(n)) return null;
  // Accept 10 (percent) or 0.1 (fraction); anything past the law is clamped.
  const frac = n > 1 ? n / 100 : n;
  return Math.round(Math.min(TAX_MAX, Math.max(TAX_MIN, frac)) * 100) / 100;
}

export function parseFavor(v: unknown): DecreeChange<Asset> {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (s === "AUTO") return "auto";
  return (ASSETS as string[]).includes(s) ? (s as Asset) : null;
}

/** The AI's raw JSON → a command. Unknown or malformed fields mean "no change". */
export function parseCommand(obj: { summon?: unknown; banish?: unknown; taxRate?: unknown; favorAsset?: unknown }): Command {
  const summon = Number(obj.summon);
  const banish = Array.isArray(obj.banish)
    ? obj.banish.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 24)
    : typeof obj.banish === "string" && obj.banish.trim()
      ? [obj.banish.trim()]
      : [];
  return {
    summon: Number.isFinite(summon) ? Math.max(0, Math.floor(summon)) : 0,
    banish,
    taxRate: parseTaxPercent(obj.taxRate),
    favorAsset: parseFavor(obj.favorAsset),
  };
}

/** Match requested names (or ids) to living souls, case-insensitively; unknown names are ignored. */
export function resolveBanish<T extends { id: string; firstName: string }>(living: T[], names: string[]): T[] {
  const out: T[] = [];
  for (const raw of names) {
    const want = raw.toLowerCase();
    const hit = living.find((s) => (s.firstName.toLowerCase() === want || s.id === raw) && !out.includes(s));
    if (hit) out.push(hit);
  }
  return out;
}

/** Whether a command asks for anything only the seal-bearer may order. */
export function needsSeal(c: Command): boolean {
  return c.banish.length > 0 || c.taxRate !== null || c.favorAsset !== null;
}

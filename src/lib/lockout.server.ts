/**
 * Lockout for guesses at the royal seal — server-only. Each failed guess is
 * recorded by a salted hash of the caller's address; an address with
 * PER_KEY failures in the last hour is locked out, and when GLOBAL failures
 * pile up in ten minutes (a spread-out attack), passphrase checks stop for
 * everyone for a while. Signed seal tokens are unaffected, so the owner is
 * never locked out of an open session.
 */
import { createHash } from "node:crypto";
import { getSql } from "./db";
import { log } from "./log.server";

export const PER_KEY = 10;
export const GLOBAL = 100;

export function keyFor(address: string): string {
  const salt = process.env.KING_SEAL?.trim() ?? "";
  return createHash("sha256").update(`lockout|${salt}|${address}`).digest("hex").slice(0, 32);
}

/** Why passphrase checks are refused for this caller right now, or null. */
export async function lockedOut(key: string): Promise<string | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ mine: number; everyone: number }>(
      `select
         (select count(*)::int from auth_failures where key = $1 and at > now() - interval '1 hour') as mine,
         (select count(*)::int from auth_failures where at > now() - interval '10 minutes') as everyone`,
      [key],
    );
    const r = rows[0];
    if (r && Number(r.mine) >= PER_KEY) return "too many wrong seals from here; try again within the hour";
    if (r && Number(r.everyone) >= GLOBAL) return "too many wrong seals lately; try again shortly";
    return null;
  } catch (e) {
    // Fail closed: without the table we can't count guesses, so no passphrase checks.
    log("error", "lockout.check_failed", { error: e instanceof Error ? e.message : String(e) });
    return "the seal can't be checked right now";
  }
}

export async function recordFailure(key: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `with gone as (delete from auth_failures where at < now() - interval '1 day')
       insert into auth_failures (key) values ($1)`,
      [key],
    );
    log("warn", "seal.wrong_guess", { key: key.slice(0, 8) });
  } catch (e) {
    log("error", "lockout.record_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

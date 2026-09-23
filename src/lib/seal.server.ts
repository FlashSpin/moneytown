import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The royal seal: a passphrase only the site's owner knows, set as KING_SEAL
 * in the deployment's environment. Whoever presents it may banish souls, set
 * the tax or favoured market, set strategies, and halt or pause trading.
 * Unset → nobody holds the seal.
 *
 * The passphrase is typed once; the browser then keeps a signed token that
 * expires (`sealToken`), never the passphrase itself. Changing KING_SEAL
 * invalidates every token.
 */
export const TOKEN_DAYS = 30;

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/** Constant-time string equality, whatever the lengths (both sides are hashed first). */
export function sameSecret(offered: string, secret: string): boolean {
  return timingSafeEqual(sha256(offered), sha256(secret));
}

function sealSecret(): string | null {
  return process.env.KING_SEAL?.trim() || null;
}

/** Whether `offered` is the seal passphrase itself. */
export function holdsSeal(offered: string | undefined | null): boolean {
  const seal = sealSecret();
  if (!seal || !offered) return false;
  return sameSecret(offered.trim(), seal);
}

function mac(payload: string, seal: string): string {
  const key = sha256(`ledgerford.seal-token|${seal}`);
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** A signed token standing for the seal until it expires. Null when no seal is set. */
export function sealToken(now = Date.now()): string | null {
  const seal = sealSecret();
  if (!seal) return null;
  const payload = `seal1.${now + TOKEN_DAYS * 86_400_000}`;
  return `${payload}.${mac(payload, seal)}`;
}

/** Whether `token` is a seal token signed with the current seal and not yet expired. */
export function holdsSealToken(token: string | undefined | null, now = Date.now()): boolean {
  const seal = sealSecret();
  if (!seal || !token) return false;
  const m = /^(seal1\.(\d{10,16}))\.([\w-]{20,100})$/.exec(token.trim());
  if (!m) return false;
  if (Number(m[2]) <= now) return false;
  return sameSecret(m[3]!, mac(m[1]!, seal));
}

/** The passphrase or a valid token. */
export function isSovereign(offered: string | undefined | null): boolean {
  return holdsSealToken(offered) || holdsSeal(offered);
}

/** A token-shaped value (so a failed token isn't counted as a guess at the passphrase). */
export function looksLikeToken(offered: string | undefined | null): boolean {
  return Boolean(offered && offered.startsWith("seal1."));
}

/** Whether a scheduler's request carries `Authorization: Bearer <CRON_SECRET>` (constant-time). */
export function bearerOk(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  return sameSecret(header.slice(7).trim(), secret);
}

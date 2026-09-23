import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The royal seal: a passphrase only the site's owner knows, set as KING_SEAL
 * in the deployment's environment. Whoever presents it may banish souls and
 * set the tax or favoured market. Unset → nobody holds the seal.
 */
export function holdsSeal(offered: string | undefined | null): boolean {
  const seal = process.env.KING_SEAL?.trim();
  if (!seal || !offered) return false;
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(offered.trim()).digest();
  const b = createHash("sha256").update(seal).digest();
  return timingSafeEqual(a, b);
}

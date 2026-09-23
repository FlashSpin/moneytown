/**
 * Structured logging — server-only. One JSON line per event, so Vercel's log
 * search can filter by `event`, `requestId` or `level`. Never log secrets:
 * pass only the fields you mean to keep.
 */
type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The caller's request id (x-request-id), or a new one. */
export function requestIdOf(request: Request): string {
  const given = request.headers.get("x-request-id")?.trim();
  return given && /^[\w.-]{6,80}$/.test(given) ? given : crypto.randomUUID();
}

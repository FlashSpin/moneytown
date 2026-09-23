/**
 * Structured logging — server-only. One JSON line per event, so Vercel's log
 * search can filter by `event`, `requestId` or `level`. Never log secrets:
 * pass only the fields you mean to keep.
 */
type Level = "info" | "warn" | "error";

/** Environment variables whose values must never reach a log line. */
const SECRET_ENV = ["CRON_SECRET", "KING_SEAL", "DATABASE_URL", "GEMINI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "BETTER_AUTH_SECRET"];

/** Replace any secret's value in `text` with [redacted]. */
export function redact(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const v = env[name]?.trim();
    if (v && v.length >= 6) out = out.split(v).join("[redacted]");
  }
  return out;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = redact(JSON.stringify({ level, event, at: new Date().toISOString(), ...fields }));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The caller's request id (x-request-id), or a new one. */
export function requestIdOf(request: Request): string {
  const given = request.headers.get("x-request-id")?.trim();
  return given && /^[\w.-]{6,80}$/.test(given) ? given : crypto.randomUUID();
}

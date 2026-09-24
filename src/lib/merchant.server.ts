/**
 * The Merchant guild's storage and daily step — server-only. The merchant
 * workflow (scripts/merchant-lab.ts) posts each fund's recent daily closes
 * and the lab's verdict; this saves them, keeps the guild's book of the
 * best strategies, and steps the paper ISA through every new trading day
 * (src/game/merchant.ts `stepIsa`).
 */
import { FUND_IDS, fixM, stepIsa, toDaily, type FundId, type Isa, type MEntry, type MLabResult, type MScore } from "@/game/merchant";
import { withBookCheck } from "@/game/ledger";
import { marketDay } from "@/game/market-day";
import { getSql } from "./db";
import { loadGuildWorld, saveWorldIfUnchanged } from "./world.server";

export type MerchantState = { isa?: Isa; book: MEntry[]; lastRun?: Omit<MLabResult, "curve"> & { at: number } };

const ID = "default";
const BOOK_MAX = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parse = <T,>(v: unknown) => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export async function loadMerchant(): Promise<MerchantState> {
  const sql = await getSql();
  const rows = await sql.query<{ state: unknown }>(`select state from merchant_state where id = $1`, [ID]);
  return rows[0] ? parse<MerchantState>(rows[0].state) : { book: [] };
}

async function saveMerchant(state: MerchantState): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into merchant_state (id, state, updated_at) values ($1, $2::jsonb, now())
     on conflict (id) do update set state = excluded.state, updated_at = now()`,
    [ID, JSON.stringify(state)],
  );
}

/** Keep only well-formed prices for known funds. */
export function cleanPrices(raw: unknown): Partial<Record<FundId, { d: string; c: number }[]>> {
  const out: Partial<Record<FundId, { d: string; c: number }[]>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const f of FUND_IDS) {
    const rows = (raw as Record<string, unknown>)[f];
    if (!Array.isArray(rows)) continue;
    out[f] = rows
      .slice(-1000)
      .filter((x): x is { d: string; c: number } => !!x && typeof x.d === "string" && DAY.test(x.d) && typeof x.c === "number" && x.c > 0 && Number.isFinite(x.c));
  }
  return out;
}

const cleanScore = (v: unknown): MScore => {
  const s = (v ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { days: n(s.days), total: n(s.total), cagr: n(s.cagr), vol: n(s.vol), sharpe: n(s.sharpe), maxDd: n(s.maxDd), turnover: n(s.turnover), trades: n(s.trades) };
};

/** A strategy entry from the lab: settings tidied, scores kept as numbers. */
export function cleanMEntry(raw: unknown): MEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!["hold", "trend", "momentum"].includes(String(o.mode))) return null;
  const g = fixM({
    id: String(o.id ?? "m").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "m",
    gen: Math.max(0, Math.floor(Number(o.gen) || 0)),
    ...(typeof o.parent === "string" ? { parent: o.parent.replace(/[^a-z0-9-]/gi, "").slice(0, 32) } : {}),
    mode: o.mode as MEntry["mode"],
    funds: (Array.isArray(o.funds) ? o.funds : []).map(String) as FundId[],
    sma: Number(o.sma) || 200,
    look: Number(o.look) || 126,
    top: Number(o.top) || 1,
    abs: o.abs ? 1 : 0,
    safe: String(o.safe) as FundId,
    every: Number(o.every) || 21,
  });
  return { ...g, train: cleanScore(o.train), val: cleanScore(o.val), test: cleanScore(o.test), proven: o.proven === true, edge: Number(o.edge) || 0 };
}

async function savePrices(prices: Partial<Record<FundId, { d: string; c: number }[]>>): Promise<number> {
  const rows = Object.entries(prices).flatMap(([f, r]) => (r ?? []).map((x) => ({ f, d: x.d, c: x.c })));
  if (!rows.length) return 0;
  const sql = await getSql();
  await sql.query(
    `insert into daily_prices (fund, day, close)
     select r.f, r.d::date, r.c from jsonb_to_recordset($1::jsonb) as r(f text, d text, c double precision)
     on conflict (fund, day) do update set close = excluded.close`,
    [JSON.stringify(rows)],
  );
  return rows.length;
}

async function loadRecentPrices(days = 420): Promise<Partial<Record<FundId, { d: string; c: number }[]>>> {
  const sql = await getSql();
  const rows = await sql.query<{ fund: string; day: string; close: number }>(
    `select fund, to_char(day, 'YYYY-MM-DD') as day, close from daily_prices where day >= current_date - $1::int order by fund, day`,
    [Math.ceil(days * 1.5)],
  );
  const out: Partial<Record<FundId, { d: string; c: number }[]>> = {};
  for (const r of rows) (out[r.fund as FundId] ??= []).push({ d: r.day, c: Number(r.close) });
  return out;
}

/**
 * Take a merchant post: save the prices and the lab's run, update the book,
 * and step the paper ISA through every trading day since its last.
 */
export async function takeMerchantPost(body: unknown): Promise<{ prices: number; days: number; value?: number; satellite?: string; guildDays: number; merchants: number }> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const saved = await savePrices(cleanPrices(o.prices));
  const state = await loadMerchant();

  const run = o.run && typeof o.run === "object" ? (o.run as Record<string, unknown>) : null;
  if (run) {
    const found = [run.champion, ...(Array.isArray(run.runnersUp) ? run.runnersUp : [])].map(cleanMEntry).filter((e): e is MEntry => !!e);
    const byKey = new Map(state.book.map((e) => [e.id, e]));
    for (const e of found) byKey.set(e.id, e);
    state.book = [...byKey.values()].sort((a, b) => Number(b.proven) - Number(a.proven) || b.edge - a.edge).slice(0, BOOK_MAX);
    const { curve: _curve, ...summary } = run as unknown as MLabResult;
    state.lastRun = { ...summary, at: Date.now() };
    const sql = await getSql();
    await sql.query(`insert into merchant_runs (summary) values ($1::jsonb)`, [JSON.stringify(state.lastRun)]);
  }

  const g = toDaily(await loadRecentPrices());
  const best = state.book.find((e) => e.proven) ?? null;
  let isa = state.isa;
  let stepped = 0;
  // Every trading day since the last one stepped; a new ISA starts on the latest day.
  const start = isa?.lastDay ? g.days.findIndex((d) => d > isa!.lastDay!) : g.days.length - 1;
  if (start >= 0) {
    for (let i = start; i < g.days.length; i++) {
      isa = stepIsa(isa, g, i, best).isa;
      stepped++;
    }
  }
  state.isa = isa;
  await saveMerchant(state);
  const guild = await stepGuild(g, state.book);
  return { prices: saved, days: stepped, value: isa?.history.at(-1)?.v, satellite: isa?.satellite.id, ...guild };
}

/**
 * Step the guild's world through every market day since its last: each
 * merchant's orders fill at the close and its ISA is valued
 * (src/game/market-day.ts). The books are checked first; a mismatch halts
 * new orders. Retries if the world changes underneath.
 */
async function stepGuild(g: ReturnType<typeof toDaily>, book: MEntry[]): Promise<{ guildDays: number; merchants: number }> {
  if (!g.days.length) return { guildDays: 0, merchants: 0 };
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await loadGuildWorld();
    const now = Date.now();
    let world = row.refounded ? row.state : withBookCheck(row.state, row.ledger, now);
    world = { ...world, book: book.slice(0, 10) };
    const last = world.lastMarketDay;
    // A new guild starts on the latest close; after that, every day since the last.
    const start = last ? g.days.findIndex((d) => d > last) : g.days.length - 1;
    let n = 0;
    if (start >= 0) {
      for (let i = start; i < g.days.length; i++) {
        world = marketDay(world, g, i, now);
        n++;
      }
    }
    if (await saveWorldIfUnchanged(world, row.rev)) {
      return { guildDays: n, merchants: world.subjects.filter((s) => s.state !== "condemned" && s.state !== "hanging").length };
    }
    await new Promise((r) => setTimeout(r, 250 + attempt * 400));
  }
  throw new Error("the world kept changing; the prices are saved and the guild steps on the next post");
}

export async function merchantRuns(limit = 10): Promise<{ id: number; createdAt: string; summary: MerchantState["lastRun"] }[]> {
  const sql = await getSql();
  const rows = await sql.query<{ id: number; created_at: string; summary: unknown }>(`select id, created_at, summary from merchant_runs order by id desc limit $1`, [limit]);
  return rows.map((r) => ({ id: Number(r.id), createdAt: new Date(r.created_at).toISOString(), summary: parse(r.summary) }));
}

/**
 * The Merchant guild's lab and daily prices, run on GitHub Actions
 * (.github/workflows/merchant.yml) after the US close on weekdays: fetches
 * every fund's full daily history (dividends included), breeds merchant
 * strategies and judges them against 60/40 (src/game/merchant.ts), prints
 * the verdict, and — on the main branch — posts the recent prices and the
 * results to the app (POST /api/merchant), which steps the paper ISA.
 *
 *   node --experimental-strip-types scripts/merchant-lab.ts
 *
 * Env: SITE_URL, CRON_SECRET (to post), POST_RESULTS=1, POPULATION,
 * GENERATIONS, SEED.
 */
import { appendFileSync } from "node:fs";
import { describeM, evolveMerchants, FUND_IDS, toDaily, type FundId, type MGenome, type MScore } from "../src/game/merchant.ts";

const env = process.env;
const SITE = (env.SITE_URL || "https://moneytown.vercel.app").replace(/\/$/, "");
/** Days of prices posted to the app: enough for the longest average and look-back. */
const POST_DAYS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string, tries = 3): Promise<string | null> {
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (ledgerford-merchant-lab)" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.text();
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // retry
    }
    await sleep(1500 * 2 ** k);
  }
  return null;
}

/** Yahoo's daily history with dividends and splits folded in (adjusted closes). */
async function yahoo(f: FundId): Promise<{ d: string; c: number }[]> {
  const text = await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${f}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&includeAdjustedClose=true`);
  if (!text) return [];
  const j = JSON.parse(text) as { chart?: { result?: { timestamp?: number[]; indicators?: { adjclose?: { adjclose?: (number | null)[] }[] } }[] } };
  const r = j.chart?.result?.[0];
  const t = r?.timestamp ?? [];
  const c = r?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const out: { d: string; c: number }[] = [];
  t.forEach((s, k) => {
    const v = c[k];
    if (v && v > 0) out.push({ d: new Date(s * 1000).toISOString().slice(0, 10), c: v });
  });
  return out;
}

/** Stooq's daily closes (not adjusted for dividends) — the fallback. */
async function stooq(f: FundId): Promise<{ d: string; c: number }[]> {
  const text = await getText(`https://stooq.com/q/d/l/?s=${f.toLowerCase()}.us&i=d`);
  if (!text || !text.startsWith("Date")) return [];
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .map((x) => ({ d: x[0]!, c: Number(x[4]) }))
    .filter((x) => x.c > 0);
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const row = (s: MScore) => `${pct(s.cagr)}/yr · Sharpe ${s.sharpe.toFixed(2)} · worst fall ${pct(-s.maxDd)}`;

async function main() {
  const rows: Partial<Record<FundId, { d: string; c: number }[]>> = {};
  const sources: Record<string, string> = {};
  for (const f of FUND_IDS) {
    let r = await yahoo(f);
    sources[f] = "yahoo (adjusted)";
    if (r.length < 1000) {
      r = await stooq(f);
      sources[f] = "stooq (not adjusted)";
    }
    if (!r.length) throw new Error(`no prices for ${f}`);
    rows[f] = r;
    console.log(`  ${f}: ${r.length} days from ${r[0]!.d} (${sources[f]})`);
    await sleep(400);
  }
  const g = toDaily(rows);

  const bookRes = await getText(`${SITE}/api/merchant`, 1);
  const book = bookRes ? ((JSON.parse(bookRes) as { book?: MGenome[] }).book ?? []) : [];
  const seed = Number(env.SEED || Math.floor(Date.now() / 86_400_000));
  const res = evolveMerchants(g, { seed, population: Number(env.POPULATION || 60), generations: Number(env.GENERATIONS || 60), seeds: book.slice(0, 6) });

  const lines: string[] = [];
  lines.push(`## Merchant lab — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`${res.evaluated} fund strategies tested on ${res.from} → ${res.to} (60% to breed, 20% to choose, the last 20% unseen), every trade paying 0.2%.`);
  lines.push("");
  lines.push("| | Training | Validation | Unseen test |");
  lines.push("|---|---|---|---|");
  for (const b of res.benchmarks) lines.push(`| ${b.name} | ${row(b.train)} | ${row(b.val)} | ${row(b.test)} |`);
  const c = res.champion;
  if (c) lines.push(`| **Champion:** ${describeM(c)}${c.proven ? " — PROVEN" : ""} | ${row(c.train)} | ${row(c.val)} | ${row(c.test)} |`);
  for (const r of res.runnersUp) lines.push(`| Runner-up: ${describeM(r)}${r.proven ? " — PROVEN" : ""} | ${row(r.train)} | ${row(r.val)} | ${row(r.test)} |`);
  lines.push("");
  lines.push(c ? (c.proven ? `The champion beat 60/40 on risk-adjusted return on both unseen slices (edge ${c.edge}).` : "The champion did not beat 60/40 on both unseen slices: not proven.") : "Nothing beat the training bar.");
  const report = lines.join("\n");
  console.log(`\n${report}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report + "\n");

  const recent = Object.fromEntries(Object.entries(rows).map(([f, r]) => [f, r!.slice(-POST_DAYS)]));
  const payload = { at: Date.now(), sources, prices: recent, run: { ...res, curve: res.curve.slice(-60) } };
  if (env.POST_RESULTS === "1") {
    if (!env.CRON_SECRET) throw new Error("POST_RESULTS=1 needs CRON_SECRET");
    const resp = await fetch(`${SITE}/api/merchant`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.CRON_SECRET}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    console.log(`Posted: HTTP ${resp.status} ${(await resp.text()).slice(0, 400)}`);
    if (!resp.ok) process.exitCode = 1;
  } else {
    console.log("Not posting (POST_RESULTS is not 1).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

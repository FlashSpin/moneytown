/**
 * The strategy lab, run on GitHub Actions (.github/workflows/strategy-lab.yml):
 * fetches months of real candles, breeds every kind of strategy on every
 * bar size (src/game/lab.ts), prints what it found, and — on the main branch
 * — posts the results to the app's guild book (POST /api/lab), which new
 * villagers and the King's summons draw on.
 *
 *   node --experimental-strip-types scripts/strategy-lab.ts
 *
 * Env: SITE_URL, CRON_SECRET (to post), POST_RESULTS=1, LAB_MINUTES (time
 * budget, default 30), DAYS_1H (default 1095: three years), COINS
 * (comma list), POPULATION, GENERATIONS, SEED.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { candleGrid, coarsen, holdBaseline, type Candle, type Grid } from "../src/game/backtest.ts";
import { describe, evolveNiche, mergePool, NICHES, nicheKey, seedsFor, slices, type Niche, type NicheResult, type PoolEntry, type Score } from "../src/game/lab.ts";
import { BAR_LABEL, type Bar } from "../src/game/strategies.ts";

const env = process.env;
const SITE = (env.SITE_URL || "https://moneytown.vercel.app").replace(/\/$/, "");
const DATA = "lab-data";
const OPTS = { balance: 1_000_000, stakeSats: 20_000 };
const DEFAULT_COINS = "BTC,ETH,SOL,XRP,DOGE,ADA,AVAX,LINK,DOT,LTC,BCH,UNI,AAVE,NEAR,ATOM,XLM,FIL,ETC,ALGO,HBAR,SHIB,APT,ARB,OP,INJ,SUI,MKR,GRT,CRV,SAND";

type Job = { niches: Niche[]; seeds: Record<string, PoolEntry[]>; deadline: number; population: number; generations: number; seed: number };

// ── Market data ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<unknown> {
  for (let k = 0; ; k++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "ledgerford-strategy-lab" }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      if (k >= tries - 1) return { error: e instanceof Error ? e.message : "failed" };
      await sleep(1000 * 2 ** k);
    }
  }
}

/** Coinbase Exchange candles, oldest first, paging back 300 at a time. */
async function coinbase(coin: string, granularity: number, days: number): Promise<Candle[]> {
  const out = new Map<number, Candle>();
  const step = granularity * 300 * 1000;
  const end = Math.floor(Date.now() / (granularity * 1000)) * granularity * 1000;
  for (let to = end; to > end - days * 86_400_000; to -= step) {
    const from = Math.max(to - step, end - days * 86_400_000);
    const url = `https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=${granularity}&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}`;
    const rows = await getJson(url);
    if (!Array.isArray(rows)) {
      if (out.size === 0) throw new Error(`coinbase ${coin}: ${(rows as { error?: string })?.error ?? "no data"}`);
      break;
    }
    for (const r of rows as number[][]) {
      const [t, l, h, o, c] = r;
      // Only closed candles: the one still forming would be look-ahead for nothing, and changes.
      if (t! * 1000 + granularity * 1000 <= Date.now()) out.set(t! * 1000, { t: t! * 1000, o: o!, h: h!, l: l!, c: c! });
    }
    await sleep(140);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/** Kraken's last 720 candles, when Coinbase doesn't list the coin. */
async function kraken(coin: string, minutes: number): Promise<Candle[]> {
  const pair = `${coin === "BTC" ? "XBT" : coin}USD`;
  const j = (await getJson(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${minutes}`)) as { error?: string[]; result?: Record<string, unknown> };
  const key = Object.keys(j.result ?? {}).find((k) => k !== "last");
  const rows = key ? (j.result![key] as (string | number)[][]) : [];
  if (!rows.length) throw new Error(`kraken ${coin}: ${JSON.stringify(j.error ?? "no data")}`);
  return rows.slice(0, -1).map((r) => ({ t: Number(r[0]) * 1000, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
}

async function candles(coin: string, minutes: 5 | 60, days: number): Promise<{ rows: Candle[]; source: string }> {
  try {
    return { rows: await coinbase(coin, minutes * 60, days), source: "coinbase" };
  } catch (e) {
    console.log(`  ${e instanceof Error ? e.message : e}; trying Kraken`);
    return { rows: await kraken(coin, minutes), source: "kraken" };
  }
}

/** Hourly candles only: every niche the lab breeds is on hourly or 4-hour bars (src/game/lab.ts SLOW_BARS). */
async function fetchData(coins: string[], daysH: number) {
  const h1: Record<string, Candle[]> = {};
  const sources: Record<string, string> = {};
  for (const coin of coins) {
    try {
      const b = await candles(coin, 60, daysH);
      h1[coin] = b.rows;
      sources[coin] = b.source;
      console.log(`  ${coin}: ${b.rows.length} × 1h (${b.source})`);
    } catch (e) {
      console.log(`  ${coin}: skipped — ${e instanceof Error ? e.message : e}`);
    }
  }
  return { h1, sources };
}

function grids(h1: Record<string, Candle[]>): Partial<Record<Bar, Grid>> {
  const map = (src: Record<string, Candle[]>, f: (c: Candle[]) => Candle[]) => Object.fromEntries(Object.entries(src).map(([k, v]) => [k, f(v)]));
  return {
    12: candleGrid(h1, 60 * 60_000),
    48: candleGrid(map(h1, (c) => coarsen(c, 60 * 60_000, 4)), 4 * 60 * 60_000),
  };
}

// ── Worker: breed the niches it was given ──────────────────────────────────

if (!isMainThread) {
  const job = workerData as Job;
  const raw = JSON.parse(readFileSync(`${DATA}/candles.json`, "utf8")) as { h1: Record<string, Candle[]> };
  const g = grids(raw.h1);
  const n = job.niches.length;
  job.niches.forEach((niche, k) => {
    const started = Date.now();
    const deadline = started + ((job.deadline - started) / (n - k)) * 1;
    const res = evolveNiche(g[niche.bar]!, niche, {
      ...OPTS,
      seed: job.seed + k * 7919,
      population: job.population,
      generations: job.generations,
      deadline,
      seeds: job.seeds[nicheKey(niche)] ?? [],
    });
    parentPort!.postMessage({ res, ms: Date.now() - started });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const brief = (s: Score) => `${String(s.trades).padStart(4)} trades ${pct(s.ret).padStart(7)} t=${s.t.toFixed(2).padStart(5)} win ${(s.winRate * 100).toFixed(0).padStart(3)}%`;

async function main() {
  const coins = (env.COINS || DEFAULT_COINS).split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const daysH = Number(env.DAYS_1H || 1095);
  const minutes = Number(env.LAB_MINUTES || 30);
  const seed = Number(env.SEED || Math.floor(Date.now() / 86_400_000));
  const population = Number(env.POPULATION || 40);
  const generations = Number(env.GENERATIONS || 40);
  const started = Date.now();

  console.log(`Strategy lab — ${coins.length} coins, ${daysH} days of hourly candles, ${minutes} min budget, seed ${seed}`);
  // The book so far: each run starts from the previous run's best.
  const bookRes = (await getJson(`${SITE}/api/lab`, 2)) as { pool?: PoolEntry[] };
  const book = Array.isArray(bookRes?.pool) ? bookRes.pool : [];
  console.log(`Guild book: ${book.length} genomes to start from`);

  console.log("Fetching candles…");
  const { h1, sources } = await fetchData(coins, daysH);
  if (Object.keys(h1).length < 3) throw new Error("not enough market data");
  mkdirSync(DATA, { recursive: true });
  writeFileSync(`${DATA}/candles.json`, JSON.stringify({ h1 }));
  const g = grids(h1);
  for (const bar of [12, 48] as Bar[]) {
    const gr = g[bar]!;
    console.log(`  ${BAR_LABEL[bar]} grid: ${gr.t.length} bars, ${new Date(gr.t[0]!).toISOString().slice(0, 10)} → ${new Date(gr.t[gr.t.length - 1]!).toISOString().slice(0, 10)}`);
  }

  // Share the niches out over the cores, the slow (short-bar) ones first so they spread evenly.
  const order = [...NICHES].sort((a, b) => a.bar - b.bar);
  const cores = Math.max(1, Math.min(availableParallelism(), Number(env.WORKERS || 4)));
  const buckets: Niche[][] = Array.from({ length: cores }, () => []);
  order.forEach((n, i) => buckets[i % cores]!.push(n));
  const deadline = started + minutes * 60_000 - 90_000;
  const seeds = Object.fromEntries(NICHES.map((n) => [nicheKey(n), seedsFor(book, n) as PoolEntry[]]));
  console.log(`Breeding ${NICHES.length} niches (7 kinds × 4 bar sizes) on ${cores} cores, population ${population}, up to ${generations} generations…`);

  const results: NicheResult[] = [];
  await Promise.all(
    buckets.map(
      (niches, w) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), { workerData: { niches, seeds, deadline, population, generations, seed: seed + w * 104729 } satisfies Job });
          worker.on("message", ({ res, ms }: { res: NicheResult; ms: number }) => {
            results.push(res);
            const c = res.champion;
            console.log(
              `  ${nicheKey(res.niche).padEnd(16)} ${res.evaluated} tried, ${res.generations} gens, ${(ms / 1000).toFixed(0)}s — ${c ? `val ${pct(c.val.ret)} test ${pct(c.test.ret)}${c.proven ? " PROVEN" : ""}` : "nothing worth keeping"}`,
            );
          });
          worker.on("error", reject);
          worker.on("exit", () => resolve());
        }),
    ),
  );

  const at = Date.now();
  const found = results.flatMap((r) => [r.champion, ...r.runnersUp]).filter((e): e is PoolEntry => !!e).map((e) => ({ ...e, at }));
  const merged = mergePool(book, found, at);
  const proven = found.filter((e) => e.proven);

  // The report.
  results.sort((a, b) => (b.champion?.score ?? -99) - (a.champion?.score ?? -99));
  const lines: string[] = [];
  lines.push(`## Strategy lab — ${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  lines.push("");
  lines.push(`${results.reduce((n, r) => n + r.evaluated, 0)} strategies backtested across ${results.length} niches on ${Object.keys(h1).length} coins. **${proven.length} proven** (made money on train, validation and the untouched test data — the last two together clearly — and with 1.5× costs).`);
  lines.push("");
  // What the market itself did over the same unseen slice: holding Bitcoin, and holding every coin equally.
  const hg = g[12]!;
  const test = slices(hg.t.length).test;
  const hold = (coin: string) => holdBaseline(hg, coin, 1_000_000, test[0], test[1])?.metrics.totalReturn;
  const btc = hold("BTC");
  const each = Object.keys(hg.px).map(hold).filter((x): x is number => x !== undefined);
  const basket = each.length ? each.reduce((a, b) => a + b, 0) / each.length : null;
  const from = new Date(hg.t[test[0]]!).toISOString().slice(0, 10);
  lines.push(`Over the unseen test (${from} → now), holding Bitcoin returned ${btc === undefined ? "—" : pct(btc)} and holding all ${each.length} coins equally ${basket === null ? "—" : pct(basket)}.`);
  lines.push("");
  lines.push("| Niche | Champion | Train | Validation | Test | Usual settings, test | Proven |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    const c = r.champion;
    lines.push(`| ${nicheKey(r.niche)} | ${c ? describe(c) : "—"} | ${c ? brief(c.train) : "—"} | ${c ? brief(c.val) : "—"} | ${c ? brief(c.test) : "—"} | ${brief(r.baseline.test)} | ${c?.proven ? "yes" : ""} |`);
  }
  const report = lines.join("\n");
  console.log(`\n${report}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report + "\n");

  const payload = {
    at,
    seed,
    minutes: Math.round((at - started) / 60_000),
    data: { coins: Object.keys(h1), sources, daysH, bars: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.t.length])) },
    market: { testFrom: hg.t[test[0]], btc: btc ?? null, basket },
    niches: results.map((r) => ({ niche: nicheKey(r.niche), evaluated: r.evaluated, generations: r.generations, curve: r.curve, baseline: r.baseline, champion: r.champion?.id ?? null, proven: !!r.champion?.proven })),
    found,
  };
  writeFileSync(`${DATA}/report.json`, JSON.stringify({ ...payload, pool: merged }, null, 1));

  if (env.POST_RESULTS === "1") {
    if (!env.CRON_SECRET) throw new Error("POST_RESULTS=1 needs CRON_SECRET");
    const res = await fetch(`${SITE}/api/lab`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.CRON_SECRET}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    console.log(`Posted to the guild book: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    if (!res.ok) process.exitCode = 1;
  } else {
    console.log("Not posting (POST_RESULTS is not 1).");
  }
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

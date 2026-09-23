/**
 * The live price tape — server-only. The parish trades the top coins by
 * market cap that the Kraken exchange lists (src/lib/market.ts):
 *   - Kraken's AssetPairs says what it trades (cached for hours),
 *   - CoinGecko's market-cap table says which of those are the top 20
 *     (and is the fallback price source),
 *   - one Kraken Ticker call prices them all, plus Bitcoin in pounds.
 * The town has a stall for each of the top 20; the villagers' strategies
 * scan the top 50 (`scan`). CoinGecko's trending list says which coins the
 * crowd is watching (`trending`), alongside the fear & greed index.
 * Coins a villager still holds are priced even after they leave the list.
 */
import type { Tape } from "@/game/types";
import {
  krakenGbpKey,
  parseGeckoMarkets,
  parseGeckoTrending,
  type Quote,
  parseKrakenPairs,
  parseKrakenTicker,
  pickTopCoins,
  type KrakenPair,
  type MarketCoin,
} from "./market";

/** How many coins the market lists — one stall each in the town. */
export const MARKET_SIZE = 20;
/** How many coins the villagers scan for trades — the stalls' 20 and the next 30. */
export const SCAN_SIZE = 50;

type FearPayload = { data?: { value?: string; value_classification?: string }[] };

function fngLabel(n: number): string {
  if (n <= 24) return "Extreme fear";
  if (n <= 44) return "Fear";
  if (n <= 55) return "Neutral";
  if (n <= 74) return "Greed";
  return "Extreme greed";
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ── Kraken ────────────────────────────────────────────────────────────────

const PAIRS_TTL_MS = 12 * 3_600_000;
let pairsCache: { at: number; usd: Map<string, KrakenPair>; gbpKey: string | null } | null = null;

export async function krakenPairs(): Promise<{ usd: Map<string, KrakenPair>; gbpKey: string | null } | null> {
  if (pairsCache && Date.now() - pairsCache.at < PAIRS_TTL_MS) return pairsCache;
  try {
    const body = await fetchJson("https://api.kraken.com/0/public/AssetPairs");
    const usd = parseKrakenPairs(body);
    if (!usd.size) return pairsCache;
    pairsCache = { at: Date.now(), usd, gbpKey: krakenGbpKey(body) };
    return pairsCache;
  } catch {
    return pairsCache; // a stale list beats none
  }
}

async function krakenTicker(keys: string[]): Promise<Map<string, Quote>> {
  if (!keys.length) return new Map();
  try {
    return parseKrakenTicker(await fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${keys.join(",")}`));
  } catch {
    return new Map();
  }
}

// ── CoinGecko (ranking + fallback prices) ────────────────────────────────

const MARKETS_TTL_MS = 30 * 60_000;
let marketsCache: { at: number; coins: MarketCoin[] } | null = null;

/**
 * The market-cap table. `fresh` is false when it's an old copy kept after a
 * failed fetch: still fine for the ranking, but its prices are too old to use.
 */
async function geckoMarkets(): Promise<{ coins: MarketCoin[]; fresh: boolean }> {
  if (marketsCache && Date.now() - marketsCache.at < MARKETS_TTL_MS) return { coins: marketsCache.coins, fresh: true };
  try {
    const coins = parseGeckoMarkets(
      await fetchJson(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=150&page=1",
      ),
    );
    if (coins.length) {
      marketsCache = { at: Date.now(), coins };
      return { coins, fresh: true };
    }
  } catch {
    // fall through to the old copy
  }
  return { coins: marketsCache?.coins ?? [], fresh: false };
}

// ── Crowd attention: CoinGecko's trending searches ───────────────────────

let trendingCache: { at: number; coins: string[] } | null = null;

async function trendingCoins(): Promise<string[]> {
  if (trendingCache && Date.now() - trendingCache.at < MARKETS_TTL_MS) return trendingCache.coins;
  try {
    const coins = parseGeckoTrending(await fetchJson("https://api.coingecko.com/api/v3/search/trending"));
    trendingCache = { at: Date.now(), coins };
    return coins;
  } catch {
    return trendingCache?.coins ?? [];
  }
}

// ── Other sources: Bitcoin in pounds, and the fear & greed index ─────────

async function coinbaseGbp(): Promise<number | null> {
  try {
    const raw = (await fetchJson("https://api.coinbase.com/v2/prices/BTC-GBP/spot")) as { data?: { amount?: string } };
    const n = Number(raw.data?.amount);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function fearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const raw = (await fetchJson("https://api.alternative.me/fng/?limit=1")) as FearPayload;
    const row = raw.data?.[0];
    const value = Number(row?.value);
    if (!Number.isFinite(value)) return null;
    return { value, label: row?.value_classification ?? fngLabel(value) };
  } catch {
    return null;
  }
}

// ── The tape ──────────────────────────────────────────────────────────────

const TAPE_TTL_MS = 15_000;
let cached: { at: number; tape: Tape } | null = null;
let inflight: Promise<Tape> | null = null;

/**
 * Cached and de-duplicated so a burst of requests doesn't fan out to every
 * upstream. `held` are coins villagers still hold, priced even if they've
 * left the top 20.
 */
export async function loadTape(held: string[] = []): Promise<Tape> {
  const covers = (t: Tape) => held.every((c) => !c || t.assets[c]);
  if (cached && Date.now() - cached.at < TAPE_TTL_MS && covers(cached.tape)) return cached.tape;
  inflight ??= fetchTapeUncached(held)
    .then((tape) => {
      cached = { at: Date.now(), tape };
      return tape;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function fetchTapeUncached(held: string[]): Promise<Tape> {
  const [pairs, gecko, fng, trending] = await Promise.all([krakenPairs(), geckoMarkets(), fearGreed(), trendingCoins()]);
  const markets = gecko.coins;
  const scan = pickTopCoins(markets, pairs?.usd ?? null, SCAN_SIZE);
  const coins = scan.slice(0, MARKET_SIZE);
  const wanted = [...new Set([...scan, ...held.filter(Boolean)])];

  const keys = wanted.map((c) => pairs?.usd.get(c)?.key).filter((k): k is string => Boolean(k));
  const [ticker, cbGbp] = await Promise.all([
    krakenTicker(pairs?.gbpKey ? [...keys, pairs.gbpKey] : keys),
    coinbaseGbp(),
  ]);
  const bySymbol = new Map(markets.map((m) => [m.symbol, m]));

  const assets: Tape["assets"] = {};
  let fromKraken = 0;
  for (const coin of wanted) {
    const pair = pairs?.usd.get(coin);
    const k = pair ? ticker.get(pair.key) : undefined;
    const g = bySymbol.get(coin);
    if (k) {
      assets[coin] = {
        usd: k.usd,
        change24h: k.change24h,
        name: g?.name,
        src: "kraken",
        ...(k.bid && k.ask ? { bid: k.bid, ask: k.ask } : {}),
        ...(k.vol24hUsd ? { vol24hUsd: k.vol24hUsd } : {}),
        ...(pair?.ordermin ? { ordermin: pair.ordermin } : {}),
        ...(pair?.costmin ? { costmin: pair.costmin } : {}),
        ...(pair?.lotDecimals !== undefined ? { lotDecimals: pair.lotDecimals } : {}),
      };
      fromKraken++;
    } else if (g && gecko.fresh) {
      // No order book from the fallback source: execution estimates the spread.
      assets[coin] = { usd: g.usd, change24h: g.change24h, name: g.name, src: "coingecko" };
    }
  }

  const btc = assets.BTC;
  const dark = !(btc && btc.usd > 0);
  const krakenGbp = pairs?.gbpKey ? ticker.get(pairs.gbpKey)?.usd : undefined;
  const btcUsd = dark ? 100_000 : btc.usd;
  const btcGbp = krakenGbp || cbGbp || btcUsd / 1.33;
  const fg = fng?.value ?? 50;

  return {
    btcUsd,
    btcGbp: dark ? 74_000 : btcGbp,
    change24h: dark ? 0 : btc.change24h,
    fearGreed: fg,
    fearGreedLabel: fng?.label ?? fngLabel(fg),
    dark,
    source: dark ? "dark" : fromKraken > 0 ? "Kraken" : "CoinGecko",
    fetchedAt: Date.now(),
    assets: dark ? { BTC: { usd: 100_000, change24h: 0 } } : assets,
    coins: dark ? undefined : coins.filter((c) => assets[c]),
    scan: dark ? undefined : scan.filter((c) => assets[c]),
    trending: dark ? undefined : trending,
  };
}

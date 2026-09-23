/**
 * The parish's market — pure parsing and ranking, so it is easy to test.
 *
 * Kraken is the exchange: FCA-registered for UK customers (GBP, Faster
 * Payments), with public REST/WebSocket market data and, later, an order API
 * the villagers' trades could be routed to. Every tradable coin is therefore
 * one Kraken actually lists against USD. Which coins: the top N by live
 * market cap (CoinGecko), skipping stablecoins and wrapped/staked tokens,
 * which don't move and aren't worth trading.
 */

export type KrakenPair = {
  /** Kraken's pair key for the Ticker endpoint, e.g. "XXBTZUSD". */
  key: string;
  /** Minimum order size in the base coin and minimum cost in USD. */
  ordermin?: number;
  costmin?: number;
  /** Decimal places allowed in an order's quantity. */
  lotDecimals?: number;
};

/** One coin's quote: last trade, best bid and ask, and 24h volume in USD. */
export type Quote = { usd: number; change24h: number; bid?: number; ask?: number; vol24hUsd?: number };

export type MarketCoin = {
  symbol: string;
  name: string;
  marketCap: number;
  usd: number;
  change24h: number;
};

/** Kraken's legacy names for a few coins. */
const KRAKEN_ALIASES: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };

/** Coins that don't trade like coins: stablecoins, and wrapped or staked copies of others. */
const NOT_TRADABLE = new Set([
  "USDT", "USDC", "DAI", "USDE", "USDS", "FDUSD", "TUSD", "PYUSD", "USD1", "BUSD", "USDD", "RLUSD", "USDP", "GUSD",
  "USDG", "USDY", "FRAX", "LUSD", "EURC", "EURT", "BSC-USD", "SUSDE", "SUSDS", "USDTB", "USYC", "BUIDL",
  "STETH", "WSTETH", "WETH", "WEETH", "RETH", "CBETH", "METH", "EZETH", "WBETH", "RSETH", "OSETH", "LSETH",
  "WBTC", "CBBTC", "LBTC", "TBTC", "SOLVBTC", "BTCB", "CLBTC", "JITOSOL", "MSOL", "BNSOL", "JUPSOL", "SSOL",
  "XAUT", "PAXG",
]);

export function isTradableCoin(c: { symbol: string; usd: number }): boolean {
  const sym = c.symbol.toUpperCase();
  if (NOT_TRADABLE.has(sym)) return false;
  // Anything priced at a dollar that barely moves is a stablecoin by another name.
  if (Math.abs(c.usd - 1) < 0.02 && /USD|EUR/.test(sym)) return false;
  return true;
}

/**
 * Kraken's AssetPairs → coin symbol → USD pair. Uses `wsname` ("XBT/USD") for
 * the plain symbol, skips anything not online, and prefers the first listing.
 */
export function parseKrakenPairs(body: unknown): Map<string, KrakenPair> {
  const out = new Map<string, KrakenPair>();
  const result = (body as { result?: Record<string, Record<string, unknown>> })?.result;
  if (!result || typeof result !== "object") return out;
  for (const [key, p] of Object.entries(result)) {
    const ws = typeof p.wsname === "string" ? p.wsname : "";
    const [base, quote] = ws.split("/");
    if (!base || quote !== "USD") continue;
    if (p.status && p.status !== "online") continue;
    const symbol = KRAKEN_ALIASES[base] ?? base;
    if (out.has(symbol)) continue;
    out.set(symbol, {
      key,
      ordermin: Number(p.ordermin) || undefined,
      costmin: Number(p.costmin) || undefined,
      lotDecimals: Number.isInteger(p.lot_decimals) ? Number(p.lot_decimals) : undefined,
    });
  }
  return out;
}

/** Kraken's pair key for Bitcoin in pounds (for showing purses in £), if listed. */
export function krakenGbpKey(body: unknown): string | null {
  const result = (body as { result?: Record<string, Record<string, unknown>> })?.result;
  if (!result || typeof result !== "object") return null;
  for (const [key, p] of Object.entries(result)) {
    if (p.wsname === "XBT/GBP" && (!p.status || p.status === "online")) return key;
  }
  return null;
}

/**
 * Kraken's Ticker → a quote per pair key: `c[0]` the last trade, `o` today's
 * open, `b[0]`/`a[0]` the best bid and ask, `v[1]` the last 24h's volume in
 * the base coin. A book that is crossed or absurdly wide is dropped (the
 * last price still stands).
 */
export function parseKrakenTicker(body: unknown): Map<string, Quote> {
  const out = new Map<string, Quote>();
  const result = (body as { result?: Record<string, { c?: unknown[]; o?: unknown; a?: unknown[]; b?: unknown[]; v?: unknown[] }> })?.result;
  if (!result || typeof result !== "object") return out;
  const first = (v: unknown, i = 0) => Number(Array.isArray(v) ? v[i] : NaN);
  for (const [key, t] of Object.entries(result)) {
    const last = first(t.c);
    const open = Number(t.o);
    if (!(last > 0)) continue;
    const q: Quote = { usd: last, change24h: open > 0 ? ((last - open) / open) * 100 : 0 };
    const bid = first(t.b);
    const ask = first(t.a);
    if (bid > 0 && ask >= bid && (ask - bid) / last < 0.05) {
      q.bid = bid;
      q.ask = ask;
    }
    const vol = first(t.v, 1);
    if (vol > 0) q.vol24hUsd = Math.round(vol * last);
    out.set(key, q);
  }
  return out;
}

/** CoinGecko's /coins/markets → coins in market-cap order. */
export function parseGeckoMarkets(body: unknown): MarketCoin[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((c: Record<string, unknown>) => ({
      symbol: String(c.symbol ?? "").toUpperCase(),
      name: String(c.name ?? c.symbol ?? ""),
      marketCap: Number(c.market_cap) || 0,
      usd: Number(c.current_price) || 0,
      change24h: Number(c.price_change_percentage_24h) || 0,
    }))
    .filter((c) => c.symbol && c.usd > 0)
    .sort((a, b) => b.marketCap - a.marketCap);
}

/** Symbols from CoinGecko's trending searches, most searched first. */
export function parseGeckoTrending(body: unknown): string[] {
  const rows = (body as { coins?: { item?: { symbol?: unknown } }[] } | null)?.coins;
  if (!Array.isArray(rows)) return [];
  const out = rows.map((r) => String(r?.item?.symbol ?? "").trim().toUpperCase()).filter(Boolean);
  return [...new Set(out)].slice(0, 15);
}

/** Well-known large caps, in rough market-cap order — used only when the live ranking can't be fetched. */
export const DEFAULT_COINS = [
  "BTC", "ETH", "XRP", "SOL", "DOGE", "TRX", "ADA", "LINK", "AVAX", "XLM",
  "SUI", "BCH", "HBAR", "LTC", "TON", "DOT", "SHIB", "UNI", "NEAR", "AAVE",
];

/**
 * The top `n` coins by market cap that Kraken trades against USD. With no
 * live ranking, the default list stands in; with no Kraken list, nothing is
 * filtered out (prices then come from the fallback source).
 */
export function pickTopCoins(markets: MarketCoin[], kraken: Map<string, KrakenPair> | null, n: number): string[] {
  const listed = (sym: string) => !kraken || kraken.size === 0 || kraken.has(sym);
  const seen = new Set<string>();
  const ranked = markets.length ? markets.map((c) => c) : DEFAULT_COINS.map((symbol) => ({ symbol, usd: 2 }));
  const out: string[] = [];
  for (const c of ranked) {
    if (out.length >= n) break;
    if (seen.has(c.symbol) || !isTradableCoin(c) || !listed(c.symbol)) continue;
    seen.add(c.symbol);
    out.push(c.symbol);
  }
  // Bitcoin anchors the economy (purses are held in it) — it is always on the list.
  if (!out.includes("BTC")) out.splice(0, out.length >= n ? 1 : 0, "BTC");
  return out.slice(0, n);
}

/** Compact USD price for a shop sign: $98.4k, $3,512, $2.31, $0.0823, $0.00001234. */
export function formatCoinPrice(usd: number): string {
  if (!(usd > 0)) return "—";
  if (usd >= 100_000) return `$${(usd / 1000).toFixed(0)}k`;
  if (usd >= 10_000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1_000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toPrecision(4)}`;
}

/**
 * Position sides and tradable coins. A coin is any symbol the parish's market
 * lists (the top 20 Kraken trades, ranked daily — see src/lib/market.ts);
 * `marketCoins` gives them in rank order. Trading and the day's dues live in
 * ./trading.ts.
 */
export type Side = "long" | "short" | "flat";
export type Asset = string;

/** The original three, for worlds saved before the market grew. */
export const CORE_ASSETS: Asset[] = ["BTC", "ETH", "SOL"];

/**
 * The market's coins in rank order (market cap), falling back to whatever has
 * a price. Listed coins stay listed through a price outage — their stalls
 * stand, their signs just read "—".
 */
export function marketCoins(tape: { coins?: string[]; assets: Record<string, { usd: number }> }): Asset[] {
  if (tape.coins?.length) return tape.coins;
  const priced = Object.keys(tape.assets);
  return priced.length ? priced : CORE_ASSETS;
}

/** A coin's live price, or 0 when the market has none. */
export function priceOf(tape: { assets: Record<string, { usd: number }> }, coin: Asset): number {
  return tape.assets[coin]?.usd ?? 0;
}

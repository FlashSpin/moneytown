/** The tradable assets and position sides. Trading and the day's dues live in ./trading.ts. */
export type Side = "long" | "short" | "flat";
export type Asset = "BTC" | "ETH" | "SOL";
export const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];

/**
 * Execution — pure, so it is easy to test. The strategies and the trading
 * desk only decide *what* to trade (src/game/strategies.ts); this layer
 * alone decides whether and at what price an order fills, the way an
 * exchange would:
 *
 *   - buys fill at the ask and sells at the bid (Kraken's live book; an
 *     estimated spread when the price came from the fallback source),
 *   - plus slippage that grows with the order's size against the coin's 24h
 *     volume (square-root market impact, never below MIN_SLIPPAGE),
 *   - the quantity is rounded down to the pair's lot precision,
 *   - an order below the exchange's minimum size or cost is rejected, and so
 *     is one bigger than MAX_VOLUME_SHARE of the day's volume.
 * Closing is never rejected: a position can always be got out of.
 * Purses are in sats; orders are priced in USD at `tape.btcUsd`.
 */
import type { Asset } from "./dawn.ts";
import { FEE_RATE, MAKER_FEE_RATE } from "./risk.ts";
import type { AssetQuote, Tape } from "./types.ts";

export const MIN_SLIPPAGE = 0.0002;
/** Square-root impact coefficient: slippage = IMPACT × √(order ÷ 24h volume). */
export const IMPACT = 0.1;
export const MAX_VOLUME_SHARE = 0.01;
/** Half-spread assumed without a live book: tighter for the biggest coins. */
export const EST_HALF_SPREAD_TOP = 0.0005;
export const EST_HALF_SPREAD = 0.0015;
export const DEFAULT_LOT_DECIMALS = 8;
const SATS_PER_BTC = 100_000_000;

export type OpenFill =
  | { ok: true; price: number; mid: number; stake: number; qty: number; cost: number }
  | { ok: false; reason: string };
export type CloseFill = { price: number; mid: number; cost: number };

export type Executor = {
  /** The exchange's fee per fill, as a fraction of the stake. */
  feeRate: number;
  /** The fee when a resting limit order is filled (a maker fill). */
  makerFeeRate: number;
  /**
   * Whether a resting limit order to open `side` at `limit` has been filled:
   * a buy once sellers came down to it, a sell once buyers came up to it.
   */
  limitFilled(coin: Asset, side: "long" | "short", limit: number): boolean;
  /** Fill an order to open `side` on `coin` for up to `stake` sats. */
  open(coin: Asset, side: "long" | "short", stake: number): OpenFill;
  /** Fill the order that closes a position of `stake` sats and `qty` coins. */
  close(coin: Asset, side: "long" | "short", stake: number, qty?: number): CloseFill;
};

/** Fills at the given price with no costs and no limits — for tests and what-ifs. */
export function idealExecutor(priceOf: (coin: Asset) => number): Executor {
  return {
    feeRate: FEE_RATE,
    makerFeeRate: MAKER_FEE_RATE,
    limitFilled: (coin, side, limit) => {
      const px = priceOf(coin);
      return px > 0 && (side === "long" ? px <= limit : px >= limit);
    },
    open: (coin, _side, stake) => {
      const px = priceOf(coin);
      return px > 0 && stake > 0 ? { ok: true, price: px, mid: px, stake, qty: 0, cost: 0 } : { ok: false, reason: "no price" };
    },
    close: (coin) => {
      const px = priceOf(coin);
      return { price: px, mid: px, cost: 0 };
    },
  };
}

function midOf(q: AssetQuote): number {
  return q.bid && q.ask ? (q.bid + q.ask) / 2 : q.usd;
}

/** The half-spread and slippage for an order of `orderUsd`, as fractions of the mid. */
export function costOf(q: AssetQuote, orderUsd: number, top: boolean): { halfSpread: number; slippage: number } {
  const mid = midOf(q);
  const halfSpread = q.bid && q.ask && mid > 0 ? (q.ask - q.bid) / 2 / mid : top ? EST_HALF_SPREAD_TOP : EST_HALF_SPREAD;
  const impact = q.vol24hUsd && q.vol24hUsd > 0 ? IMPACT * Math.sqrt(orderUsd / q.vol24hUsd) : 0.001;
  return { halfSpread, slippage: Math.max(MIN_SLIPPAGE, impact) };
}

/** Price for buying (`dir` +1) or selling (-1) `orderUsd` worth. */
export function fillPrice(q: AssetQuote, dir: 1 | -1, orderUsd: number, top: boolean): { price: number; mid: number } {
  const mid = midOf(q);
  const { halfSpread, slippage } = costOf(q, orderUsd, top);
  return { price: mid * (1 + dir * (halfSpread + slippage)), mid };
}

const floorTo = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.floor(n * f + 1e-9) / f;
};

/** The exchange-like executor for a tick's tape. `top` = coins treated as the most liquid (for the estimated spread). */
export function marketExecutor(tape: Pick<Tape, "assets" | "btcUsd" | "coins">, top: ReadonlySet<Asset> = new Set(tape.coins?.slice(0, 10))): Executor {
  const usdPerSat = tape.btcUsd / SATS_PER_BTC;
  return {
    feeRate: FEE_RATE,
    makerFeeRate: MAKER_FEE_RATE,
    // A resting buy at `limit` fills once the best offer has come down to it (a sell, once the best bid is up to it);
    // without a live book, once the price has.
    limitFilled(coin, side, limit) {
      const q = tape.assets[coin];
      if (!q || !(q.usd > 0)) return false;
      return side === "long" ? (q.ask ?? q.usd) <= limit : (q.bid ?? q.usd) >= limit;
    },
    open(coin, side, stake) {
      const q = tape.assets[coin];
      if (!q || !(q.usd > 0)) return { ok: false, reason: "rejected: no price" };
      if (!(stake > 0) || !(usdPerSat > 0)) return { ok: false, reason: "rejected: nothing to stake" };
      const wantUsd = stake * usdPerSat;
      if (q.vol24hUsd && wantUsd > q.vol24hUsd * MAX_VOLUME_SHARE) return { ok: false, reason: "rejected: not enough volume" };
      const { price, mid } = fillPrice(q, side === "long" ? 1 : -1, wantUsd, top.has(coin));
      const qty = floorTo(wantUsd / price, q.lotDecimals ?? DEFAULT_LOT_DECIMALS);
      const costUsd = qty * price;
      if (!(qty > 0) || (q.ordermin && qty < q.ordermin) || (q.costmin && costUsd < q.costmin)) {
        return { ok: false, reason: "rejected: below the exchange minimum" };
      }
      const filled = Math.min(stake, Math.round(costUsd / usdPerSat));
      return { ok: true, price, mid, stake: filled, qty, cost: Math.round(filled * Math.abs(price - mid) / mid) };
    },
    close(coin, side, stake) {
      const q = tape.assets[coin];
      if (!q || !(q.usd > 0)) return { price: 0, mid: 0, cost: 0 };
      const { price, mid } = fillPrice(q, side === "long" ? -1 : 1, stake * usdPerSat, top.has(coin));
      return { price, mid, cost: Math.round((stake * Math.abs(price - mid)) / mid) };
    },
  };
}

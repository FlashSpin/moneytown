import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCoinPrice,
  isTradableCoin,
  krakenGbpKey,
  parseGeckoMarkets,
  parseKrakenPairs,
  parseKrakenTicker,
  pickTopCoins,
} from "./market.ts";

const krakenPairs = {
  error: [],
  result: {
    XXBTZUSD: { altname: "XBTUSD", wsname: "XBT/USD", base: "XXBT", quote: "ZUSD", status: "online", ordermin: "0.00005", costmin: "0.5" },
    XXBTZGBP: { altname: "XBTGBP", wsname: "XBT/GBP", base: "XXBT", quote: "ZGBP", status: "online" },
    XETHZUSD: { altname: "ETHUSD", wsname: "ETH/USD", base: "XETH", quote: "ZUSD", status: "online" },
    XDGUSD: { altname: "XDGUSD", wsname: "XDG/USD", base: "XXDG", quote: "ZUSD", status: "online" },
    SOLUSD: { altname: "SOLUSD", wsname: "SOL/USD", base: "SOL", quote: "ZUSD", status: "online" },
    USDTZUSD: { altname: "USDTZUSD", wsname: "USDT/USD", base: "USDT", quote: "ZUSD", status: "online" },
    OLDUSD: { altname: "OLDUSD", wsname: "OLD/USD", base: "OLD", quote: "ZUSD", status: "delisted" },
  },
};

describe("Kraken market data", () => {
  it("maps each coin to its USD pair, with Kraken's XBT/XDG names translated", () => {
    const pairs = parseKrakenPairs(krakenPairs);
    assert.equal(pairs.get("BTC")!.key, "XXBTZUSD");
    assert.equal(pairs.get("BTC")!.ordermin, 0.00005);
    assert.equal(pairs.get("DOGE")!.key, "XDGUSD");
    assert.equal(pairs.get("SOL")!.key, "SOLUSD");
    assert.equal(pairs.has("OLD"), false, "not online");
    assert.equal(pairs.has("XBT"), false);
  });

  it("reads last price and 24h change from the ticker", () => {
    const t = parseKrakenTicker({ error: [], result: { XXBTZUSD: { c: ["102000.0", "0.1"], o: "100000.0" }, BAD: { c: ["0"] } } });
    assert.deepEqual(t.get("XXBTZUSD"), { usd: 102_000, change24h: 2 });
    assert.equal(t.has("BAD"), false);
  });

  it("finds Bitcoin's pound pair for showing purses in £", () => {
    assert.equal(krakenGbpKey(krakenPairs), "XXBTZGBP");
    assert.equal(krakenGbpKey({ result: {} }), null);
  });

  it("survives junk", () => {
    assert.equal(parseKrakenPairs(null).size, 0);
    assert.equal(parseKrakenTicker({ error: ["EQuery:Unknown asset pair"] }).size, 0);
    assert.deepEqual(parseGeckoMarkets({ status: "rate limited" }), []);
  });
});

describe("picking the parish's 20 coins", () => {
  const gecko = parseGeckoMarkets([
    { symbol: "btc", name: "Bitcoin", market_cap: 2e12, current_price: 100_000, price_change_percentage_24h: 1 },
    { symbol: "eth", name: "Ethereum", market_cap: 4e11, current_price: 3_500 },
    { symbol: "usdt", name: "Tether", market_cap: 1.6e11, current_price: 1 },
    { symbol: "bnb", name: "BNB", market_cap: 1e11, current_price: 900 },
    { symbol: "sol", name: "Solana", market_cap: 9e10, current_price: 180 },
    { symbol: "steth", name: "Lido Staked Ether", market_cap: 3e10, current_price: 3_490 },
    { symbol: "doge", name: "Dogecoin", market_cap: 2e10, current_price: 0.2 },
  ]);

  it("ranks by market cap, skipping stablecoins, staked tokens and coins Kraken doesn't list", () => {
    const top = pickTopCoins(gecko, parseKrakenPairs(krakenPairs), 20);
    assert.deepEqual(top, ["BTC", "ETH", "SOL", "DOGE"]); // no USDT, no stETH, no BNB (not on Kraken)
  });

  it("takes only the top n", () => {
    assert.deepEqual(pickTopCoins(gecko, parseKrakenPairs(krakenPairs), 2), ["BTC", "ETH"]);
  });

  it("falls back to the default list with no live ranking", () => {
    const top = pickTopCoins([], null, 20);
    assert.equal(top.length, 20);
    assert.equal(top[0], "BTC");
  });

  it("always keeps Bitcoin, which purses are held in", () => {
    const noBtc = parseGeckoMarkets([{ symbol: "eth", market_cap: 1, current_price: 3000 }]);
    assert.equal(pickTopCoins(noBtc, null, 5)[0], "BTC");
  });

  it("knows a stablecoin when it sees one", () => {
    assert.equal(isTradableCoin({ symbol: "USDX", usd: 1.001 }), false);
    assert.equal(isTradableCoin({ symbol: "XRP", usd: 1.01 }), true);
  });
});

describe("shop-sign prices", () => {
  it("is compact at every scale", () => {
    assert.equal(formatCoinPrice(101_234), "$101k");
    assert.equal(formatCoinPrice(98_431), "$98.4k");
    assert.equal(formatCoinPrice(3_512.4), "$3,512");
    assert.equal(formatCoinPrice(2.314), "$2.31");
    assert.equal(formatCoinPrice(0.08234), "$0.0823");
    assert.equal(formatCoinPrice(0.00001234), "$0.00001234");
    assert.equal(formatCoinPrice(0), "—");
  });
});

describe("trending coins", () => {
  it("reads CoinGecko's trending searches", async () => {
    const { parseGeckoTrending } = await import("./market.ts");
    const body = { coins: [{ item: { symbol: "pepe" } }, { item: { symbol: "SOL" } }, { item: { symbol: "pepe" } }, { item: {} }] };
    assert.deepEqual(parseGeckoTrending(body), ["PEPE", "SOL"]);
    assert.deepEqual(parseGeckoTrending(null), []);
  });
});

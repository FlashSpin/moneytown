import type { Tape } from "@/game/types";

type FearPayload = {
  data?: { value?: string; value_classification?: string }[];
};

function fngLabel(n: number): string {
  if (n <= 24) return "Extreme fear";
  if (n <= 44) return "Fear";
  if (n <= 55) return "Neutral";
  if (n <= 74) return "Greed";
  return "Extreme greed";
}

async function fetchJson(url: string, timeoutMs = 4500): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function binanceTape(): Promise<{ btcUsd: number; change24h: number; source: string } | null> {
  try {
    const raw = (await fetchJson("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT")) as {
      lastPrice?: string;
      priceChangePercent?: string;
    };
    const btcUsd = Number(raw.lastPrice);
    const change24h = Number(raw.priceChangePercent);
    if (!Number.isFinite(btcUsd) || btcUsd <= 0) return null;
    return {
      btcUsd,
      change24h: Number.isFinite(change24h) ? change24h : 0,
      source: "Binance",
    };
  } catch {
    return null;
  }
}

async function coinbaseSpot(): Promise<number | null> {
  try {
    const raw = (await fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot")) as {
      data?: { amount?: string };
    };
    const n = Number(raw.data?.amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function coinbaseChange(): Promise<number | null> {
  try {
    const raw = (await fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/stats")) as {
      last?: string;
      open?: string;
    };
    const last = Number(raw.last);
    const open = Number(raw.open);
    if (!Number.isFinite(last) || !Number.isFinite(open) || open <= 0) return null;
    return ((last - open) / open) * 100;
  } catch {
    return null;
  }
}

async function coinbaseGbp(): Promise<number | null> {
  try {
    const raw = (await fetchJson("https://api.coinbase.com/v2/prices/BTC-GBP/spot")) as {
      data?: { amount?: string };
    };
    const n = Number(raw.data?.amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function geckoTape(): Promise<{ btcUsd: number; btcGbp: number; change24h: number } | null> {
  try {
    const raw = (await fetchJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,gbp&include_24hr_change=true",
    )) as { bitcoin?: { usd?: number; gbp?: number; usd_24h_change?: number } };
    const btcUsd = Number(raw.bitcoin?.usd);
    const btcGbp = Number(raw.bitcoin?.gbp);
    const change24h = Number(raw.bitcoin?.usd_24h_change);
    if (!Number.isFinite(btcUsd) || btcUsd <= 0) return null;
    return {
      btcUsd,
      btcGbp: Number.isFinite(btcGbp) && btcGbp > 0 ? btcGbp : 0,
      change24h: Number.isFinite(change24h) ? change24h : 0,
    };
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

export async function loadTape(): Promise<Tape> {
  const [coinbase, cbChange, cbGbp, gecko, binance, fng] = await Promise.all([
    coinbaseSpot(),
    coinbaseChange(),
    coinbaseGbp(),
    geckoTape(),
    binanceTape(),
    fearGreed(),
  ]);

  let btcUsd = 0;
  let btcGbp = 0;
  let change24h = 0;
  let source = "dark";

  if (coinbase) {
    btcUsd = coinbase;
    source = "Coinbase";
    change24h = gecko?.change24h ?? cbChange ?? binance?.change24h ?? 0;
  } else if (gecko) {
    btcUsd = gecko.btcUsd;
    change24h = gecko.change24h;
    source = "CoinGecko";
  } else if (binance) {
    btcUsd = binance.btcUsd;
    change24h = binance.change24h;
    source = binance.source;
  }

  btcGbp = cbGbp || gecko?.btcGbp || (btcUsd > 0 ? btcUsd / 1.33 : 0);

  const dark = !(btcUsd > 0);
  const fg = fng?.value ?? 50;

  return {
    btcUsd: dark ? 100_000 : btcUsd,
    btcGbp: dark ? 74_000 : btcGbp || btcUsd / 1.33,
    change24h: dark ? 0 : change24h,
    fearGreed: fg,
    fearGreedLabel: fng?.label ?? fngLabel(fg),
    dark,
    source: dark ? "dark" : source,
    fetchedAt: Date.now(),
  };
}

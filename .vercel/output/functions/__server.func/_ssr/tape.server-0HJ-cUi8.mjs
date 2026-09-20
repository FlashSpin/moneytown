//#region node_modules/.nitro/vite/services/ssr/assets/tape.server-0HJ-cUi8.js
function fngLabel(n) {
	if (n <= 24) return "Extreme fear";
	if (n <= 44) return "Fear";
	if (n <= 55) return "Neutral";
	if (n <= 74) return "Greed";
	return "Extreme greed";
}
async function fetchJson(url, timeoutMs = 4500) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: { accept: "application/json" }
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(t);
	}
}
async function binanceTape() {
	try {
		const raw = await fetchJson("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
		const btcUsd = Number(raw.lastPrice);
		const change24h = Number(raw.priceChangePercent);
		if (!Number.isFinite(btcUsd) || btcUsd <= 0) return null;
		return {
			btcUsd,
			change24h: Number.isFinite(change24h) ? change24h : 0,
			source: "Binance"
		};
	} catch {
		return null;
	}
}
async function coinbaseSpot() {
	try {
		const raw = await fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot");
		const n = Number(raw.data?.amount);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}
async function coinbaseChange() {
	try {
		const raw = await fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/stats");
		const last = Number(raw.last);
		const open = Number(raw.open);
		if (!Number.isFinite(last) || !Number.isFinite(open) || open <= 0) return null;
		return (last - open) / open * 100;
	} catch {
		return null;
	}
}
async function coinbaseGbp() {
	try {
		const raw = await fetchJson("https://api.coinbase.com/v2/prices/BTC-GBP/spot");
		const n = Number(raw.data?.amount);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}
async function geckoTape() {
	try {
		const raw = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,gbp&include_24hr_change=true");
		const btcUsd = Number(raw.bitcoin?.usd);
		const btcGbp = Number(raw.bitcoin?.gbp);
		const change24h = Number(raw.bitcoin?.usd_24h_change);
		if (!Number.isFinite(btcUsd) || btcUsd <= 0) return null;
		return {
			btcUsd,
			btcGbp: Number.isFinite(btcGbp) && btcGbp > 0 ? btcGbp : 0,
			change24h: Number.isFinite(change24h) ? change24h : 0
		};
	} catch {
		return null;
	}
}
async function fearGreed() {
	try {
		const row = (await fetchJson("https://api.alternative.me/fng/?limit=1")).data?.[0];
		const value = Number(row?.value);
		if (!Number.isFinite(value)) return null;
		return {
			value,
			label: row?.value_classification ?? fngLabel(value)
		};
	} catch {
		return null;
	}
}
async function loadTape() {
	const [coinbase, cbChange, cbGbp, gecko, binance, fng] = await Promise.all([
		coinbaseSpot(),
		coinbaseChange(),
		coinbaseGbp(),
		geckoTape(),
		binanceTape(),
		fearGreed()
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
		btcUsd: dark ? 1e5 : btcUsd,
		btcGbp: dark ? 74e3 : btcGbp || btcUsd / 1.33,
		change24h: dark ? 0 : change24h,
		fearGreed: fg,
		fearGreedLabel: fng?.label ?? fngLabel(fg),
		dark,
		source: dark ? "dark" : source,
		fetchedAt: Date.now()
	};
}
//#endregion
export { loadTape };

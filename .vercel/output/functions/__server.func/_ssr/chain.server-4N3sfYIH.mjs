//#region node_modules/.nitro/vite/services/ssr/assets/chain.server-4N3sfYIH.js
function validAddress(raw) {
	const a = raw.trim();
	if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,74}$/.test(a)) return null;
	return a;
}
function satsFrom(raw) {
	const chainFunded = Number(raw.chain_stats?.funded_txo_sum ?? 0);
	const chainSpent = Number(raw.chain_stats?.spent_txo_sum ?? 0);
	const memFunded = Number(raw.mempool_stats?.funded_txo_sum ?? 0);
	const memSpent = Number(raw.mempool_stats?.spent_txo_sum ?? 0);
	if (![
		chainFunded,
		chainSpent,
		memFunded,
		memSpent
	].every(Number.isFinite)) return null;
	return Math.max(0, chainFunded - chainSpent + memFunded - memSpent);
}
async function fetchJson(url) {
	const res = await fetch(url, {
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(5e3)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}
async function loadChainBalance(address) {
	const addr = validAddress(address);
	if (!addr) return {
		ok: false,
		error: "That is not a Bitcoin address."
	};
	const encoded = encodeURIComponent(addr);
	try {
		const sats = satsFrom(await fetchJson(`https://mempool.space/api/address/${encoded}`));
		if (sats == null) throw new Error("bad payload");
		return {
			ok: true,
			sats,
			source: "mempool.space"
		};
	} catch {
		try {
			const sats = satsFrom(await fetchJson(`https://blockstream.info/api/address/${encoded}`));
			if (sats == null) return {
				ok: false,
				error: "The chain did not answer."
			};
			return {
				ok: true,
				sats,
				source: "blockstream.info"
			};
		} catch {
			return {
				ok: false,
				error: "The chain did not answer."
			};
		}
	}
}
//#endregion
export { loadChainBalance };

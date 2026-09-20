import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/chain-BYNY_ko6.js
var fetchChainBalance_createServerFn_handler = createServerRpc({
	id: "a331e34b76dcee0e3eca78c1969b27e9be9a9cbddb14f82921c74a08169a8b53",
	name: "fetchChainBalance",
	filename: "src/lib/chain.ts"
}, (opts) => fetchChainBalance.__executeServer(opts));
var fetchChainBalance = createServerFn({ method: "POST" }).validator((input) => input).handler(fetchChainBalance_createServerFn_handler, async ({ data }) => {
	const { loadChainBalance } = await import("./chain.server-4N3sfYIH.mjs");
	return loadChainBalance(data.address);
});
//#endregion
export { fetchChainBalance_createServerFn_handler };

import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/tape-B1pkn6F7.js
var fetchTape_createServerFn_handler = createServerRpc({
	id: "3cedff8769b43d7e6838f374b6d52e6410d6f51fe8e1f57afe506aaa1694eb28",
	name: "fetchTape",
	filename: "src/lib/tape.ts"
}, (opts) => fetchTape.__executeServer(opts));
var fetchTape = createServerFn({ method: "POST" }).handler(fetchTape_createServerFn_handler, async () => {
	const { loadTape } = await import("./tape.server-0HJ-cUi8.mjs");
	return loadTape();
});
//#endregion
export { fetchTape_createServerFn_handler };

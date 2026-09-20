import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/counsel-MTVlhExo.js
var askCounsel_createServerFn_handler = createServerRpc({
	id: "ef53e6188f67bbae2eeca620676d13792f19f46855bfc6121e5e7494985c7cf5",
	name: "askCounsel",
	filename: "src/lib/counsel.ts"
}, (opts) => askCounsel.__executeServer(opts));
var askCounsel = createServerFn({ method: "POST" }).validator((input) => input).handler(askCounsel_createServerFn_handler, async ({ data }) => {
	const { askGrokCounsel } = await import("./counsel.server-Dq-alqgL.mjs");
	return askGrokCounsel(data.prompt, data.prefer ?? "any");
});
//#endregion
export { askCounsel_createServerFn_handler };

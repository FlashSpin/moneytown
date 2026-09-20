//#region node_modules/.nitro/vite/services/ssr/assets/counsel.server-Dq-alqgL.js
async function askGrokCounsel(prompt, prefer = "any") {
	if (prefer === "pollinations") {
		const poll = await tryPollinations(prompt);
		if (poll) return {
			ok: true,
			text: poll,
			source: "pollinations"
		};
		return {
			ok: false,
			error: "Free online wits did not answer"
		};
	}
	if (prefer === "grok") {
		const grok = await tryGrok(prompt);
		if (grok) return {
			ok: true,
			text: grok,
			source: "grok"
		};
		return {
			ok: false,
			error: "Grok did not answer"
		};
	}
	const grok = await tryGrok(prompt);
	if (grok) return {
		ok: true,
		text: grok,
		source: "grok"
	};
	const poll = await tryPollinations(prompt);
	if (poll) return {
		ok: true,
		text: poll,
		source: "pollinations"
	};
	return {
		ok: false,
		error: "AI is not available"
	};
}
async function tryGrok(prompt) {
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return null;
	try {
		const res = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: "grok-4.5",
				temperature: .75,
				max_tokens: 900,
				response_format: { type: "json_object" },
				messages: [{
					role: "system",
					content: "You are the wits of a 16th-century English market town. Reply with JSON only. No markdown. No jobs. No keys."
				}, {
					role: "user",
					content: prompt
				}]
			}),
			signal: AbortSignal.timeout(14e3)
		});
		if (!res.ok) return null;
		const text = (await res.json()).choices?.[0]?.message?.content ?? "";
		return text.trim() ? text : null;
	} catch {
		return null;
	}
}
async function tryPollinations(prompt) {
	try {
		const res = await fetch("https://text.pollinations.ai/openai", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai",
				max_tokens: 800,
				response_format: { type: "json_object" },
				messages: [{
					role: "system",
					content: "JSON only. 16th-century English market town wits. No jobs. No keys."
				}, {
					role: "user",
					content: prompt
				}]
			}),
			signal: AbortSignal.timeout(12e3)
		});
		if (!res.ok) return null;
		const text = (await res.json()).choices?.[0]?.message?.content ?? "";
		return text.trim() ? text : null;
	} catch {
		return null;
	}
}
//#endregion
export { askGrokCounsel };

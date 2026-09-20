import { createServerFn } from "@tanstack/react-start";

export type CounselPrefer = "grok" | "pollinations" | "any";

export const askCounsel = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; prefer?: CounselPrefer }) => input)
  .handler(async ({ data }) => {
    const { askGrokCounsel } = await import("./counsel.server");
    return askGrokCounsel(data.prompt, data.prefer ?? "any");
  });

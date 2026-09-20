import { createServerFn } from "@tanstack/react-start";

import { parseCounselInput, type CounselPrefer } from "./counsel-input";

export type { CounselPrefer };

export const askCounsel = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseCounselInput(input))
  .handler(async ({ data }) => {
    const { askGrokCounselLimited } = await import("./counsel.server");
    return askGrokCounselLimited(data.prompt, data.prefer);
  });

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceSeason, checkMilestones, parishWealth, SEASON_DAYS } from "./progress.ts";
import { rankChange, rankOf } from "./ranks.ts";
import type { GameState, Subject } from "./types.ts";

const merchant = (days: number, worth: number, benchAtStart = 100) => ({ balance: 0, worth, track: { start: 1000, startDay: "2026-01-02", bench: benchAtStart, days } });

describe("ranks", () => {
  it("are earned against the 60/40 over enough days, and lost when results turn", () => {
    assert.equal(rankOf({ balance: 1000 }, 100), "apprentice", "no track yet");
    assert.equal(rankOf(merchant(10, 1200), 100), "apprentice", "too few days");
    assert.equal(rankOf(merchant(30, 1000), 110), "journeyman", "not losing, though behind the 60/40");
    assert.equal(rankOf(merchant(30, 990), 100), "apprentice", "losing money");
    assert.equal(rankOf(merchant(70, 1120), 110), "merchant", "ahead of the 60/40");
    assert.equal(rankOf(merchant(130, 1150), 110), "master", "5 points ahead");
    assert.equal(rankOf(merchant(130, 1110), 110), "merchant", "a master must be 2 points ahead");
    assert.equal(rankChange("apprentice", "merchant"), 1);
    assert.equal(rankChange("master", "merchant"), -1);
  });
});

describe("seasons", () => {
  it("open, run their days, and are won only by beating the 60/40", () => {
    const first = advanceSeason(undefined, { day: 1, at: 1, wealth: 100_000, bench: 100, hangedToday: 0 });
    assert.equal(first.season.n, 1);
    const mid = advanceSeason(first.season, { day: 5, at: 5, wealth: 90_000, bench: 100, hangedToday: 1 });
    assert.equal(mid.result, undefined);
    assert.equal(mid.season.hanged, 1);
    const won = advanceSeason(mid.season, { day: 1 + SEASON_DAYS, at: 9, wealth: 106_000, bench: 104, hangedToday: 0 });
    assert.equal(won.result?.won, true, "+6% against the 60/40's +4%");
    assert.equal(won.season.n, 2);
    const lost = advanceSeason(won.season, { day: 1 + 2 * SEASON_DAYS, at: 12, wealth: 108_000, bench: 110, hangedToday: 0 });
    assert.equal(lost.result?.won, false, "made money, but less than the 60/40");
  });

  it("counts every merchant's worth at the latest close", () => {
    const w = parishWealth({ king: { balance: 500 } as never, subjects: [{ balance: 10, worth: 900, state: "idle" } as Subject, { balance: 5, state: "condemned" } as Subject] });
    assert.equal(w, 1400);
  });
});

describe("milestones", () => {
  it("are recorded once, with when", () => {
    const s = { day: 3, king: { balance: 0 }, subjects: [], trades: [{ t: 1 }], seasons: [] } as unknown as GameState;
    const a = checkMilestones(s, 100);
    assert.ok(a.milestones["first-order"]);
    const b = checkMilestones({ ...s, milestones: a.milestones }, 200);
    assert.deepEqual(b.notes, []);
    assert.equal(b.milestones["first-order"]?.at, 100);
  });
});

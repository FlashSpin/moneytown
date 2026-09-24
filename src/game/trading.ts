/**
 * The villagers' temperaments — pure. Each villager is born with one; it
 * decides the strategy it starts with (./guild.ts TEMPER_PRESET) and how it
 * speaks at the councils.
 */

// ── Temperaments: each villager invests in its own way ──────────────────────

export type Temper = "trend" | "contrarian" | "cautious" | "bold" | "steady";
export const TEMPERS: Temper[] = ["trend", "contrarian", "cautious", "bold", "steady"];

export const TEMPER_DESCRIPTIONS: Record<Temper, string> = {
  trend: "a trend-follower who holds what is rising and steps aside from what is falling",
  contrarian: "a contrarian who spreads the money so no single storm can sink it",
  cautious: "a cautious investor who wants steady growth and small falls",
  bold: "a bold investor who chases the strongest markets",
  steady: "a steady investor who spreads the money wide and rarely changes course",
};

/** A stable temperament for villagers born before temperaments existed. */
export function temperOf(id: string): Temper {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEMPERS[h % TEMPERS.length]!;
}

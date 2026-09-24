/**
 * The market: one stall per fund, laid out in the part of the map every
 * screen shows (the town view crops the far left and right). Slot 0 is the
 * most prominent — beside the castle — and holds the first fund.
 */

export const SHOP_SLOTS: { x: number; y: number }[] = [
  // Upper plaza row, flanking the castle (ranks 1-6).
  { x: 700, y: 400 },
  { x: 1100, y: 400 },
  { x: 590, y: 400 },
  { x: 1210, y: 400 },
  { x: 480, y: 400 },
  { x: 1320, y: 400 },
  // Lower plaza row, around the well (ranks 7-11).
  { x: 590, y: 650 },
  { x: 1210, y: 650 },
  { x: 480, y: 650 },
  { x: 1320, y: 650 },
  { x: 900, y: 700 },
  // The three stone yards along the bottom (ranks 12-20).
  { x: 570, y: 900 },
  { x: 645, y: 900 },
  { x: 720, y: 900 },
  { x: 835, y: 900 },
  { x: 905, y: 900 },
  { x: 975, y: 900 },
  { x: 1090, y: 900 },
  { x: 1160, y: 900 },
  { x: 1230, y: 900 },
];

/** Awning colours, one per stall, in the town's muted palette. */
export const AWNINGS = [
  "#8b2c2c", "#3f5c3a", "#6b4226", "#2f4a6b", "#7a5a1e", "#5a3a6b", "#8b5a2c", "#2c6b63", "#6b2c4a", "#4a6b2c",
  "#8b2c2c", "#3f5c3a", "#6b4226", "#2f4a6b", "#7a5a1e", "#5a3a6b", "#8b5a2c", "#2c6b63", "#6b2c4a", "#4a6b2c",
];

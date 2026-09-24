import { MAP_H, MAP_W, POI } from "./constants.ts";

export type PropDef = {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Blocker = { x: number; y: number; w: number; h: number };

export type Cam = {
  cx: number;
  cy: number;
  zoom: number;
  shakeX: number;
  shakeY: number;
};

/** Noose hangs from the left of the beam on the gallows sprite. */
export const GALLOWS_BEAM = { x: 1572, y: 342 };
export const GALLOWS_DROP = { x: 1572, y: 512 };
export const GALLOWS_WATCH = { x: 1478, y: 538 };

export const TOWN_PROPS: PropDef[] = [
  { id: "castle", src: "/assets/props/castle.png", x: 900, y: 248, w: 250, h: 268 },
  { id: "house", src: "/assets/props/house.png", x: 250, y: 236, w: 168, h: 220 },
  { id: "cottage", src: "/assets/props/cottage.png", x: 1510, y: 870, w: 170, h: 192 },
  { id: "gallows", src: "/assets/props/gallows.png", x: 1595, y: 500, w: 132, h: 190 },
];

export const BLOCKERS: Blocker[] = [
  { x: 790, y: 150, w: 220, h: 92 },
  { x: 175, y: 145, w: 145, h: 80 },
  { x: 1435, y: 790, w: 150, h: 70 },
  { x: 1535, y: 430, w: 120, h: 55 },
  { x: 410, y: 515, w: 90, h: 48 },
];

const MARGIN = 36;

export function blocked(x: number, y: number): boolean {
  if (x < MARGIN || y < MARGIN || x > MAP_W - MARGIN || y > MAP_H - MARGIN) return true;
  for (const b of BLOCKERS) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

export function moveToward(
  x: number,
  y: number,
  destX: number,
  destY: number,
  dist: number,
  ignoreBlockers = false,
): { x: number; y: number; arrived: boolean } {
  const dx = destX - x;
  const dy = destY - y;
  const len = Math.hypot(dx, dy);
  if (len <= dist || len < 1.2) return { x: destX, y: destY, arrived: true };
  const nx = x + (dx / len) * dist;
  const ny = y + (dy / len) * dist;
  if (ignoreBlockers || !blocked(nx, ny)) return { x: nx, y: ny, arrived: false };
  if (!blocked(nx, y)) return { x: nx, y, arrived: false };
  if (!blocked(x, ny)) return { x: x, y: ny, arrived: false };
  return { x, y, arrived: false };
}

export function wanderPoint(rng: () => number): { x: number; y: number } {
  const spots = [
    POI.square,
    POI.well,
    POI.cottage,
    { x: 700, y: 520 },
    { x: 1100, y: 540 },
    { x: 980, y: 780 },
    { x: 800, y: 780 },
    { x: 1050, y: 720 },
  ];
  const s = spots[Math.floor(rng() * spots.length)] ?? POI.square;
  return {
    x: s.x + (rng() - 0.5) * 90,
    y: s.y + (rng() - 0.5) * 60,
  };
}

export function facing(dx: number, dy: number): "down" | "left" | "right" | "up" {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

export function viewTransform(
  viewW: number,
  viewH: number,
  cam: Cam,
): { scale: number; ox: number; oy: number } {
  const fit = Math.max(viewW / MAP_W, viewH / MAP_H);
  const scale = fit * cam.zoom;
  const ox = Math.round(viewW / 2 - cam.cx * scale + cam.shakeX);
  const oy = Math.round(viewH / 2 - cam.cy * scale + cam.shakeY);
  return { scale, ox, oy };
}

export const DEFAULT_CAM: Cam = {
  cx: MAP_W / 2,
  cy: MAP_H / 2,
  zoom: 1,
  shakeX: 0,
  shakeY: 0,
};

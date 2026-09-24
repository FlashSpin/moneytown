import { KING_DRAW, MAP_H, MAP_W, SUBJECT_DRAW } from "./constants";
import { formatFundPrice } from "@/lib/market";
import { FUND_IDS } from "./merchant";
import { AWNINGS, SHOP_SLOTS } from "./shops";
import {
  DEFAULT_CAM,
  GALLOWS_BEAM,
  GALLOWS_DROP,
  TOWN_PROPS,
  viewTransform,
  type Cam,
  type PropDef,
} from "./town";
import type { Board, King, SpeechLine, Subject } from "./types";
import { money } from "./wallets";


export type Assets = {
  map: HTMLImageElement;
  king: HTMLImageElement;
  man: HTMLImageElement;
  woman: HTMLImageElement;
  props: Record<string, HTMLImageElement>;
};

const DIR_ROW = { down: 0, left: 1, right: 2, up: 3 } as const;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(): Promise<Assets> {
  const [map, king, man, woman, ...propImgs] = await Promise.all([
    loadImage("/assets/map/town-base.jpg"),
    loadImage("/assets/sprites/king.png"),
    loadImage("/assets/sprites/man.png"),
    loadImage("/assets/sprites/woman.png"),
    ...TOWN_PROPS.map((p) => loadImage(p.src)),
  ]);
  const props: Record<string, HTMLImageElement> = {};
  TOWN_PROPS.forEach((p, i) => {
    const im = propImgs[i];
    if (im) props[p.id] = im;
  });
  return { map, king, man, woman, props };
}

function sheetFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dir: keyof typeof DIR_ROW,
  frame: number,
  x: number,
  y: number,
  size: number,
  alpha = 1,
  rotation = 0,
  squashY = 1,
) {
  const fw = img.width / 4;
  const fh = img.height / 4;
  const col = frame % 4;
  const row = DIR_ROW[dir];
  const sy = squashY;
  const sx = 1 / Math.max(0.55, sy);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y - size * 0.45);
  ctx.rotate(rotation);
  ctx.scale(sx, sy);
  ctx.drawImage(img, col * fw, row * fh, fw, fh, -size / 2, -size * 0.55, size, size);
  ctx.restore();
}

function drawRope(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#3a2818";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.strokeStyle = "#6b4a2c";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(fromX + 1.2, fromY);
  ctx.lineTo(toX + 1.2, toY);
  ctx.stroke();
  ctx.strokeStyle = "#4a3422";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(toX, toY + 7, 7, 9, 0.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(toX, toY + 5, 5.5, 4.2, -0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawDust(ctx: CanvasRenderingContext2D, t: number, alpha: number) {
  if (t < 0.12 || t > 1.35) return;
  const life = Math.min(1, (t - 0.12) / 0.9);
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const dist = 10 + life * (18 + (i % 3) * 8);
    const x = GALLOWS_DROP.x + Math.cos(a) * dist;
    const y = GALLOWS_DROP.y + 6 + Math.sin(a) * dist * 0.35;
    ctx.globalAlpha = alpha * (1 - life) * 0.45;
    ctx.fillStyle = "#c4b08a";
    ctx.beginPath();
    ctx.arc(x, y, 2.4 - life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHanging(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sub: Subject,
) {
  const t = sub.hangT;
  const dropDur = 0.42;
  const drop = t < dropDur ? (t / dropDur) * (t / dropDur) : 1;
  const restLen = 108;
  const swingAmp = 34 * Math.exp(-Math.max(0, t - dropDur) * 0.42) * drop;
  const omega = 5.2;
  const phase = t * omega;
  const swing = Math.sin(phase) * swingAmp;
  const rot = Math.sin(phase) * 0.38 * drop + 0.08;
  const fade = t > 5.1 ? Math.max(0, 1 - (t - 5.1) / 1.1) : 1;
  const stretch = t < dropDur ? 1.18 : 1.02 + Math.sin(phase) * 0.04;

  const beamX = GALLOWS_BEAM.x;
  const beamY = GALLOWS_BEAM.y;
  const hx = beamX + swing;
  const hy = beamY + 22 + drop * restLen;

  drawRope(ctx, beamX, beamY, hx, hy - 10, fade);
  drawDust(ctx, t, fade);
  sheetFrame(ctx, img, "down", 0, hx, hy, SUBJECT_DRAW, fade, rot, stretch);
}

function drawProp(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p: PropDef) {
  ctx.drawImage(img, p.x - p.w / 2, p.y - p.h * 0.85, p.w, p.h);
}

function worldToScreen(x: number, y: number, scale: number, ox: number, oy: number) {
  return { x: ox + x * scale, y: oy + y * scale };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function drawHeadCard(
  ctx: CanvasRenderingContext2D,
  sx: number,
  headY: number,
  title: string,
  money: string,
  selected: boolean,
) {
  ctx.save();
  ctx.font = '600 11px "Source Serif 4", "Palatino Linotype", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const titleW = ctx.measureText(title).width;
  ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
  const moneyW = ctx.measureText(money).width;
  const w = Math.max(titleW, moneyW) + 16;
  const h = 32;
  const x = sx - w / 2;
  const y = headY - h - 6;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = selected ? "rgba(255, 248, 228, 0.94)" : "rgba(244, 232, 200, 0.9)";
  ctx.fill();
  ctx.strokeStyle = selected ? "rgba(107, 66, 38, 0.7)" : "rgba(74, 61, 42, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = '600 11px "Source Serif 4", "Palatino Linotype", serif';
  ctx.fillStyle = "#2c2416";
  ctx.fillText(title, sx, y + 3);
  ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = "#6b4226";
  ctx.fillText(money, sx, y + 16);
  ctx.restore();
  return y;
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  topY: number,
  text: string,
  shout: boolean,
) {
  ctx.save();
  ctx.font = shout
    ? '600 12px "Cinzel", "Times New Roman", serif'
    : '500 11px "Source Serif 4", "Palatino Linotype", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const maxW = shout ? 180 : 150;
  const lines = wrapText(ctx, text, maxW);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.min(maxW, textW) + 16;
  const h = lines.length * 14 + 10;
  const x = sx - w / 2;
  const y = topY - h - 8;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = shout ? "rgba(139, 44, 44, 0.92)" : "rgba(255, 252, 242, 0.95)";
  ctx.fill();
  ctx.strokeStyle = shout ? "rgba(244, 232, 200, 0.8)" : "rgba(107, 66, 38, 0.45)";
  ctx.lineWidth = shout ? 1.6 : 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx - 6, y + h);
  ctx.lineTo(sx, y + h + 7);
  ctx.lineTo(sx + 6, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shout ? "#f4e8c8" : "#2c2416";
  lines.forEach((line, i) => ctx.fillText(line, sx, y + 5 + i * 14));
  ctx.restore();
}

/** A market stall in world space: counter, posts, a striped awning, and the fund's badge. */
function drawStall(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, fund: string) {
  ctx.save();
  // Shadow
  ctx.fillStyle = "rgba(20, 14, 8, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 38, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // Posts
  ctx.fillStyle = "#4a2f1a";
  ctx.fillRect(x - 31, y - 44, 4, 46);
  ctx.fillRect(x + 27, y - 44, 4, 46);
  // Counter
  ctx.fillStyle = "#7a4e2d";
  ctx.fillRect(x - 34, y - 16, 68, 20);
  ctx.fillStyle = "#5c3a21";
  ctx.fillRect(x - 34, y - 2, 68, 6);
  ctx.fillStyle = "#9a6a42";
  ctx.fillRect(x - 36, y - 19, 72, 4);
  // Awning: alternating stripes of the stall's colour and cream, with a scalloped edge.
  const top = y - 58;
  const bottom = y - 38;
  for (let i = 0; i < 6; i++) {
    const x0 = x - 38 + i * (76 / 6);
    ctx.fillStyle = i % 2 === 0 ? color : "#efe0bd";
    ctx.beginPath();
    ctx.moveTo(x0 + 3, top);
    ctx.lineTo(x0 + 76 / 6 + 3, top);
    ctx.lineTo(x0 + 76 / 6, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x0 + 76 / 12, bottom, 76 / 12, 0, Math.PI);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(44, 36, 22, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x - 38, top, 76, bottom - top);
  // Fund badge on the counter
  ctx.beginPath();
  ctx.arc(x, y - 7, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#d9b24a";
  ctx.fill();
  ctx.strokeStyle = "#8a6a1e";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#3a2a0e";
  ctx.font = `700 ${fund.length > 3 ? 6 : 7}px "IBM Plex Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fund.slice(0, 5), x, y - 6.5);
  ctx.restore();
}

/** Price signs above every stall, in screen space so they stay legible at any zoom. */
function drawShopSigns(
  ctx: CanvasRenderingContext2D,
  scale: number,
  ox: number,
  oy: number,
  board: Board | undefined,
) {
  const funds = FUND_IDS.slice(0, SHOP_SLOTS.length);
  const dark = !board;
  const compact = scale < 0.6;
  funds.forEach((fund, i) => {
    const slot = SHOP_SLOTS[i]!;
    const info = board?.funds[fund];
    const scr = worldToScreen(slot.x, slot.y - 60, scale, ox, oy);
    const price = dark || !info ? "—" : formatFundPrice(info.close);
    const chg = (info?.change1d ?? 0) * 100;
    const arrow = chg >= 0 ? "▲" : "▼";
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (compact) {
      // Small screens: a narrow two-line badge, neighbours staggered so none overlap.
      const levels = i >= 11 ? 3 : 2;
      const lift = ((i >= 11 ? i - 11 : i) % levels) * 22;
      ctx.font = '700 8px "IBM Plex Mono", monospace';
      const w = Math.max(ctx.measureText(fund).width, ctx.measureText(price).width) + 6;
      const h = 20;
      const y = scr.y - h / 2 - 2 - lift;
      roundRect(ctx, scr.x - w / 2, y - h / 2, w, h, 4);
      ctx.fillStyle = AWNINGS[i] ?? "#4a3d2a";
      ctx.globalAlpha = 0.94;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#f4e8c8";
      ctx.fillText(fund, scr.x, y - 4);
      ctx.fillStyle = dark ? "#f4e8c8" : chg >= 0 ? "#c9ecb4" : "#ffc2b8";
      ctx.fillText(price, scr.x, y + 5);
    } else {
      const line2 = dark ? price : `${price} ${arrow}${Math.abs(chg).toFixed(1)}%`;
      ctx.font = '700 10px "IBM Plex Mono", monospace';
      const w = Math.max(ctx.measureText(line2).width, ctx.measureText(fund).width) + 12;
      const h = 28;
      // The bottom yards pack stalls closer: alternate their signs' heights.
      const lift = i >= 11 && (i - 11) % 2 === 1 ? 32 : 0;
      const y = scr.y - h / 2 - 4 - lift;
      roundRect(ctx, scr.x - w / 2, y - h / 2, w, h, 6);
      ctx.fillStyle = AWNINGS[i] ?? "#4a3d2a";
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(244, 232, 200, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#f4e8c8";
      ctx.font = '700 10px "Cinzel", "Times New Roman", serif';
      ctx.fillText(fund, scr.x, y - 6);
      ctx.font = '600 9.5px "IBM Plex Mono", monospace';
      ctx.fillStyle = dark ? "#f4e8c8" : chg >= 0 ? "#c9ecb4" : "#ffc2b8";
      ctx.fillText(line2, scr.x, y + 7);
    }
    ctx.restore();
  });
}

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  opts: {
    king: King;
    subjects: Subject[];
    selectedId: string | null;
    board?: Board;
    speech: SpeechLine[];
  },
  scale: number,
  ox: number,
  oy: number,
) {
  const tops = new Map<string, number>();

  const kingScr = worldToScreen(opts.king.x, opts.king.y, scale, ox, oy);
  const kingHead = kingScr.y - KING_DRAW * scale * 0.92;
  const kingTop = drawHeadCard(
    ctx,
    kingScr.x,
    kingHead,
    "His Majesty",
    money(opts.king.balance),
    opts.selectedId === "king",
  );
  tops.set("king", kingTop);

  for (const sub of opts.subjects) {
    if (sub.state === "hanging") continue;
    const scr = worldToScreen(sub.x, sub.y, scale, ox, oy);
    const head = scr.y - SUBJECT_DRAW * scale * 0.92;
    const top = drawHeadCard(
      ctx,
      scr.x,
      head,
      sub.firstName,
      money(sub.worth ?? sub.balance),
      opts.selectedId === sub.id,
    );
    tops.set(sub.id, top);
  }

  for (const line of opts.speech) {
    if (line.age < 0 || line.age > line.life) continue;
    const who =
      line.fromId === "king" ? opts.king : opts.subjects.find((x) => x.id === line.fromId);
    if (!who) continue;
    if ("state" in who && who.state === "hanging") continue;
    const fade =
      line.age < 0.2 ? line.age / 0.2 : line.age > line.life - 0.4 ? (line.life - line.age) / 0.4 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    const top = tops.get(line.fromId) ?? 80;
    const scr = worldToScreen(who.x, who.y, scale, ox, oy);
    drawBubble(ctx, scr.x, top, line.text, line.shout);
    ctx.restore();
  }
}

export function hitTest(
  subjects: Subject[],
  king: King,
  wx: number,
  wy: number,
): string | null {
  const hits: { id: string; d: number }[] = [];
  for (const s of subjects) {
    if (s.state === "hanging") continue;
    const d = Math.hypot(s.x - wx, s.y - SUBJECT_DRAW * 0.5 - wy);
    if (d < 28) hits.push({ id: s.id, d });
  }
  const kd = Math.hypot(king.x - wx, king.y - KING_DRAW * 0.5 - wy);
  if (kd < 32) hits.push({ id: "king", d: kd });
  hits.sort((a, b) => a.d - b.d);
  return hits[0]?.id ?? null;
}

export function drawTown(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  opts: {
    king: King;
    subjects: Subject[];
    selectedId: string | null;
    /** The funds at the latest close, for the stall signs (one stall per fund). */
    board?: Board;
    speech: SpeechLine[];
    cam?: Cam;
    viewW: number;
    viewH: number;
  },
): { scale: number; ox: number; oy: number } {
  const viewW = opts.viewW;
  const viewH = opts.viewH;
  const cam = opts.cam ?? DEFAULT_CAM;
  const { scale, ox, oy } = viewTransform(viewW, viewH, cam);

  ctx.fillStyle = "#1a1610";
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  ctx.drawImage(assets.map, 0, 0, MAP_W, MAP_H);

  const drawables: Array<{ y: number; draw: () => void }> = [];
  for (const p of TOWN_PROPS) {
    const img = assets.props[p.id];
    if (!img) continue;
    drawables.push({
      y: p.y,
      draw: () => drawProp(ctx, img, p),
    });
  }
  FUND_IDS.slice(0, SHOP_SLOTS.length)
    .forEach((fund, i) => {
      const slot = SHOP_SLOTS[i]!;
      drawables.push({ y: slot.y, draw: () => drawStall(ctx, slot.x, slot.y, AWNINGS[i] ?? "#6b4226", fund) });
    });
  drawables.push({
    y: opts.king.y,
    draw: () =>
      sheetFrame(ctx, assets.king, opts.king.dir, opts.king.frame, opts.king.x, opts.king.y, KING_DRAW),
  });
  for (const sub of opts.subjects) {
    const img = sub.body === "woman" ? assets.woman : assets.man;
    drawables.push({
      y: sub.state === "hanging" ? GALLOWS_BEAM.y + 40 : sub.y,
      draw: () => {
        if (sub.state === "hanging") drawHanging(ctx, img, sub);
        else sheetFrame(ctx, img, sub.dir, sub.frame, sub.x, sub.y, SUBJECT_DRAW);
      },
    });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  ctx.restore();

  if (cam.zoom > 1.2) {
    const g = ctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.45,
      viewH * 0.12,
      viewW * 0.5,
      viewH * 0.5,
      viewW * 0.72,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(12, 8, 6, 0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  drawShopSigns(ctx, scale, ox, oy, opts.board);
  drawOverlays(ctx, opts, scale, ox, oy);

  return { scale, ox, oy };
}

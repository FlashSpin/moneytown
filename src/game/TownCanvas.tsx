import { useEffect, useRef } from "react";
import { drawTown, hitTest, loadAssets, type Assets } from "./render";
import { useGame } from "./store";
import {
  DEFAULT_CAM,
  GALLOWS_BEAM,
  GALLOWS_DROP,
  viewTransform,
  type Cam,
} from "./town";

declare global {
  interface Window {
    __lfCam?: Cam & { focus: string };
  }
}

export function TownCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assetsRef = useRef<Assets | null>(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const camRef = useRef<Cam>({ ...DEFAULT_CAM });
  const traumaRef = useRef(0);
  const wasHangingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void loadAssets().then((a) => {
      if (alive) assetsRef.current = a;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = (now: number) => {
      const last = lastRef.current || now;
      const dt = Math.min((now - last) / 1000, 0.1);
      lastRef.current = now;
      useGame.getState().tick(dt);

      const ctx = canvas.getContext("2d");
      const assets = assetsRef.current;
      if (ctx && assets) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const viewW = w / dpr;
        const viewH = h / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const s = useGame.getState();
        const hanging = s.subjects.find((x) => x.state === "hanging");
        const condemned = s.subjects.find((x) => x.state === "condemned");
        const reduce =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        if (hanging && !wasHangingRef.current) traumaRef.current = 0.92;
        wasHangingRef.current = Boolean(hanging);

        let targetCx = DEFAULT_CAM.cx;
        let targetCy = DEFAULT_CAM.cy;
        let targetZoom = 1;
        let rate = 3.2;
        if (hanging) {
          targetCx = GALLOWS_BEAM.x;
          targetCy = GALLOWS_BEAM.y + 90;
          targetZoom = reduce ? 1.55 : 2.55;
          rate = 9;
        } else if (condemned) {
          targetCx = condemned.x * 0.4 + GALLOWS_DROP.x * 0.6;
          targetCy = condemned.y * 0.4 + GALLOWS_DROP.y * 0.6;
          targetZoom = reduce ? 1.3 : 1.9;
          rate = 4.2;
        }
        const k = 1 - Math.exp(-dt * rate);
        const cam = camRef.current;
        cam.cx += (targetCx - cam.cx) * k;
        cam.cy += (targetCy - cam.cy) * k;
        cam.zoom += (targetZoom - cam.zoom) * k;
        if (hanging && cam.zoom < targetZoom * 0.92) {
          cam.cx = targetCx;
          cam.cy = targetCy;
          cam.zoom = targetZoom;
        }
        traumaRef.current = Math.max(0, traumaRef.current - dt * 1.8);
        const shake = reduce ? 0 : traumaRef.current * traumaRef.current;
        cam.shakeX = shake * 10 * Math.sin(now * 0.063);
        cam.shakeY = shake * 7 * Math.cos(now * 0.081);
        camRef.current = cam;
        window.__lfCam = { ...cam, focus: hanging ? "hang" : condemned ? "walk" : "town" };

        drawTown(ctx, assets, {
          king: s.king,
          subjects: s.subjects,
          selectedId: s.selectedId,
          viewW,
          viewH,
          cam,
          board: s.board,
          speech: s.speech,
        });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function onPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = viewTransform(rect.width, rect.height, camRef.current);
    const wx = (e.clientX - rect.left - ox) / scale;
    const wy = (e.clientY - rect.top - oy) / scale;
    const s = useGame.getState();
    const id = hitTest(s.subjects, s.king, wx, wy);
    s.select(id);
  }

  return (
    <canvas
      ref={canvasRef}
      className="town-canvas"
      onPointerDown={onPointer}
      aria-label="Ledgerford market square"
    />
  );
}

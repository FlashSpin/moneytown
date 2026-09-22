import { create } from "zustand";
import { getWorldState } from "@/lib/world";
import { playDawn, playHang, playShout, playSpawn, playTalk } from "./audio";
import { ambientTalk } from "./brains";
import { HANG_SECS, POI, WALK_SPEED } from "./constants";
import { facing, GALLOWS_DROP, GALLOWS_WATCH, moveToward, wanderPoint } from "./town";
import type { GameState, King, Subject } from "./types";
import { freshWorld } from "./world";
import { uid } from "./wallets";

/** Client-only viewer state — never part of the server-authoritative GameState. */
type ViewState = {
  selectedId: string | null;
  loading: boolean;
  /** True once a real server world has been applied (the placeholder is not one). */
  synced: boolean;
  error: string | null;
  /** Ambient-chatter cooldown, purely cosmetic and never sent anywhere. */
  talkCd: number;
};

type Actions = {
  loadWorld: () => Promise<void>;
  select: (id: string | null) => void;
  tick: (dt: number) => void;
};

function actor(s: GameState, id: string): King | Subject | null {
  if (id === "king") return s.king;
  return s.subjects.find((x) => x.id === id) ?? null;
}

function speakerName(s: GameState, id: string): string {
  if (id === "king") return "The King";
  return s.subjects.find((x) => x.id === id)?.firstName ?? "A voice";
}

export const useGame = create<GameState & ViewState & Actions>((set, get) => ({
  ...freshWorld(0),
  selectedId: null,
  loading: true,
  synced: false,
  error: null,
  talkCd: 8,

  loadWorld: async () => {
    try {
      const world = await getWorldState();
      const prev = get();
      // Only the daily cron writes the world, so a same-day poll carries
      // nothing new — applying it would snap every walker back to their
      // stored spot, replay the day's speech and re-march the condemned.
      if (prev.synced && world.day === prev.day) {
        if (prev.error) set({ error: null });
        return;
      }
      if (prev.synced && world.day > prev.day) playDawn();
      if (prev.synced && world.subjects.length > prev.subjects.length) playSpawn();
      set({ ...world, loading: false, synced: true, error: null });
    } catch {
      set({ loading: false, error: "Could not reach the parish. Retrying shortly." });
    }
  },

  select: (id) => set({ selectedId: id }),

  tick: (dt) => {
    const s = get();
    const cap = Math.min(dt, 0.1);
    const step = WALK_SPEED * cap;
    const king = s.king;
    const grim = s.subjects.find((x) => x.state === "condemned" || x.state === "hanging");

    for (const line of s.speech) {
      const prev = line.age;
      line.age += cap;
      if (prev < 0 && line.age >= 0 && !line.heard) {
        line.heard = true;
        if (line.shout) playShout();
        else playTalk();
      }
      if (line.age >= 0 && line.age < line.life && line.shout && !line.logged) {
        line.logged = true;
        const who = speakerName(s, line.fromId);
        s.log = [
          {
            id: uid("l", Math.random),
            day: s.day,
            text: line.fromId === "king" ? `The King shouts: “${line.text}”` : `${who} shouts: “${line.text}”`,
            kind: "talk" as const,
          },
          ...s.log,
        ].slice(0, 80);
      }
    }
    for (let i = s.speech.length - 1; i >= 0; i--) {
      if (s.speech[i]!.age > s.speech[i]!.life) s.speech.splice(i, 1);
    }

    const active = s.speech.find((l) => l.age >= 0 && l.age < l.life);
    if (active && !grim) {
      const from = actor(s, active.fromId);
      if (from && active.shout) {
        from.dir = "down";
      } else if (from && active.toId) {
        const to = actor(s, active.toId);
        if (to) {
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          from.destX = mx - 18;
          from.destY = my;
          to.destX = mx + 18;
          to.destY = my;
          if (Math.hypot(from.x - to.x, from.y - to.y) < 48) {
            from.dir = from.x <= to.x ? "right" : "left";
            to.dir = to.x <= from.x ? "right" : "left";
          }
        }
      }
    }

    if (grim) {
      king.destX = GALLOWS_WATCH.x;
      king.destY = GALLOWS_WATCH.y;
    }
    const km = moveToward(king.x, king.y, king.destX, king.destY, step);
    const kMoving = !km.arrived;
    king.x = km.x;
    king.y = km.y;
    if (kMoving) {
      king.dir = facing(king.destX - king.x, king.destY - king.y);
      king.frameT += cap;
      king.frame = Math.floor(king.frameT * 6) % 4;
    } else {
      king.frameT = 0;
      king.frame = 0;
      if (!grim && !active && Math.random() < cap * 0.15) {
        king.destX = POI.kingStand.x + (Math.random() - 0.5) * 40;
        king.destY = POI.kingStand.y + (Math.random() - 0.5) * 16;
      }
    }

    let removed = false;
    const keep: Subject[] = [];
    for (const sub of s.subjects) {
      if (sub.state === "hanging") {
        sub.hangT += cap;
        sub.frame = 0;
        if (sub.hangT > HANG_SECS) {
          removed = true;
          continue;
        }
        keep.push(sub);
        continue;
      }

      const moved = moveToward(
        sub.x,
        sub.y,
        sub.destX,
        sub.destY,
        step * (sub.state === "condemned" ? 3.2 : 1),
        sub.state === "condemned",
      );
      const moving = !moved.arrived;
      sub.x = moved.x;
      sub.y = moved.y;
      if (moving) {
        sub.dir = facing(sub.destX - sub.x, sub.destY - sub.y);
        sub.frameT += cap;
        sub.frame = Math.floor(sub.frameT * 6) % 4;
      } else {
        sub.frameT = 0;
        sub.frame = 0;
        if (sub.state === "condemned") {
          sub.state = "hanging";
          sub.hangT = 0;
          sub.x = GALLOWS_DROP.x;
          sub.y = GALLOWS_DROP.y;
          playHang();
        } else if (!active && Math.random() < cap * 0.28) {
          const w = wanderPoint(Math.random);
          sub.destX = w.x;
          sub.destY = w.y;
          sub.state = "walk";
        }
      }
      keep.push(sub);
    }

    const talkCd = get().talkCd - cap;
    if (talkCd <= 0 && s.speech.length === 0 && !grim) {
      set({ talkCd: 14 + Math.random() * 12 });
      const living = keep.filter((x) => x.state !== "condemned" && x.state !== "hanging");
      const extra = ambientTalk(
        Math.random,
        living.map((x) => ({ id: x.id })),
        true,
      );
      if (extra) {
        const lines = Array.isArray(extra) ? extra : [extra];
        s.speech.push(...lines);
      }
    } else {
      set({ talkCd });
    }

    if (removed) {
      const gone = s.subjects.filter((a) => !keep.some((b) => b.id === a.id));
      const selectedId = get().selectedId && gone.some((g) => g.id === get().selectedId) ? null : get().selectedId;
      set({
        subjects: keep,
        selectedId,
        speech: s.speech.filter((l) => !gone.some((g) => g.id === l.fromId || g.id === l.toId)),
      });
    }
  },
}));

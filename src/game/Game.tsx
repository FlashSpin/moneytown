import { useEffect, useState } from "react";
import { playDawn, playGive, playSpawn, unlockAudio } from "./audio";
import { Ledger } from "./Ledger";
import { useGame } from "./store";
import { GALLOWS_DROP } from "./town";
import { TownCanvas } from "./TownCanvas";
import { sumExchequer } from "./wallets";

declare global {
  interface Window {
    __ledgerford?: {
      give: () => void;
      take: () => void;
      spawn: () => boolean;
      dawn: () => Promise<void>;
      tax: () => number;
      subjects: () => number;
      king: () => number;
      exchequer: () => number;
      ruin: () => void;
      hangNow: () => void;
      selectFirst: () => void;
      selectKing: () => void;
      fundFirst: (sats?: number) => void;
      fundKing: (sats?: number) => void;
      converse: (toId: string | null, text: string, shout?: boolean) => Promise<void>;
      snapshot: () => unknown;
    };
  }
}

function ShoutBanner() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const s = useGame.getState();
      const line = s.speech.find((l) => l.shout && l.age >= 0 && l.age < l.life);
      let next: string | null = null;
      if (line) {
        const who =
          line.fromId === "king"
            ? "The King"
            : line.fromId === "you"
              ? "You"
              : (s.subjects.find((x) => x.id === line.fromId)?.firstName ?? "A voice");
        next = `${who}: ${line.text}`;
      }
      setText((prev) => (prev === next ? prev : next));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!text) return null;
  return <div className="shout-banner">{text}</div>;
}

export function Game() {
  const started = useGame((s) => s.started);
  const dawnRunning = useGame((s) => s.dawnRunning);
  const gallowsBusy = useGame((s) =>
    s.subjects.some((x) => x.state === "hanging" || x.state === "condemned"),
  );
  const hanging = useGame((s) => s.subjects.some((x) => x.state === "hanging"));
  const boot = useGame((s) => s.boot);
  const start = useGame((s) => s.start);
  const refreshTape = useGame((s) => s.refreshTape);

  useEffect(() => {
    boot();
    void refreshTape();
    window.__ledgerford = {
      give: () => useGame.getState().give(),
      take: () => useGame.getState().take(),
      spawn: () => useGame.getState().spawn(),
      dawn: () => useGame.getState().dawn(),
      tax: () => useGame.getState().taxRate,
      subjects: () => useGame.getState().subjects.length,
      king: () => useGame.getState().king.balance,
      exchequer: () => useGame.getState().exchequer,
      ruin: () => {
        const s = useGame.getState();
        const subjects = s.subjects.map((sub) => ({
          ...sub,
          testBalance: 200,
          balance: sub.walletMode === "chain" && sub.chainBalance != null ? sub.chainBalance : 200,
        }));
        useGame.setState({
          subjects,
          exchequer: sumExchequer(s.king, subjects),
        });
      },
      hangNow: () => {
        const s = useGame.getState();
        const first = s.subjects[0];
        if (!first) return;
        useGame.setState({
          subjects: s.subjects.map((sub, i) =>
            i === 0
              ? {
                  ...sub,
                  testBalance: 0,
                  balance: 0,
                  state: "condemned",
                  hangT: 0,
                  x: GALLOWS_DROP.x - 36,
                  y: GALLOWS_DROP.y + 18,
                  destX: GALLOWS_DROP.x,
                  destY: GALLOWS_DROP.y,
                }
              : sub,
          ),
        });
      },
      selectFirst: () => {
        const s = useGame.getState();
        const id = s.subjects[0]?.id ?? "king";
        s.select(id);
      },
      selectKing: () => useGame.getState().select("king"),
      fundFirst: (sats = 50_000) => {
        const s = useGame.getState();
        const first = s.subjects[0];
        if (!first) return;
        s.updateWallet(first.id, { testBalance: sats, walletMode: "test" });
      },
      fundKing: (sats = 50_000) => {
        useGame.getState().updateWallet("king", { testBalance: sats, walletMode: "test" });
      },
      converse: (toId, text, shout) => useGame.getState().converse(toId, text, shout),
      snapshot: () => {
        const s = useGame.getState();
        return {
          day: s.day,
          king: s.king.balance,
          kingTest: s.king.testBalance,
          kingWallet: s.king.wallet,
          kingMode: s.king.walletMode,
          kingAgent: `${s.king.brainChoice}${s.king.brainModel ? `:${s.king.brainModel}` : ""}`,
          spawnAgent: `${s.brainChoice}${s.brainModel ? `:${s.brainModel}` : ""}`,
          exchequer: s.exchequer,
          tax: s.taxRate,
          talking: s.talking,
          brain: s.brain,
          subjects: s.subjects.map((x) => ({
            name: x.firstName,
            balance: x.balance,
            testBalance: x.testBalance,
            chainBalance: x.chainBalance,
            walletMode: x.walletMode,
            wallet: x.wallet,
            state: x.state,
            hangT: Number(x.hangT.toFixed(2)),
            x: Math.round(x.x),
            y: Math.round(x.y),
            agent: `${x.brainChoice}${x.brainModel ? `:${x.brainModel}` : ""}`,
          })),
          tape: s.tape,
          speech: s.speech.map((l) => ({
            from: l.fromId,
            to: l.toId,
            shout: l.shout,
            text: l.text,
            age: Number(l.age.toFixed(2)),
          })),
          log0: s.log[0]?.text,
        };
      },
    };
  }, [boot, refreshTape]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!useGame.getState().started) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          unlockAudio();
          start();
        }
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const s = useGame.getState();
      switch (e.key) {
        case "g":
        case "G":
          playGive();
          s.give();
          break;
        case "t":
        case "T":
          playGive();
          s.take();
          break;
        case "s":
        case "S":
          if (s.spawn()) playSpawn();
          break;
        case "n":
        case "N":
        case " ":
          e.preventDefault();
          if (!s.dawnRunning) {
            playDawn();
            void s.dawn();
          }
          break;
        case "[":
        case "-":
        case "_":
          s.nudgeTax(-1);
          break;
        case "]":
        case "=":
        case "+":
          s.nudgeTax(1);
          break;
        case "Escape":
          s.select(null);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  return (
    <div className="app-shell">
      <div className="town-pane">
        <TownCanvas />
        {!started ? (
          <div className="gate">
            <div className="gate-card">
              <p className="ledger-kicker">A market town of linked agents</p>
              <h1>Ledgerford</h1>
              <p className="gate-copy">
                You make each soul and link it to an AI agent that must think and make money
                online for its own wallet. The King cannot make anyone — he only commands, and
                his tax hangs those who cannot pay. The game pays no wage. In Test mode you may
                edit any wallet in pounds. On-chain is watch-only. No keys are kept.
              </p>
              <button
                type="button"
                className="gate-btn"
                onClick={() => {
                  unlockAudio();
                  start();
                }}
              >
                Open the gates
              </button>
              <p className="hint">G fund the King · S make a soul · N dawn · click a name</p>
            </div>
          </div>
        ) : null}
        {dawnRunning ? <div className="dawn-banner">The cock crows. Dawn is reckoned.</div> : null}
        <ShoutBanner />
        {started && gallowsBusy ? (
          <div className="gallows-banner">
            {hanging ? "The rope takes its due." : "Walked to the gallows."}
          </div>
        ) : null}
      </div>
      <Ledger />
    </div>
  );
}

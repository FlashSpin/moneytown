import { useEffect } from "react";
import { unlockAudio } from "./audio";
import { Ledger } from "./Ledger";
import { WORLD_POLL_MS } from "./constants";
import { useGame } from "./store";
import { TownCanvas } from "./TownCanvas";

function ShoutBanner() {
  const speech = useGame((s) => s.speech);
  const subjects = useGame((s) => s.subjects);
  const line = speech.find((l) => l.shout && l.age >= 0 && l.age < l.life);
  if (!line) return null;
  const who = line.fromId === "king" ? "The King" : (subjects.find((x) => x.id === line.fromId)?.firstName ?? "A voice");
  return <div className="shout-banner">{`${who}: ${line.text}`}</div>;
}

/** When the last trading tick is overdue (the scheduler missed it), an open page asks the server to run one. */
const OVERDUE_MS = 6 * 60_000;
let lastNudge = 0;
function nudgeSchedule(lastTickAt: number | undefined) {
  const now = Date.now();
  if (lastTickAt && now - lastTickAt < OVERDUE_MS) return;
  if (now - lastNudge < OVERDUE_MS) return;
  lastNudge = now;
  void fetch("/api/heartbeat", { method: "POST", keepalive: true }).catch(() => undefined);
}

export function Game() {
  const loading = useGame((s) => s.loading);
  const error = useGame((s) => s.error);
  const gallowsBusy = useGame((s) => s.subjects.some((x) => x.state === "hanging" || x.state === "condemned"));
  const hanging = useGame((s) => s.subjects.some((x) => x.state === "hanging"));
  const loadWorld = useGame((s) => s.loadWorld);

  useEffect(() => {
    unlockAudio();
    void loadWorld();
    void useGame.getState().restoreSeal();
    void useGame.getState().loadLiveTape();
    const refresh = () => {
      // A hidden tab doesn't need fresh numbers; it catches up when it's shown again.
      if (document.visibilityState !== "visible") return;
      void loadWorld();
      void useGame.getState().loadLiveTape();
      nudgeSchedule(useGame.getState().lastTickAt);
    };
    const id = setInterval(refresh, WORLD_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadWorld]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") useGame.getState().select(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell">
      <div className="town-pane">
        <TownCanvas />
        {loading ? (
          <div className="gate">
            <div className="gate-card">
              <p className="ledger-kicker">A market town of trading agents</p>
              <h1>Ledgerford</h1>
              <p className="gate-copy">Loading the parish…</p>
            </div>
          </div>
        ) : null}
        {error ? <div className="dawn-banner">{error}</div> : null}
        <ShoutBanner />
        {gallowsBusy ? (
          <div className="gallows-banner">{hanging ? "The rope takes its due." : "Walked to the gallows."}</div>
        ) : null}
      </div>
      <Ledger />
    </div>
  );
}

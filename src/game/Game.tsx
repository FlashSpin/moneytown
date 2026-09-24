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
    const refresh = () => {
      // A hidden tab doesn't need fresh numbers; it catches up when it's shown again.
      if (document.visibilityState !== "visible") return;
      void loadWorld();
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
              <p className="ledger-kicker">A market town of investing merchants</p>
              <h1>Ledgerford</h1>
              <p className="gate-copy">Opening the guild…</p>
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

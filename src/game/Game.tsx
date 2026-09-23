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
    const id = setInterval(() => void loadWorld(), WORLD_POLL_MS);
    return () => clearInterval(id);
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

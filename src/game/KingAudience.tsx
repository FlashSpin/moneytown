import { Crown, KeyRound, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PETITION_MAX_CHARS, SUMMONS_PER_DAY } from "./constants";
import { useGame } from "./store";

const COMMON_ASKS = [
  "How fare the villagers?",
  "What is thy trading strategy today?",
  "Your Majesty, summon a new villager!",
];

const SOVEREIGN_ASKS = [
  "Who is at risk of the gallows?",
  "Banish the poorest soul.",
  "Set the tax to 10%.",
  "Favour ETH in the markets.",
  "Summon five more traders.",
];

function SealControl() {
  const sovereign = useGame((s) => s.sovereign);
  const offerSeal = useGame((s) => s.offerSeal);
  const forgetSeal = useGame((s) => s.forgetSeal);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong">("idle");

  if (sovereign) {
    return (
      <div className="seal-row">
        <span className="seal-badge">
          <KeyRound size={13} /> Thou bearest the royal seal
        </span>
        <button type="button" className="text-btn" onClick={forgetSeal}>
          Forget seal
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="seal-row">
        <button type="button" className="text-btn" onClick={() => setOpen(true)}>
          <KeyRound size={13} /> Present the royal seal
        </button>
      </div>
    );
  }

  return (
    <form
      className="seal-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("checking");
        const ok = await offerSeal(value);
        setState(ok ? "idle" : "wrong");
        if (ok) {
          setValue("");
          setOpen(false);
        }
      }}
    >
      <input
        type="password"
        className="audience-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Royal seal passphrase"
        aria-label="Royal seal passphrase"
        autoComplete="current-password"
        maxLength={200}
      />
      <button type="submit" className="seal-btn" disabled={!value.trim() || state === "checking"}>
        {state === "checking" ? "…" : "Unlock"}
      </button>
      <button type="button" className="text-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {state === "wrong" ? <p className="seal-wrong">That is not the royal seal.</p> : null}
    </form>
  );
}

/** An audience with the King's AI: counsel, news of the villagers, summons — and decrees for the seal-bearer. */
export function KingAudience() {
  const audience = useGame((s) => s.audience);
  const petitioning = useGame((s) => s.petitioning);
  const petition = useGame((s) => s.petition);
  const day = useGame((s) => s.day);
  const kingBrain = useGame((s) => s.kingBrain);
  const sovereign = useGame((s) => s.sovereign);
  const summonedToday = useGame((s) => (s.petitions?.day === s.day ? s.petitions.summoned : 0));
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [audience.length, petitioning]);

  function send(text: string) {
    if (!text.trim() || petitioning) return;
    setDraft("");
    void petition(text);
  }

  const left = Math.max(0, SUMMONS_PER_DAY - summonedToday);
  const asks = sovereign ? SOVEREIGN_ASKS : COMMON_ASKS;

  return (
    <section className="audience" aria-label="Audience with the King">
      <p className="section-label">
        <Crown size={13} /> Audience with the King
      </p>
      <p className="hint">
        {sovereign
          ? "Command him: summon or banish souls, set the tax, fix the favoured market — or ask for counsel."
          : `Ask the King for news of the villagers, trading counsel, or new souls — ${
              left > 0 ? `${left} more may be summoned on day ${day}.` : "no more summons until the next dawn."
            }`}
      </p>

      {audience.length > 0 || petitioning ? (
        <ol className="audience-log" ref={listRef} aria-live="polite">
          {audience.map((l) => (
            <li key={l.id} data-from={l.from}>
              {l.from === "you" ? <span className="audience-who">You</span> : null}
              {l.from === "king" ? <span className="audience-who">The King</span> : null}
              {l.text}
            </li>
          ))}
          {petitioning ? (
            <li data-from="king" className="audience-wait">
              <span className="audience-who">The King</span>considers thy words…
            </li>
          ) : null}
        </ol>
      ) : null}

      {!petitioning && (audience.length === 0 || sovereign) ? (
        <div className="audience-suggest">
          {asks.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={petitioning}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {kingBrain !== undefined ? (
        <p className="audience-brain" data-live={kingBrain ? "yes" : "no"}>
          {kingBrain ? `The King's mind: ${kingBrain}` : "No AI reachable — the King is using stock replies."}
        </p>
      ) : null}

      <form
        className="audience-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          className="audience-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={sovereign ? "Command His Majesty…" : "Speak to His Majesty…"}
          maxLength={PETITION_MAX_CHARS}
          aria-label="Your words to the King"
          disabled={petitioning}
        />
        <button type="submit" className="audience-send" disabled={petitioning || !draft.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>

      <SealControl />
    </section>
  );
}

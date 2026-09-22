import { Crown, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PETITION_MAX_CHARS, SUMMONS_PER_DAY } from "./constants";
import { useGame } from "./store";

const SUGGESTIONS = ["Your Majesty, summon a new villager!", "Summon three souls to trade for the crown.", "How fares the treasury?"];

/** A private audience: speak to the King's AI, who may summon souls from his treasury. */
export function KingAudience() {
  const audience = useGame((s) => s.audience);
  const petitioning = useGame((s) => s.petitioning);
  const petition = useGame((s) => s.petition);
  const day = useGame((s) => s.day);
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

  return (
    <section className="audience" aria-label="Audience with the King">
      <p className="section-label">
        <Crown size={13} /> Audience with the King
      </p>
      <p className="hint">
        Speak to the King&apos;s AI. Ask well and he may summon villagers from his treasury —{" "}
        {left > 0 ? `${left} more may be summoned on day ${day}.` : "no more summons until the next dawn."}
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
      ) : (
        <div className="audience-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={petitioning}>
              {s}
            </button>
          ))}
        </div>
      )}

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
          placeholder="Speak to His Majesty…"
          maxLength={PETITION_MAX_CHARS}
          aria-label="Your words to the King"
          disabled={petitioning}
        />
        <button type="submit" className="audience-send" disabled={petitioning || !draft.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}

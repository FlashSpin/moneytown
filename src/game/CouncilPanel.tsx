import { MessagesSquare } from "lucide-react";
import { useGame } from "./store";

function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** The latest parish council: the King's plan and the villagers' strategy debate. */
export function CouncilPanel() {
  const council = useGame((s) => s.council);
  const subjects = useGame((s) => s.subjects);
  if (!council) return null;
  const name = (id: string | null) =>
    id === "king" ? "The King" : (subjects.find((x) => x.id === id)?.firstName ?? "A villager");

  return (
    <section className="council" aria-label="Parish council">
      <p className="section-label">
        <MessagesSquare size={13} /> Parish council · {ago(council.at)}
      </p>
      <p className="council-plan">
        <span className="audience-who">The King&apos;s plan</span>
        {council.kingPlan}
      </p>
      {council.lines.length ? (
        <ol className="council-lines">
          {council.lines.map((l, i) => (
            <li key={i} data-king={l.fromId === "king" ? "yes" : undefined}>
              <strong>{name(l.fromId)}</strong>
              {l.toId ? <span className="council-to"> to {name(l.toId)}</span> : null}: {l.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">The villagers traded without debate this time.</p>
      )}
    </section>
  );
}

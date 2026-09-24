import { Award, Scale, Target } from "lucide-react";
import { COUNCIL_EVERY, LIVING_CAP, STAKE_GBP, TAX_MAX } from "./constants";
import { COST_PER_TRADE } from "./merchant";
import { RUIN_SHARE } from "./guild";
import { MILESTONES, parishWealth, SEASON_DAYS } from "./progress";
import { RANK_INFO, RANKS, rankOf } from "./ranks";
import { useGame } from "./store";
import type { Subject } from "./types";
import { money } from "./wallets";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const date = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

/** The guild's objective: beat the 60/40 this season, how it stands, and the milestones. */
export function ObjectivePanel() {
  const season = useGame((s) => s.season);
  const seasons = useGame((s) => s.seasons);
  const milestones = useGame((s) => s.milestones);
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const day = useGame((s) => s.day);
  const bench = useGame((s) => s.bench?.sf ?? 100);
  const reached = MILESTONES.filter((m) => milestones?.[m.id]);
  const next = MILESTONES.filter((m) => !milestones?.[m.id]).slice(0, 3);
  const won = (seasons ?? []).filter((s) => s.won).length;

  return (
    <section className="objective" aria-label="The guild's objective">
      <p className="section-label">
        <Target size={13} /> Objective
      </p>
      {season ? (
        (() => {
          const wealth = parishWealth({ king, subjects });
          const change = season.startWealth > 0 ? wealth / season.startWealth - 1 : 0;
          const benchChange = season.startBench > 0 ? bench / season.startBench - 1 : 0;
          const ahead = change - benchChange;
          const dayOf = Math.min(SEASON_DAYS, Math.max(1, day - season.startDay + 1));
          return (
            <>
              <p className="objective-goal">
                Season {season.n}: grow the guild&apos;s wealth <strong>more than a 60/40</strong> of shares and bonds over {SEASON_DAYS} days.
              </p>
              <div
                className="objective-meter"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((dayOf / SEASON_DAYS) * 100)}
                aria-label={`Day ${dayOf} of ${SEASON_DAYS} of the season`}
              >
                <span style={{ width: `${(dayOf / SEASON_DAYS) * 100}%` }} />
              </div>
              <p className="hint">
                Day {dayOf} of {SEASON_DAYS} · the guild <span className={change >= 0 ? "tape-up" : "tape-down"}>{pct(change)}</span>, the 60/40{" "}
                {pct(benchChange)} —{" "}
                <strong className={ahead >= 0 ? "tape-up" : "tape-down"}>
                  {ahead >= 0 ? "ahead" : "behind"} by {Math.abs(ahead * 100).toFixed(1)} points
                </strong>{" "}
                ({money(season.startWealth)} to {money(wealth)})
                {season.hanged ? ` · ${season.hanged} hanged this season` : ""}
                {seasons?.length ? ` · seasons won ${won} of ${seasons.length}` : ""}.
              </p>
            </>
          );
        })()
      ) : (
        <p className="hint">The first season begins at the next dawn: beat a 60/40 over {SEASON_DAYS} days.</p>
      )}
      <p className="section-label objective-sub">
        <Award size={13} /> Milestones · {reached.length}/{MILESTONES.length}
      </p>
      <ul className="milestones">
        {reached.map((m) => (
          <li key={m.id} className="milestone-done" title={m.why}>
            {m.title} <span className="milestone-when">{date(milestones![m.id]!.at)}</span>
          </li>
        ))}
        {next.map((m) => (
          <li key={m.id} className="milestone-next" title={m.why}>
            {m.title}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A merchant's rank, from how long it has invested and how it stands against the 60/40. */
export function RankBadge({ subject }: { subject: Subject }) {
  const bench = useGame((s) => s.bench?.sf ?? 100);
  const rank = rankOf(subject, bench);
  return (
    <span className={`rank-badge rank-${rank}`} title={`${RANK_INFO[rank].label}: ${RANK_INFO[rank].rule}`}>
      {RANK_INFO[rank].label}
    </span>
  );
}

/** What it takes to reach the next rank. */
export function NextRank({ subject }: { subject: Subject }) {
  const bench = useGame((s) => s.bench?.sf ?? 100);
  const rank = rankOf(subject, bench);
  const next = RANKS[RANKS.indexOf(rank) + 1];
  const days = subject.track?.days ?? 0;
  return (
    <p className="hint">
      {subject.firstName} is {RANK_INFO[rank].label === "Apprentice" ? "an" : "a"} {RANK_INFO[rank].label} ({days} market {days === 1 ? "day" : "days"} invested).
      {next ? ` Next: ${RANK_INFO[next].label} — ${RANK_INFO[next].rule}.` : " The highest rank."}
    </p>
  );
}

/** The guild's laws: dues, the gallows, stakes, ranks, costs and seasons. */
export function LawsPanel({ taxRate }: { taxRate: number }) {
  return (
    <details className="laws">
      <summary>
        <Scale size={13} /> The laws of the guild
      </summary>
      <ul>
        <li>
          <strong>Investing</strong>: every merchant holds a stocks &amp; shares ISA — long only, in index funds, never borrowing. Orders are
          decided after a market day&apos;s close and fill at the next; every trade costs {(COST_PER_TRADE * 100).toFixed(1)}%.
        </li>
        <li>
          <strong>Dues</strong>, at a season&apos;s end: {Math.round(taxRate * 100)}% (the crown may set 0–{Math.round(TAX_MAX * 100)}%) of each
          merchant&apos;s gain over the season, to the treasury. No gain, no dues. Funds are sold to pay them if the purse lacks the cash.
        </li>
        <li>
          <strong>The gallows</strong>: a merchant whose ISA falls below {Math.round(RUIN_SHARE * 100)}% of its stake is sold up at dawn and
          hangs; the money goes to the treasury.
        </li>
        <li>
          <strong>New merchants</strong> cost the treasury a £{STAKE_GBP.toLocaleString("en-GB")} stake each; it keeps two stakes in reserve,
          stakes at most one a dawn and no more than two unproven merchants at once, up to {LIVING_CAP}.
        </li>
        <li>
          <strong>Ranks</strong>: {RANKS.map((r) => `${RANK_INFO[r].label} (${RANK_INFO[r].rule})`).join(" → ")}.
        </li>
        <li>
          <strong>Councils</strong>: every {COUNCIL_EVERY} days the King advises and each merchant chooses its strategy. A merchant 5 points
          behind the 60/40 after 60 market days is retrained.
        </li>
        <li>
          <strong>Seasons</strong>: every {SEASON_DAYS} days the guild is judged on growing its whole wealth more than a 60/40 did over the same
          days.
        </li>
      </ul>
    </details>
  );
}

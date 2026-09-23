import { Award, Scale, Target } from "lucide-react";
import { HANG_BELOW_GBP, LIVING_CAP, RENT_GBP, STAKE_GBP, TAX_MAX } from "./constants";
import { priceOf } from "./dawn";
import { MILESTONES, parishWealth, SEASON_DAYS } from "./progress";
import { RANK_INFO, RANKS, rankOf } from "./ranks";
import { useGame } from "./store";
import type { Tape } from "./types";
import { formatPurse } from "./wallets";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const date = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

/** The parish's objective: this season's growth goal, how far along it is, and the milestones. */
export function ObjectivePanel({ tape }: { tape: Tape }) {
  const season = useGame((s) => s.season);
  const seasons = useGame((s) => s.seasons);
  const milestones = useGame((s) => s.milestones);
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const day = useGame((s) => s.day);
  const reached = MILESTONES.filter((m) => milestones?.[m.id]);
  const next = MILESTONES.filter((m) => !milestones?.[m.id]).slice(0, 3);
  const won = (seasons ?? []).filter((s) => s.won).length;

  return (
    <section className="objective" aria-label="The parish's objective">
      <p className="section-label">
        <Target size={13} /> Objective
      </p>
      {season ? (
        (() => {
          const wealth = parishWealth({ king, subjects }, (c) => priceOf(tape, c));
          const change = season.startWealth > 0 ? wealth / season.startWealth - 1 : 0;
          const progress = season.goal > 0 ? Math.max(0, Math.min(1, change / season.goal)) : 0;
          const dayOf = Math.min(SEASON_DAYS, Math.max(1, day - season.startDay + 1));
          return (
            <>
              <p className="objective-goal">
                Season {season.n}: grow the parish&apos;s wealth by <strong>{pct(season.goal)}</strong> in {SEASON_DAYS} days.
              </p>
              <div
                className="objective-meter"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                aria-label={`Progress to the season's goal: ${pct(change)} of ${pct(season.goal)}`}
              >
                <span style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="hint">
                Day {dayOf} of {SEASON_DAYS} · now <span className={change >= 0 ? "tape-up" : "tape-down"}>{pct(change)}</span> from{" "}
                {formatPurse(season.startWealth, tape)} to {formatPurse(wealth, tape)}
                {season.hanged ? ` · ${season.hanged} hanged this season` : ""}
                {seasons?.length ? ` · seasons won ${won} of ${seasons.length}` : ""}.
              </p>
            </>
          );
        })()
      ) : (
        <p className="hint">The first season begins at the next dawn: grow the parish&apos;s wealth within {SEASON_DAYS} days.</p>
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

/** A villager's rank, from its record of closed trades. */
export function RankBadge({ record }: { record?: { wins: number; losses: number; pnl: number } }) {
  const rank = rankOf(record);
  return (
    <span className={`rank-badge rank-${rank}`} title={`${RANK_INFO[rank].label}: ${RANK_INFO[rank].rule}; risks up to ${Math.round(RANK_INFO[rank].riskCap * 100)}% a trade`}>
      {RANK_INFO[rank].label}
    </span>
  );
}

/** What it takes to reach the next rank. */
export function NextRank({ name, record }: { name: string; record?: { wins: number; losses: number; pnl: number } }) {
  const rank = rankOf(record);
  const i = RANKS.indexOf(rank);
  const next = RANKS[i + 1];
  const n = record ? record.wins + record.losses : 0;
  return (
    <p className="hint">
      {name} is {RANK_INFO[rank].label === "Apprentice" ? "an" : "a"} {RANK_INFO[rank].label} ({n} closed {n === 1 ? "trade" : "trades"}) and may risk up to{" "}
      {Math.round(RANK_INFO[rank].riskCap * 100)}% of the purse on one trade.
      {next ? ` Next: ${RANK_INFO[next].label} — ${RANK_INFO[next].rule}.` : " The highest rank."}
    </p>
  );
}

/** The parish's laws: tax, upkeep, the gallows, stakes, ranks and risk. */
export function LawsPanel({ taxRate }: { taxRate: number }) {
  return (
    <details className="laws">
      <summary>
        <Scale size={13} /> The laws of the parish
      </summary>
      <ul>
        <li>
          <strong>Tax</strong>, at dawn: {Math.round(taxRate * 100)}% (the crown may set 0–{Math.round(TAX_MAX * 100)}%) of each villager&apos;s
          profit banked the day before. A losing day pays no tax, and its loss is carried forward: later profits are set against it before any
          tax is due.
        </li>
        <li>
          <strong>Upkeep</strong>, at dawn: £{RENT_GBP.toFixed(2)} a villager, into the treasury — or whatever is left if the purse can&apos;t
          cover it.
        </li>
        <li>
          <strong>The gallows</strong>: a villager worth under £{HANG_BELOW_GBP} at dawn (open trade included at that day&apos;s price) hangs;
          what is left goes to the treasury.
        </li>
        <li>
          <strong>New souls</strong> cost the treasury a £{STAKE_GBP} stake each; it keeps two stakes in reserve, opens at most one a dawn and
          no more than two unproven souls at once, up to {LIVING_CAP} living.
        </li>
        <li>
          <strong>Ranks</strong>:{" "}
          {RANKS.map((r) => `${RANK_INFO[r].label} (${RANK_INFO[r].rule}; up to ${Math.round(RANK_INFO[r].riskCap * 100)}% a trade)`).join(" → ")}.
        </li>
        <li>
          <strong>Risk</strong>: no villager may trade on after losing 10% in a day; the parish pauses until dawn after losing 8%; at most 25%
          of the parish&apos;s money on one coin.
        </li>
        <li>
          <strong>Seasons</strong>: every {SEASON_DAYS} days the parish is judged on growing its whole wealth by the season&apos;s goal; a win
          raises the next goal.
        </li>
      </ul>
    </details>
  );
}

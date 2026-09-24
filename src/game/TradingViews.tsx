import { formatFundPrice } from "@/lib/market";
import { performance, PRESET_BY_ID, strategyLabel, type GuildStrategy } from "./guild";
import { describeM, FUNDS, type FundId } from "./merchant";
import { useGame } from "./store";
import type { Subject } from "./types";
import { money } from "./wallets";

/** Pence, coloured by sign. */
export function Money({ pence, signed = true }: { pence: number; signed?: boolean }) {
  const cls = pence > 0 ? "tape-up" : pence < 0 ? "tape-down" : "";
  return (
    <span className={cls}>
      {signed ? (pence >= 0 ? "+" : "-") : ""}
      {money(Math.abs(pence))}
    </span>
  );
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** A merchant's line in the guild roll: its strategy and how it stands against the 60/40. */
export function RollPosition({ subject }: { subject: Subject }) {
  const bench = useGame((s) => s.bench?.sf ?? 100);
  const p = performance(subject, bench);
  const label = strategyLabel(subject.strategy).toUpperCase();
  if (!p || !(subject.track?.days ?? 0)) return <span className="roll-position">{label} · NOT YET INVESTED</span>;
  return (
    <span className={p.ahead >= 0 ? "roll-position roll-up" : "roll-position roll-down"}>
      {label} · {pct(p.ret)} (60/40 {pct(p.bench)})
    </span>
  );
}

function strategyAbout(s: GuildStrategy): string {
  const preset = s.preset ? PRESET_BY_ID.get(s.preset) : undefined;
  return preset ? preset.about : describeM(s.genome);
}

/** A merchant's strategy, holdings and results, in the wallet view. */
export function TradeCard({ subject }: { subject: Subject }) {
  const board = useGame((s) => s.board);
  const bench = useGame((s) => s.bench?.sf ?? 100);
  const name = subject.firstName;
  const worth = subject.worth ?? subject.balance;
  const p = performance(subject, bench);
  const rows = (Object.entries(subject.holdings ?? {}) as [FundId, number][])
    .map(([f, u]) => ({ f, value: Math.round(u * (board?.funds[f]?.close ?? 0)) }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="trade-card">
      {subject.strategy ? (
        <>
          <p className="trade-card-title">{strategyLabel(subject.strategy)}</p>
          <p className="hint">
            {name}&apos;s ISA: {strategyAbout(subject.strategy)}.{subject.strategy.note ? ` “${subject.strategy.note}”` : ""}
          </p>
        </>
      ) : (
        <p className="hint">No strategy yet — the next council will choose one.</p>
      )}
      <p className="trade-open">
        Worth <strong>{money(worth)}</strong>
        {subject.track ? (
          <>
            {" "}
            (staked {money(subject.track.start)}
            {p && subject.track.days ? (
              <>
                , {pct(p.ret)} over {subject.track.days} market days; a 60/40 made {pct(p.bench)})
              </>
            ) : (
              ")"
            )}
          </>
        ) : null}
      </p>
      {rows.length ? (
        <ul className="isa-holdings">
          {rows.map(({ f, value }) => (
            <li key={f}>
              <strong>{f}</strong> {FUNDS[f].name}: {money(value)} ({worth > 0 ? Math.round((value / worth) * 100) : 0}%)
              {board?.funds[f] ? <span className="bt-muted bt-small"> · {formatFundPrice(board.funds[f]!.close)}</span> : null}
            </li>
          ))}
          <li>Cash: {money(subject.balance)}</li>
        </ul>
      ) : (
        <p className="hint">All in cash ({money(subject.balance)}).</p>
      )}
      {subject.pending ? (
        <p className="hint">
          Orders decided at the close of {subject.pending.d}, filling at the next close:{" "}
          {Object.entries(subject.pending.w)
            .map(([f, w]) => `${f} ${Math.round((w ?? 0) * 100)}%`)
            .join(", ")}
          .
        </p>
      ) : null}
      {subject.lessons?.length ? (
        <div className="learned">
          <p className="trade-card-title">What {name} has learned</p>
          <ul className="lessons">
            {subject.lessons
              .slice()
              .reverse()
              .map((l) => (
                <li key={l}>“{l}”</li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** How the guild's money is spread across the funds at the latest close. */
export function Exposure({ subjects }: { subjects: Subject[] }) {
  const board = useGame((s) => s.board);
  const living = subjects.filter((s) => s.state !== "condemned" && s.state !== "hanging");
  const total = living.reduce((n, s) => n + (s.worth ?? s.balance), 0);
  if (!(total > 0) || !board) return null;
  const byFund = new Map<string, number>();
  let cash = 0;
  for (const s of living) {
    cash += s.balance;
    for (const [f, u] of Object.entries(s.holdings ?? {}) as [FundId, number][]) byFund.set(f, (byFund.get(f) ?? 0) + u * (board.funds[f]?.close ?? 0));
  }
  const rows = [...byFund.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <p className="books-line">
      The guild&apos;s money: {rows.map(([f, v]) => `${f} ${Math.round((v / total) * 100)}%`).join(", ")}
      {rows.length ? ", " : ""}cash {Math.round((cash / total) * 100)}%.
    </p>
  );
}

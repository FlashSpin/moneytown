import { formatCoinPrice } from "@/lib/market";
import { priceOf } from "./dawn";
import { ago, useBestTape } from "./view-helpers";
import type { Knowledge, Tally } from "./knowledge";
import { coinsLabel, STRATEGY_INFO, unrealized, type Position, type Strategy } from "./strategies";
import type { Subject, Tape } from "./types";
import { formatPurse } from "./wallets";

export function Money({ sats, tape, signed = true }: { sats: number; tape: Tape; signed?: boolean }) {
  const cls = sats > 0 ? "tape-up" : sats < 0 ? "tape-down" : "";
  return (
    <span className={cls}>
      {signed ? (sats >= 0 ? "+" : "-") : ""}
      {formatPurse(Math.abs(sats), tape)}
    </span>
  );
}

/** A villager's line in the parish roll: its open trade with live P&L, or what its strategy is watching. */
export function RollPosition({ strategy, position }: { strategy?: Strategy; position?: Position }) {
  const tape = useBestTape();
  if (position) {
    const pnl = unrealized(position, priceOf(tape, position.coin));
    return (
      <span className={pnl >= 0 ? "roll-position roll-up" : "roll-position roll-down"}>
        {position.side.toUpperCase()} {position.coin} · {pnl >= 0 ? "+" : "-"}
        {formatPurse(Math.abs(pnl), tape)}
      </span>
    );
  }
  if (!strategy) return <span className="roll-position">FLAT</span>;
  return (
    <span className="roll-position">
      {STRATEGY_INFO[strategy.kind].label.toUpperCase()} · {strategy.coins.length ? `watching ${strategy.coins.join("/")}` : "scanning all coins"}
    </span>
  );
}

/** A villager's strategy and its open trade, in the wallet view. */
export function TradeCard({
  name,
  strategy,
  position,
  trades,
  knowledge,
}: {
  name: string;
  strategy?: Strategy;
  position?: Position;
  trades?: number;
  knowledge?: Knowledge;
}) {
  const tape = useBestTape();
  return (
    <div className="trade-card">
      {strategy ? (
        <>
          <p className="trade-card-title">
            {STRATEGY_INFO[strategy.kind].label} strategy · {coinsLabel(strategy)}
          </p>
          <p className="hint">
            {name} {STRATEGY_INFO[strategy.kind].about}. {Math.round(strategy.sizePct * 100)}% of the purse per trade, take-profit{" "}
            {strategy.takeProfitPct}%, stop-loss {strategy.stopLossPct}%, {strategy.shorts ? "may short" : "long only"}.
          </p>
        </>
      ) : (
        <p className="hint">No strategy yet — the next council will choose one.</p>
      )}
      {position ? (
        <p className="trade-open">
          Open{position.own ? " (its own call)" : ""}: <strong>{position.side.toUpperCase()} {position.qty ? `${position.qty} ` : ""}{position.coin}</strong> filled at{" "}
          {formatCoinPrice(position.entryUsd)}, now{" "}
          {formatCoinPrice(priceOf(tape, position.coin))} ·{" "}
          <Money sats={unrealized(position, priceOf(tape, position.coin))} tape={tape} /> · opened {ago(position.openedAt)}
        </p>
      ) : (
        <p className="hint">No open trade — waiting for its signal.</p>
      )}
      <p className="hint">
        {trades ?? 0} {trades === 1 ? "fill" : "fills"} today.
      </p>
      <Learned name={name} knowledge={knowledge} tape={tape} />
    </div>
  );
}

const tallyLine = (t: Tally) => `${t.w}W/${t.l}L`;

/** What a villager has learned: its best and worst coins, how each approach has paid, and its lessons. */
function Learned({ name, knowledge, tape }: { name: string; knowledge?: Knowledge; tape: Tape }) {
  const coins = Object.entries(knowledge?.coins ?? {}).sort((a, b) => b[1].pnl - a[1].pnl);
  const approaches = Object.entries(knowledge?.approaches ?? {}) as [string, Tally][];
  if (!knowledge || (!coins.length && !knowledge.lessons.length)) {
    return <p className="hint">{name} has no experience yet — it learns from every trade it closes.</p>;
  }
  const best = coins.slice(0, 3).filter(([, t]) => t.pnl > 0);
  const worst = coins.slice(-3).reverse().filter(([, t]) => t.pnl < 0);
  return (
    <div className="learned">
      <p className="trade-card-title">What {name} has learned</p>
      {best.length ? (
        <p className="hint">
          Best:{" "}
          {best.map(([c, t], i) => (
            <span key={c}>
              {i ? ", " : ""}
              {c} {tallyLine(t)} <Money sats={t.pnl} tape={tape} />
            </span>
          ))}
        </p>
      ) : null}
      {worst.length ? (
        <p className="hint">
          Worst:{" "}
          {worst.map(([c, t], i) => (
            <span key={c}>
              {i ? ", " : ""}
              {c} {tallyLine(t)} <Money sats={t.pnl} tape={tape} />
            </span>
          ))}
        </p>
      ) : null}
      {approaches.length ? (
        <p className="hint">
          By approach:{" "}
          {approaches
            .map(([a, t]) => `${a === "own" ? "own calls" : (STRATEGY_INFO[a as Strategy["kind"]]?.label.toLowerCase() ?? a)} ${tallyLine(t)}`)
            .join(", ")}
        </p>
      ) : null}
      {knowledge.lessons.length ? (
        <ul className="lessons">
          {knowledge.lessons
            .slice()
            .reverse()
            .map((l) => (
              <li key={l}>“{l}”</li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

/** How much of the parish's money is in each coin right now. */
export function Exposure({ subjects, tape }: { subjects: Subject[]; tape: Tape }) {
  const living = subjects.filter((s) => s.state !== "condemned" && s.state !== "hanging");
  const equity = living.reduce((n, s) => n + s.balance + (s.position ? unrealized(s.position, priceOf(tape, s.position.coin)) : 0), 0);
  const byCoin = new Map<string, number>();
  for (const s of living) if (s.position) byCoin.set(s.position.coin, (byCoin.get(s.position.coin) ?? 0) + s.position.stake);
  if (!byCoin.size || !(equity > 0)) return null;
  const rows = [...byCoin.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <p className="books-line">
      In the market: {rows.map(([c, st]) => `${c} ${Math.round((st / equity) * 100)}%`).join(", ")} of the parish&apos;s money (cap 25% a coin).
    </p>
  );
}

import { CandlestickChart } from "lucide-react";
import { formatCoinPrice } from "@/lib/market";
import { priceOf } from "./dawn";
import { useGame } from "./store";
import type { Knowledge, Tally } from "./knowledge";
import { coinsLabel, STRATEGY_INFO, unrealized, type Position, type Strategy } from "./strategies";
import type { Subject, Tape } from "./types";
import { formatPurse } from "./wallets";

/** The freshest prices the page has: the minute-by-minute feed, else the world's. */
function useBestTape(): Tape {
  const world = useGame((s) => s.tape);
  const live = useGame((s) => s.liveTape);
  return live && !live.dark ? live : world;
}

function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

function Money({ sats, tape, signed = true }: { sats: number; tape: Tape; signed?: boolean }) {
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
function Exposure({ subjects, tape }: { subjects: Subject[]; tape: Tape }) {
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

/** Every buy and sell in the parish, newest first. */
export function TradingFloor() {
  const trades = useGame((s) => s.trades);
  const lastTickAt = useGame((s) => s.lastTickAt);
  const desk = useGame((s) => s.desk);
  const halt = useGame((s) => s.halt);
  const risk = useGame((s) => s.risk);
  const books = useGame((s) => s.ledger);
  const feed = useGame((s) => s.feed);
  const subjects = useGame((s) => s.subjects);
  const tape = useBestTape();
  const blocked = Object.entries(risk?.blocked ?? {});
  return (
    <section className="trading-floor" aria-label="Trading floor">
      <p className="section-label">
        <CandlestickChart size={13} /> Trading floor
        {lastTickAt ? <span className="floor-tick"> · last check {ago(lastTickAt)}</span> : null}
      </p>
      {halt ? (
        <p className="halt-line" role="status">
          <strong>Trading halted</strong> — {halt.reason}. Open trades are still watched and closed by their rules.
        </p>
      ) : risk?.pausedToday ? (
        <p className="halt-line" role="status">
          <strong>New trades paused until dawn</strong> — {risk.pausedToday.reason}.
        </p>
      ) : null}
      {blocked.length ? (
        <p className="desk-line">
          <strong>Stopped at the last check</strong> (risk limits and the exchange): {blocked.map(([why, n]) => `${n} × ${why}`).join(", ")}.
        </p>
      ) : null}
      {desk ? (
        <p className="desk-line">
          <strong>Trading desk</strong>
          {desk.brain ? ` (${desk.brain.label})` : ""}: {desk.say || (desk.brain ? "the villagers hold." : "no AI answered; the strategies trade alone.")}{" "}
          <span className="floor-tick">
            {desk.orders ? `${desk.orders} own ${desk.orders === 1 ? "call" : "calls"}${desk.skipped ? `, ${desk.skipped} turned down for too thin an edge` : ""} · ` : ""}
            {desk.nextAt > Date.now() ? `next look in ${Math.max(1, Math.round((desk.nextAt - Date.now()) / 60_000))} min` : "looking again soon"}
          </span>
        </p>
      ) : null}
      {tape.trending?.length ? (
        <p className="desk-line">
          <strong>Crowd is watching</strong>: {tape.trending.slice(0, 8).join(", ")} · fear &amp; greed {tape.fearGreed} ({tape.fearGreedLabel})
        </p>
      ) : null}
      <p className="hint">
        Each trade is sized by the Kelly criterion from the villager&apos;s own record and never risks more than 6% of its purse; its own calls
        need an 8-point edge over break-even. No new trade opens for a villager down 10% on the day, on a stale price, or past 25% of the
        parish on one coin; a parish down 8% pauses until dawn.
      </p>
      {feed ? (
        <p className="books-line">
          Market data: {feed.priced}/{feed.listed} coins priced ({feed.kraken} from Kraken, {feed.withBook} with a live order book)
          {feed.stale.length ? `; stale: ${feed.stale.slice(0, 6).join(", ")}${feed.stale.length > 6 ? "…" : ""}` : ""}
          {feed.held.length ? `; held back as suspicious: ${feed.held.join(", ")}` : ""}.
        </p>
      ) : null}
      <Exposure subjects={subjects} tape={tape} />
      {books?.check ? (
        <p className={books.check.ok ? "books-line" : "books-line books-bad"}>
          {books.check.ok
            ? `Books balanced — every purse matches the ledger (checked ${ago(books.check.checkedAt)}).`
            : `Books out of balance on ${books.check.diffs.length} ${books.check.diffs.length === 1 ? "account" : "accounts"} — trading halted until checked.`}{" "}
          <a href="/api/ledger" target="_blank" rel="noreferrer">
            Audit the ledger
          </a>
        </p>
      ) : null}
      {!trades?.length ? (
        <p className="hint">
          No trades yet. Every 5 minutes each villager&apos;s strategy scans every coin and trades the strongest signal; at the trading desk they
          also place their own trades whenever they choose.
        </p>
      ) : (
        <ol className="floor-list">
          {trades.slice(0, 25).map((t, i) => (
            <li key={`${t.t}-${t.id}-${i}`} data-action={t.action}>
              <span className="floor-time">{new Date(t.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="floor-what">
                <strong>{t.name}</strong>{" "}
                {t.action === "open" ? (t.side === "long" ? "bought" : "shorted") : "closed"} {t.coin} at {formatCoinPrice(t.price)}
                {t.action === "close" && t.pnl !== undefined ? (
                  <>
                    {" "}
                    <Money sats={t.pnl} tape={tape} />
                  </>
                ) : null}
                <span className="floor-why">
                  {" "}
                  — {t.own ? "own call: " : ""}
                  {t.reason}
                  {t.action === "open" && t.risk ? ` · risking ${(t.risk * 100).toFixed(1)}%` : ""}
                  {t.mid && t.cost !== undefined ? ` · mid ${formatCoinPrice(t.mid)}, spread & slippage ${formatPurse(t.cost, tape)}` : ""}
                  {t.fee ? `, fee ${formatPurse(t.fee, tape)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

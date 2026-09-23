import { CandlestickChart } from "lucide-react";
import { formatCoinPrice } from "@/lib/market";
import { priceOf } from "./dawn";
import { useGame } from "./store";
import { STRATEGY_INFO, unrealized, type Position, type Strategy } from "./strategies";
import type { Tape } from "./types";
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
      {STRATEGY_INFO[strategy.kind].label.toUpperCase()} · watching {strategy.coins.join("/")}
    </span>
  );
}

/** A villager's strategy and its open trade, in the wallet view. */
export function TradeCard({
  name,
  strategy,
  position,
  trades,
}: {
  name: string;
  strategy?: Strategy;
  position?: Position;
  trades?: number;
}) {
  const tape = useBestTape();
  return (
    <div className="trade-card">
      {strategy ? (
        <>
          <p className="trade-card-title">
            {STRATEGY_INFO[strategy.kind].label} strategy · {strategy.coins.join(", ")}
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
          Open: <strong>{position.side.toUpperCase()} {position.coin}</strong> from {formatCoinPrice(position.entryUsd)}, now{" "}
          {formatCoinPrice(priceOf(tape, position.coin))} ·{" "}
          <Money sats={unrealized(position, priceOf(tape, position.coin))} tape={tape} /> · opened {ago(position.openedAt)}
        </p>
      ) : (
        <p className="hint">No open trade — waiting for its signal.</p>
      )}
      <p className="hint">
        {trades ?? 0} {trades === 1 ? "fill" : "fills"} today.
      </p>
    </div>
  );
}

/** Every buy and sell in the parish, newest first. */
export function TradingFloor() {
  const trades = useGame((s) => s.trades);
  const lastTickAt = useGame((s) => s.lastTickAt);
  const tape = useBestTape();
  return (
    <section className="trading-floor" aria-label="Trading floor">
      <p className="section-label">
        <CandlestickChart size={13} /> Trading floor
        {lastTickAt ? <span className="floor-tick"> · last check {ago(lastTickAt)}</span> : null}
      </p>
      {!trades?.length ? (
        <p className="hint">No trades yet. Every 5 minutes each villager&apos;s strategy checks the market and trades when its signal fires.</p>
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
                <span className="floor-why"> — {t.reason}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

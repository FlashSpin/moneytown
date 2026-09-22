import { Crown, ScrollText } from "lucide-react";
import { LIVING_CAP, RENT_GBP } from "./constants";
import { useGame } from "./store";
import type { Asset, Side } from "./dawn";
import type { Tape } from "./types";
import { formatPurse } from "./wallets";

type WalletTarget = {
  id: string;
  title: string;
  wallet: string;
  balance: number;
  lastFlavor: string;
  king: boolean;
  side?: Side;
  asset?: Asset;
  lastPnl?: number;
  favorAsset?: Asset;
};

function PositionLine({ target, tape }: { target: WalletTarget; tape: Tape }) {
  if (target.king) {
    return (
      <p className="hint">
        Favors {target.favorAsset ?? "BTC"} in the markets today — his linked agents weigh it, but
        think for themselves.
      </p>
    );
  }
  if (!target.side || target.side === "flat") {
    return <p className="hint">Resting — no position.</p>;
  }
  const pnl = target.lastPnl ?? 0;
  return (
    <p className={pnl >= 0 ? "tape-up" : "tape-down"}>
      {target.side.toUpperCase()} {target.asset ?? "BTC"} · last dawn {pnl >= 0 ? "+" : ""}
      {formatPurse(pnl, tape)}
    </p>
  );
}

function WalletInspect({ target, tape }: { target: WalletTarget; tape: Tape }) {
  const select = useGame((s) => s.select);
  return (
    <section className="inspect">
      <div className="inspect-head">
        <p className="section-label">{target.king ? "Crown" : "Wallet"}</p>
        <button type="button" className="text-btn" onClick={() => select(null)}>
          Close
        </button>
      </div>
      <p className="inspect-name">
        {target.king ? <Crown size={16} /> : null}
        {target.title}
      </p>
      <p className="stat-num">{formatPurse(target.balance, tape)}</p>
      <PositionLine target={target} tape={tape} />
      <p className="hint">
        {target.king
          ? "Commands the parish and sets its market policy — favoured asset and tithe — each day."
          : "Trades for this wallet each day — the purse moves with the real market, or the King's tax hangs it."}
      </p>
      <p className="wallet-addr">{target.wallet}</p>
      <p className="hint">Placeholder address — no key behind it, never real bitcoin.</p>
      <p className="hint">{target.lastFlavor}</p>
    </section>
  );
}

export function Ledger() {
  const exchequer = useGame((s) => s.exchequer);
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const taxRate = useGame((s) => s.taxRate);
  const tape = useGame((s) => s.tape);
  const day = useGame((s) => s.day);
  const log = useGame((s) => s.log);
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);

  const selected = selectedId === "king" ? null : (subjects.find((s) => s.id === selectedId) ?? null);
  const living = subjects.filter((s) => s.state !== "hanging" && s.state !== "condemned");

  const kingTarget: WalletTarget = {
    id: "king",
    title: king.name,
    wallet: king.wallet,
    balance: king.balance,
    lastFlavor: king.lastFlavor,
    king: true,
    favorAsset: king.favorAsset,
  };

  return (
    <aside className="ledger">
      <header className="ledger-head">
        <p className="ledger-kicker">Parish of</p>
        <h1>Ledgerford</h1>
        <p className="ledger-day">Day {day}</p>
      </header>

      <section className="stat-grid">
        <div>
          <p className="section-label">Exchequer</p>
          <p className="stat-num">{formatPurse(exchequer, tape)}</p>
        </div>
        <div>
          <p className="section-label">King</p>
          <button type="button" className="stat-hit" onClick={() => select("king")}>
            <p className="stat-num">{formatPurse(king.balance, tape)}</p>
          </button>
        </div>
      </section>
      <p className="hint">Sum of every purse, in pounds. Click a name to inspect.</p>
      <p className="hint">
        Each soul trades real, live crypto prices (BTC/ETH/SOL) — paper only, no real money. The
        King sets the day's tax and favoured market; villagers trade or hang once a day, on their
        own, with no player controlling them.
      </p>

      <section className="tithe-row">
        <p className="section-label">King's tax — set by the crown</p>
        <p className="tithe-value">{Math.round(taxRate * 100)}%</p>
      </section>

      <section>
        <p className="section-label">
          Parish · {living.length}/{LIVING_CAP} living
        </p>
        {living.length === 0 ? (
          <p className="hint">No souls yet. The King's treasury will open one soon.</p>
        ) : (
          <ul className="parish-roll">
            {living.map((sub) => (
              <li key={sub.id}>
                <button type="button" className="roll-hit" onClick={() => select(sub.id)}>
                  <span className="roll-name">
                    <span>{sub.firstName}</span>
                    {sub.side && sub.side !== "flat" ? (
                      <span
                        className={(sub.lastPnl ?? 0) >= 0 ? "roll-position roll-up" : "roll-position roll-down"}
                      >
                        {sub.side.toUpperCase()} {sub.asset ?? "BTC"}
                      </span>
                    ) : null}
                  </span>
                  <span className="roll-money">{formatPurse(sub.balance, tape)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="hint transfer">Stake £20 to start. Upkeep £{RENT_GBP.toFixed(2)} plus the tax each day.</p>

      {selected ? (
        <WalletInspect
          tape={tape}
          target={{
            id: selected.id,
            title: selected.firstName,
            wallet: selected.wallet,
            balance: selected.balance,
            lastFlavor: selected.lastFlavor,
            king: false,
            side: selected.side,
            asset: selected.asset,
            lastPnl: selected.lastPnl,
          }}
        />
      ) : selectedId === "king" ? (
        <WalletInspect target={kingTarget} tape={tape} />
      ) : (
        <section className="inspect">
          <p className="section-label">The square</p>
          <p className="hint">Click a name to inspect its wallet and position.</p>
        </section>
      )}

      <section className="log">
        <p className="section-label">
          <ScrollText size={13} /> Chronicle
        </p>
        <ol>
          {log.slice(0, 14).map((entry) => (
            <li key={entry.id} data-kind={entry.kind}>
              {entry.text}
            </li>
          ))}
        </ol>
      </section>

      <footer className="ledger-foot">
        <p>A live, shared simulation — the King's treasury and every villager trade on their own, once a day.</p>
      </footer>
    </aside>
  );
}

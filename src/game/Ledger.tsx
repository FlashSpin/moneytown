import { Crown, ScrollText } from "lucide-react";
import { HANG_BELOW_GBP, LIVING_CAP, RENT_GBP } from "./constants";
import { KingAudience } from "./KingAudience";
import { stallCoins } from "./dawn";
import { useGame } from "./store";
import type { Asset, Side } from "./dawn";
import { CouncilPanel } from "./CouncilPanel";
import { LawsPanel, NextRank, ObjectivePanel, RankBadge } from "./Progress";
import { RollPosition, TradeCard, TradingFloor } from "./TradingViews";
import type { Position, Strategy } from "./strategies";
import { TEMPER_DESCRIPTIONS, temperOf, type Temper } from "./trading";
import type { Knowledge } from "./knowledge";
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
  size?: number;
  /** Purse gain or loss since dawn (sats). */
  today?: number;
  advice?: string;
  plan?: string;
  temper?: Temper;
  followsKing?: boolean;
  record?: { wins: number; losses: number; pnl: number };
  strategy?: Strategy;
  position?: Position;
  trades?: number;
  knowledge?: Knowledge;
  favorAsset?: Asset;
};

function PositionLine({ target, tape }: { target: WalletTarget; tape: Tape }) {
  if (target.king) {
    return (
      <p className="hint">
        Favours {target.favorAsset ?? "BTC"} today. Every few hours he advises each villager, then
        joins their council.
      </p>
    );
  }
  const today = target.today ?? 0;
  return (
    <p className="hint">
      Banked today (closed trades, after fees):{" "}
      <span className={today >= 0 ? "tape-up" : "tape-down"}>
        {today >= 0 ? "+" : "-"}
        {formatPurse(Math.abs(today), tape)}
      </span>
    </p>
  );
}

function MarketLine() {
  const world = useGame((s) => s.tape);
  const live = useGame((s) => s.liveTape);
  const tape = live && !live.dark ? live : world;
  if (tape.dark) return <p className="hint market-line">Market: prices unavailable — villagers sit out until they return.</p>;
  const n = Math.min(20, stallCoins(world, live).length);
  const mins = tape.fetchedAt ? Math.max(0, Math.round((Date.now() - tape.fetchedAt) / 60_000)) : null;
  return (
    <p className="hint market-line">
      Market: {n} coins, one stall each · prices from <strong>{tape.source}</strong>
      {mins !== null ? ` · ${mins < 1 ? "just now" : `${mins} min ago`}` : ""}
    </p>
  );
}

function TodayTag({ today, tape }: { today: number; tape: Tape }) {
  if (!today) return <span className="roll-today">±£0 today</span>;
  return (
    <span className={today > 0 ? "roll-today roll-up" : "roll-today roll-down"}>
      {today > 0 ? "+" : "-"}
      {formatPurse(Math.abs(today), tape)} today
    </span>
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
      {!target.king ? (
        <TradeCard
          name={target.title}
          strategy={target.strategy}
          position={target.position}
          trades={target.trades}
          knowledge={target.knowledge}
        />
      ) : null}
      {!target.king ? <NextRank name={target.title} record={target.record} /> : null}
      {!target.king ? (
        <p className="hint">
          {target.title} is {TEMPER_DESCRIPTIONS[target.temper ?? temperOf(target.id)]}.
          {target.record && target.record.wins + target.record.losses > 0
            ? ` Record: ${target.record.wins} wins, ${target.record.losses} losses, ${target.record.pnl >= 0 ? "+" : "-"}${formatPurse(
                Math.abs(target.record.pnl),
                tape,
              )} in all.`
            : ""}
        </p>
      ) : null}
      {!target.king && target.plan ? (
        <p className="own-plan">
          {target.title}&apos;s plan{target.followsKing === false ? " (going their own way)" : ""}: “{target.plan}”
        </p>
      ) : null}
      {!target.king && target.advice ? <p className="king-order">The King advised: “{target.advice}”</p> : null}
      <p className="hint">
        {target.king
          ? "Sets the tax on profits and the favoured coin each dawn, and advises every villager's strategy."
          : `Trades by its own strategy every 5 minutes at real prices; the strategy is chosen at the parish council. Below £${HANG_BELOW_GBP} it hangs.`}
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
  const taxByDecree = useGame((s) => s.decree?.taxRate !== undefined);
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
        Each soul trades the top 50 coins on the Kraken exchange (the top 20 have stalls) at real, live prices — paper only, no
        real money. The villagers are day-trading bots: every 5 minutes each one&apos;s own strategy trades on
        its signals, and at the trading desk they place their own trades when they see a clear edge. Every trade
        is sized by the Kelly criterion from what they have learned. The King advises and the villagers choose their strategies at a council every few
        hours. At dawn he taxes the day&apos;s banked profits.
      </p>

      <section className="tithe-row">
        <p className="section-label">King's tax on profits — {taxByDecree ? "by royal decree" : "set by the crown"}</p>
        <p className="tithe-value">{Math.round(taxRate * 100)}%</p>
      </section>

      <ObjectivePanel tape={tape} />

      <LawsPanel taxRate={taxRate} />

      <MarketLine />

      <KingAudience />

      <section>
        <p className="section-label">
          Parish · {living.length}/{LIVING_CAP} living
        </p>
        {living.length === 0 ? (
          <p className="hint">No souls yet. Petition the King to summon one, or wait for his treasury to open one at dawn.</p>
        ) : (
          <ul className="parish-roll">
            {living.map((sub) => (
              <li key={sub.id}>
                <button type="button" className="roll-hit" onClick={() => select(sub.id)}>
                  <span className="roll-name">
                    <span>
                      {sub.firstName} <RankBadge record={sub.record} />
                    </span>
                    <RollPosition strategy={sub.strategy} position={sub.position} />
                  </span>
                  <span className="roll-figures">
                    <span className="roll-money">{formatPurse(sub.balance, tape)}</span>
                    <TodayTag today={sub.balance - (sub.dayStart ?? sub.balance)} tape={tape} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="hint transfer">
        Stake £20 to start. Upkeep £{RENT_GBP.toFixed(2)} a day; the King&apos;s tax is on profits only.
        Below £{HANG_BELOW_GBP}, the gallows.
      </p>

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
            size: selected.size,
            today: selected.balance - (selected.dayStart ?? selected.balance),
            advice: selected.advice,
            plan: selected.plan,
            temper: selected.temper,
            followsKing: selected.followsKing,
            record: selected.record,
            strategy: selected.strategy,
            position: selected.position,
            trades: selected.trades,
            knowledge: selected.knowledge,
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

      <TradingFloor />

      <CouncilPanel />

      <section className="log">
        <p className="section-label">
          <ScrollText size={13} /> Chronicle
        </p>
        <ol>
          {log.slice(0, 14).map((entry) => (
            <li key={entry.id} data-kind={entry.kind}>
              {entry.at ? (
                <time className="log-time" dateTime={new Date(entry.at).toISOString()}>
                  Day {entry.day} · {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              ) : null}
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

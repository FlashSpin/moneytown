import * as Tabs from "@radix-ui/react-tabs";
import { CandlestickChart, CircleHelp, Crown, LayoutDashboard, ScrollText, Users } from "lucide-react";
import { useEffect } from "react";
import { HANG_BELOW_GBP, LIVING_CAP } from "./constants";
import { KingAudience } from "./KingAudience";
import { useGame, type LedgerTab } from "./store";
import type { Asset, Side } from "./dawn";
import { CouncilPanel } from "./CouncilPanel";
import { LawsPanel, NextRank, ObjectivePanel, RankBadge } from "./Progress";
import { ChronicleList, DawnReport, Guide, KeyActions, KpiTiles, LatestTrades, PositionsList, StatusCard, TradeHistory } from "./Dashboard";
import { RollPosition, TradeCard } from "./TradingViews";
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
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const taxRate = useGame((s) => s.taxRate);
  const taxByDecree = useGame((s) => s.decree?.taxRate !== undefined);
  const tape = useGame((s) => s.tape);
  const day = useGame((s) => s.day);
  const selectedId = useGame((s) => s.selectedId);
  const select = useGame((s) => s.select);
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const setGuide = useGame((s) => s.setGuide);

  // A first-time visitor gets the guide once; after that it's behind the help button.
  useEffect(() => {
    try {
      if (!localStorage.getItem(WELCOMED_KEY)) {
        localStorage.setItem(WELCOMED_KEY, "1");
        setGuide(true);
      }
    } catch {
      // Storage unavailable (private mode): skip the automatic welcome.
    }
  }, [setGuide]);

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
    <aside className="ledger" aria-label="The parish ledger">
      <header className="ledger-head">
        <div>
          <p className="ledger-kicker">Parish of</p>
          <h1>Ledgerford</h1>
          <p className="ledger-day">
            Day {day} <LiveStatus />
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={() => setGuide(true)} aria-label="How it works">
          <CircleHelp size={20} />
        </button>
      </header>

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as LedgerTab)} className="tabs">
        <Tabs.List className="tab-list" aria-label="Ledger sections">
          {TABS.map((t) => (
            <Tabs.Trigger key={t.id} value={t.id} className="tab">
              <t.icon size={16} aria-hidden />
              <span>{t.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview" className="tab-panel">
          <KpiTiles />
          <KeyActions />
          <ObjectivePanel tape={tape} />
          <StatusCard />
          <DawnReport />
          <LatestTrades />
        </Tabs.Content>

        <Tabs.Content value="trading" className="tab-panel">
          <PositionsList />
          <TradeHistory />
          <p className="card-note">
            <a href="/backtest">How the strategies did in backtests</a> — replayed on past prices, judged on data they never saw.
          </p>
        </Tabs.Content>

        <Tabs.Content value="parish" className="tab-panel">
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
          ) : null}

          <section className="card" aria-labelledby="roll-title">
            <h2 id="roll-title" className="card-title">
              The parish · {living.length}/{LIVING_CAP} living
            </h2>
            {living.length === 0 ? (
              <p className="empty-note">No souls yet. Ask the King to summon one, or wait for his treasury to open one at dawn.</p>
            ) : (
              <ul className="parish-roll">
                {living.map((sub) => (
                  <li key={sub.id}>
                    <button type="button" className="roll-hit" onClick={() => select(sub.id)} aria-pressed={selectedId === sub.id}>
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
            <button type="button" className="link-btn" onClick={() => select("king")}>
              <Crown size={14} aria-hidden /> The King&apos;s treasury
            </button>
          </section>

          <section className="tithe-row">
            <p className="section-label">King&apos;s tax on profits — {taxByDecree ? "by royal decree" : "set by the crown"}</p>
            <p className="tithe-value">{Math.round(taxRate * 100)}%</p>
          </section>
          <LawsPanel taxRate={taxRate} />
          <CouncilPanel />
        </Tabs.Content>

        <Tabs.Content value="king" className="tab-panel">
          <KingAudience />
        </Tabs.Content>

        <Tabs.Content value="chronicle" className="tab-panel">
          <ChronicleList />
        </Tabs.Content>
      </Tabs.Root>

      <footer className="ledger-foot">
        <p>A live, shared simulation on real prices with pretend money. Nothing here is financial advice.</p>
      </footer>
      <Guide />
    </aside>
  );
}

const WELCOMED_KEY = "ledgerford.welcomed";

const TABS: { id: LedgerTab; label: string; icon: typeof Crown }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "trading", label: "Trading", icon: CandlestickChart },
  { id: "parish", label: "Parish", icon: Users },
  { id: "king", label: "King", icon: Crown },
  { id: "chronicle", label: "Chronicle", icon: ScrollText },
];

/** Live, paused, halted or dark — at a glance, with words, not colour alone. */
function LiveStatus() {
  const halt = useGame((s) => s.halt);
  const paused = useGame((s) => s.risk?.pausedToday);
  const dark = useGame((s) => s.tape.dark);
  const lastTickAt = useGame((s) => s.lastTickAt);
  const stale = !lastTickAt || Date.now() - lastTickAt > 20 * 60_000;
  const [label, tone] = halt
    ? ["Trading halted", "bad"]
    : dark
      ? ["No prices", "bad"]
      : paused
        ? ["Paused until dawn", "warn"]
        : stale
          ? ["Waiting for a tick", "warn"]
          : ["Trading live", "good"];
  return (
    <span className={`pill pill-${tone}`} role="status">
      <span className="pill-dot" aria-hidden />
      {label}
    </span>
  );
}

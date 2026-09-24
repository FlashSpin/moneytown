import * as Tabs from "@radix-ui/react-tabs";
import { CircleHelp, Crown, LayoutDashboard, Landmark, ScrollText, Users } from "lucide-react";
import { useEffect } from "react";
import { LIVING_CAP } from "./constants";
import { KingAudience } from "./KingAudience";
import { useGame, type LedgerTab } from "./store";
import { CouncilPanel } from "./CouncilPanel";
import { LawsPanel, NextRank, ObjectivePanel, RankBadge } from "./Progress";
import { ChronicleList, DawnReport, Guide, KeyActions, KpiTiles, LatestTrades, PositionsList, StatusCard, TradeHistory } from "./Dashboard";
import { Money, RollPosition, TradeCard } from "./TradingViews";
import { FUNDS } from "./merchant";
import { RUIN_SHARE } from "./guild";
import { TEMPER_DESCRIPTIONS, temperOf } from "./trading";
import type { King, Subject } from "./types";
import { money } from "./wallets";

function KingInspect({ king }: { king: King }) {
  const select = useGame((s) => s.select);
  return (
    <section className="inspect">
      <div className="inspect-head">
        <p className="section-label">Crown</p>
        <button type="button" className="text-btn" onClick={() => select(null)}>
          Close
        </button>
      </div>
      <p className="inspect-name">
        <Crown size={16} />
        {king.name}
      </p>
      <p className="stat-num">{money(king.balance)}</p>
      <p className="hint">
        The treasury, in cash. Favours {king.favorAsset ? `${FUNDS[king.favorAsset]?.name ?? king.favorAsset}` : "no fund"}. Stakes new merchants, takes the guild&apos;s dues on each
        season&apos;s gains, and every week advises each merchant on its strategy before their council.
      </p>
      <p className="hint">{king.lastFlavor}</p>
    </section>
  );
}

function MerchantInspect({ subject }: { subject: Subject }) {
  const select = useGame((s) => s.select);
  return (
    <section className="inspect">
      <div className="inspect-head">
        <p className="section-label">ISA</p>
        <button type="button" className="text-btn" onClick={() => select(null)}>
          Close
        </button>
      </div>
      <p className="inspect-name">{subject.firstName}</p>
      <p className="stat-num">{money(subject.worth ?? subject.balance)}</p>
      <p className="hint">
        On the last market day: <Money pence={subject.lastPnl ?? 0} />
      </p>
      <TradeCard subject={subject} />
      <NextRank subject={subject} />
      <p className="hint">
        {subject.firstName} is {TEMPER_DESCRIPTIONS[subject.temper ?? temperOf(subject.id)]}.
      </p>
      {subject.plan ? (
        <p className="own-plan">
          {subject.firstName}&apos;s plan{subject.followsKing === false ? " (going their own way)" : ""}: “{subject.plan}”
        </p>
      ) : null}
      {subject.advice ? <p className="king-order">The King advised: “{subject.advice}”</p> : null}
      <p className="hint">
        Invests its ISA by its strategy: orders are decided after a market day&apos;s close and fill at the next, every trade costing 0.2%. If
        the ISA falls below {Math.round(RUIN_SHARE * 100)}% of its stake, it hangs.
      </p>
      <p className="wallet-addr">{subject.wallet}</p>
      <p className="hint">Pretend money on real prices — no real account behind it.</p>
      <p className="hint">{subject.lastFlavor}</p>
    </section>
  );
}

export function Ledger() {
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const taxRate = useGame((s) => s.taxRate);
  const taxByDecree = useGame((s) => s.decree?.taxRate !== undefined);
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

  return (
    <aside className="ledger" aria-label="The guild's ledger">
      <header className="ledger-head">
        <div>
          <p className="ledger-kicker">The Merchant guild of</p>
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
          <ObjectivePanel />
          <StatusCard />
          <DawnReport />
          <LatestTrades />
        </Tabs.Content>

        <Tabs.Content value="trading" className="tab-panel">
          <PositionsList />
          <TradeHistory />
          <p className="card-note">
            <a href="/isa">The guild&apos;s lab and model ISA</a> — every strategy tested on 20 years of prices, judged on data it never saw.
          </p>
        </Tabs.Content>

        <Tabs.Content value="parish" className="tab-panel">
          {selected ? <MerchantInspect subject={selected} /> : selectedId === "king" ? <KingInspect king={king} /> : null}

          <section className="card" aria-labelledby="roll-title">
            <h2 id="roll-title" className="card-title">
              The guild · {living.length}/{LIVING_CAP} merchants
            </h2>
            {living.length === 0 ? (
              <p className="empty-note">No merchants yet. Ask the King to summon one, or wait for his treasury to stake one at dawn.</p>
            ) : (
              <ul className="parish-roll">
                {living.map((sub) => (
                  <li key={sub.id}>
                    <button type="button" className="roll-hit" onClick={() => select(sub.id)} aria-pressed={selectedId === sub.id}>
                      <span className="roll-name">
                        <span>
                          {sub.firstName} <RankBadge subject={sub} />
                        </span>
                        <RollPosition subject={sub} />
                      </span>
                      <span className="roll-figures">
                        <span className="roll-money">{money(sub.worth ?? sub.balance)}</span>
                        <span className="roll-today">
                          <Money pence={sub.lastPnl ?? 0} /> last close
                        </span>
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
            <p className="section-label">The guild&apos;s dues on season gains — {taxByDecree ? "by royal decree" : "set by the crown"}</p>
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
        <p>A live, shared simulation on real fund prices with pretend money. Nothing here is financial advice.</p>
      </footer>
      <Guide />
    </aside>
  );
}

const WELCOMED_KEY = "ledgerford.welcomed";

const TABS: { id: LedgerTab; label: string; icon: typeof Crown }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "trading", label: "Investing", icon: Landmark },
  { id: "parish", label: "Guild", icon: Users },
  { id: "king", label: "King", icon: Crown },
  { id: "chronicle", label: "Chronicle", icon: ScrollText },
];

/** Open, halted or waiting for prices — at a glance, with words, not colour alone. */
function LiveStatus() {
  const halt = useGame((s) => s.halt);
  const board = useGame((s) => s.board);
  const lastMarketAt = useGame((s) => s.lastMarketAt);
  // Weekends and holidays have no close; four days without one is too long.
  const stale = !lastMarketAt || Date.now() - lastMarketAt > 4 * 86_400_000;
  const [label, tone] = halt ? ["Orders halted", "bad"] : !board ? ["Waiting for prices", "warn"] : stale ? ["No recent close", "warn"] : [`Close of ${board.d}`, "good"];
  return (
    <span className={`pill pill-${tone}`} role="status">
      <span className="pill-dot" aria-hidden />
      {label}
    </span>
  );
}

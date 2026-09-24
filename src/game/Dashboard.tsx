import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  Coins,
  Crown,
  Landmark,
  LineChart,
  OctagonX,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatCoinPrice } from "@/lib/market";
import { LIVING_CAP } from "./constants";
import { priceOf } from "./dawn";
import { parishWealth } from "./progress";
import { useGame } from "./store";
import { STRATEGY_INFO, unrealized, type TradeEvent } from "./strategies";
import { Exposure, Money } from "./TradingViews";
import { ago, useBestTape } from "./view-helpers";
import type { LogEntry, Subject, Tape } from "./types";
import { formatPurse } from "./wallets";

const living = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";
/** A trade check older than this means the schedule has stopped. */
const STALE_TICK_MS = 20 * 60_000;

// ── Overview ────────────────────────────────────────────────────────────────

/** The headline numbers: the parish's wealth, the treasury, the souls, and what's in the market. */
export function KpiTiles() {
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const tape = useBestTape();
  const alive = subjects.filter(living);
  const wealth = parishWealth({ king, subjects }, (c) => priceOf(tape, c));
  const banked = alive.reduce((n, s) => n + (s.balance - (s.dayStart ?? s.balance)), 0);
  const open = alive.filter((s) => s.position);
  const openPnl = open.reduce((n, s) => n + unrealized(s.position!, priceOf(tape, s.position!.coin)), 0);
  const staked = open.reduce((n, s) => n + s.position!.stake, 0);
  return (
    <dl className="kpis">
      <div className="kpi kpi-wide">
        <dt>
          <Landmark size={14} aria-hidden /> Parish wealth
        </dt>
        <dd className="kpi-num">{formatPurse(wealth, tape)}</dd>
        <dd className="kpi-sub">
          Today <Money sats={banked} tape={tape} /> banked, <Money sats={openPnl} tape={tape} /> open
        </dd>
      </div>
      <div className="kpi">
        <dt>
          <Crown size={14} aria-hidden /> Treasury
        </dt>
        <dd className="kpi-num">{formatPurse(king.balance, tape)}</dd>
      </div>
      <div className="kpi">
        <dt>
          <Users size={14} aria-hidden /> Souls
        </dt>
        <dd className="kpi-num">
          {alive.length}
          <span className="kpi-of">/{LIVING_CAP}</span>
        </dd>
      </div>
      <div className="kpi kpi-wide">
        <dt>
          <Coins size={14} aria-hidden /> In the market
        </dt>
        <dd className="kpi-num">
          {open.length} {open.length === 1 ? "trade" : "trades"}
        </dd>
        <dd className="kpi-sub">{open.length ? `${formatPurse(staked, tape)} staked` : "Everyone is in cash"}</dd>
      </div>
    </dl>
  );
}

type Health = "good" | "warn" | "bad";
const HEALTH_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: OctagonX } as const;
const HEALTH_WORD = { good: "OK", warn: "Check", bad: "Stopped" } as const;

function StatusRow({ health, label, children }: { health: Health; label: string; children: React.ReactNode }) {
  const Icon = HEALTH_ICON[health];
  return (
    <div className={`status-row status-${health}`}>
      <dt>
        <Icon size={15} aria-hidden />
        <span>{label}</span>
        <span className="sr-only"> — {HEALTH_WORD[health]}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Is the simulation running, and can its numbers be trusted? */
export function StatusCard() {
  const lastTickAt = useGame((s) => s.lastTickAt);
  const halt = useGame((s) => s.halt);
  const risk = useGame((s) => s.risk);
  const desk = useGame((s) => s.desk);
  const books = useGame((s) => s.ledger);
  const feed = useGame((s) => s.feed);
  const tape = useBestTape();
  const blocked = Object.entries(risk?.blocked ?? {});
  const stale = !lastTickAt || Date.now() - lastTickAt > STALE_TICK_MS;

  return (
    <section className="card" aria-labelledby="status-title">
      <h2 id="status-title" className="card-title">
        Simulation status
      </h2>
      <dl className="status">
        <StatusRow health={halt ? "bad" : risk?.pausedToday || stale ? "warn" : "good"} label="Trading">
          {halt
            ? `Halted — ${halt.reason}. Open trades are still managed.`
            : risk?.pausedToday
              ? `Paused until dawn — ${risk.pausedToday.reason}.`
              : lastTickAt
                ? `Last check ${ago(lastTickAt)}${stale ? " — the 5-minute schedule seems to have stopped" : ""}.`
                : "Waiting for the first trading check."}
        </StatusRow>
        <StatusRow health={tape.dark ? "bad" : feed && feed.stale.length > feed.listed / 2 ? "warn" : "good"} label="Market data">
          {tape.dark
            ? "Prices unavailable — no one trades until they return."
            : feed
              ? `${feed.priced}/${feed.listed} coins priced, ${feed.withBook} with a live order book (${tape.source})${
                  feed.held.length ? `; held back: ${feed.held.join(", ")}` : ""
                }.`
              : `Prices from ${tape.source}.`}
        </StatusRow>
        <StatusRow health={!books?.check ? "warn" : books.check.ok ? "good" : "bad"} label="Books">
          {!books?.check
            ? "The ledger check runs with the next trading tick."
            : books.check.ok
              ? `Balanced — every purse matches the ledger (${ago(books.check.checkedAt)}).`
              : `Out of balance on ${books.check.diffs.length} accounts — trading halted.`}{" "}
          <a href="/api/ledger" target="_blank" rel="noreferrer">
            Audit
          </a>
        </StatusRow>
        <StatusRow health={desk?.error ? "warn" : "good"} label="Trading desk">
          {desk
            ? `${desk.brain ? desk.brain.label : "No AI answered"}${desk.orders ? `, ${desk.orders} own calls` : ""}; ${
                desk.nextAt > Date.now() ? `next look in ${Math.max(1, Math.round((desk.nextAt - Date.now()) / 60_000))} min` : "looking again soon"
              }.`
            : "Not asked yet."}
        </StatusRow>
      </dl>
      {blocked.length ? (
        <p className="card-note">Stopped at the last check: {blocked.map(([why, n]) => `${n} × ${why}`).join(", ")}.</p>
      ) : null}
      <p className="card-note">
        <a href="/api/health?soft=1" target="_blank" rel="noreferrer">
          Full health report
        </a>{" "}
        — job runs, failures and timings over the last day.
      </p>
      {tape.trending?.length ? (
        <p className="card-note">
          Crowd is watching {tape.trending.slice(0, 6).join(", ")} · fear &amp; greed {tape.fearGreed} ({tape.fearGreedLabel}).
        </p>
      ) : null}
    </section>
  );
}

/** What the last dawn did to the parish's money. */
export function DawnReport() {
  const book = useGame((s) => s.lastDawn);
  const tape = useBestTape();
  if (!book) return null;
  const net = book.tax + book.upkeep + book.gallows - book.stakes;
  return (
    <section className="card" aria-labelledby="dawn-title">
      <h2 id="dawn-title" className="card-title">
        Last dawn · day {book.day}
      </h2>
      <dl className="dawn-grid">
        <div>
          <dt>Parish banked</dt>
          <dd>
            <Money sats={book.banked} tape={tape} />
          </dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd>{formatPurse(book.tax, tape)}</dd>
        </div>
        <div>
          <dt>Upkeep</dt>
          <dd>{formatPurse(book.upkeep, tape)}</dd>
        </div>
        <div>
          <dt>New stakes</dt>
          <dd>{book.stakes ? `-${formatPurse(book.stakes, tape)}` : "—"}</dd>
        </div>
        <div>
          <dt>Treasury net</dt>
          <dd>
            <Money sats={net} tape={tape} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The latest few fills, with a way to all of them. */
export function LatestTrades() {
  const trades = useGame((s) => s.trades);
  const setTab = useGame((s) => s.setTab);
  const tape = useBestTape();
  return (
    <section className="card" aria-labelledby="latest-title">
      <div className="card-head">
        <h2 id="latest-title" className="card-title">
          Latest trades
        </h2>
        <button type="button" className="link-btn" onClick={() => setTab("trading")}>
          All trades <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      {trades?.length ? (
        <ul className="trade-list">
          {trades.slice(0, 5).map((t, i) => (
            <TradeRow key={`${t.t}-${t.id}-${i}`} t={t} tape={tape} />
          ))}
        </ul>
      ) : (
        <EmptyNote>No trades yet. Each villager&apos;s strategy checks every coin every 5 minutes and trades when its signal fires.</EmptyNote>
      )}
    </section>
  );
}

/** The things a visitor can do from here. */
export function KeyActions() {
  const setTab = useGame((s) => s.setTab);
  const setGuide = useGame((s) => s.setGuide);
  return (
    <nav className="actions" aria-label="Things to do">
      <button type="button" className="btn btn-primary" onClick={() => setTab("king")}>
        <Crown size={16} aria-hidden /> Ask the King
      </button>
      <button type="button" className="btn" onClick={() => setTab("parish")}>
        <Users size={16} aria-hidden /> Meet the villagers
      </button>
      <a className="btn" href="/backtest">
        <LineChart size={16} aria-hidden /> Backtests
      </a>
      <a className="btn" href="/paper">
        <ClipboardCheck size={16} aria-hidden /> Paper trading
      </a>
      <a className="btn" href="/lab">
        <FlaskConical size={16} aria-hidden /> Strategy lab
      </a>
      <button type="button" className="btn" onClick={() => setGuide(true)}>
        <BookOpenCheck size={16} aria-hidden /> How it works
      </button>
    </nav>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="empty-note">{children}</p>;
}

// ── Trading ─────────────────────────────────────────────────────────────────

/** Every open trade, with its live profit or loss. */
export function PositionsList() {
  const subjects = useGame((s) => s.subjects);
  const select = useGame((s) => s.select);
  const tape = useBestTape();
  const open = subjects.filter((s) => living(s) && s.position);
  return (
    <section className="card" aria-labelledby="positions-title">
      <h2 id="positions-title" className="card-title">
        Open trades · {open.length}
      </h2>
      {open.length ? (
        <ul className="pos-list">
          {open.map((s) => {
            const p = s.position!;
            const px = priceOf(tape, p.coin);
            const pnl = unrealized(p, px);
            const movePct = p.entryUsd > 0 ? ((px - p.entryUsd) / p.entryUsd) * 100 * (p.side === "long" ? 1 : -1) : 0;
            return (
              <li key={s.id}>
                <button type="button" className="pos-row" onClick={() => select(s.id)} aria-label={`${s.firstName}: ${p.side} ${p.coin}, open ${ago(p.openedAt)}`}>
                  <span className="pos-who">
                    <strong>{s.firstName}</strong>
                    <span className={`side side-${p.side}`}>{p.side === "long" ? "Long" : "Short"}</span> {p.coin}
                  </span>
                  <span className="pos-pnl">
                    <Money sats={pnl} tape={tape} />
                    <span className="pos-pct">
                      {movePct >= 0 ? "+" : ""}
                      {movePct.toFixed(2)}%
                    </span>
                  </span>
                  <span className="pos-meta">
                    {formatCoinPrice(p.entryUsd)} → {formatCoinPrice(px)} · {formatPurse(p.stake, tape)} staked · {ago(p.openedAt)}
                    {p.own ? " · own call" : p.by ? ` · ${STRATEGY_INFO[p.by as keyof typeof STRATEGY_INFO]?.label ?? p.by}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyNote>Nobody is in a trade right now.</EmptyNote>
      )}
      <Exposure subjects={subjects} tape={tape} />
    </section>
  );
}

type Kind = "all" | "open" | "close" | "own";

/** Every recent fill, filterable, each with how it was filled and why. */
export function TradeHistory() {
  const stored = useGame((s) => s.trades);
  const trades = useMemo(() => stored ?? [], [stored]);
  const tape = useBestTape();
  const [who, setWho] = useState("all");
  const [kind, setKind] = useState<Kind>("all");
  const [coin, setCoin] = useState("all");
  const names = useMemo(() => [...new Set(trades.map((t) => t.name))].sort(), [trades]);
  const coins = useMemo(() => [...new Set(trades.map((t) => t.coin))].sort(), [trades]);
  const shown = trades.filter(
    (t) =>
      (who === "all" || t.name === who) &&
      (coin === "all" || t.coin === coin) &&
      (kind === "all" || (kind === "own" ? t.own : t.action === kind)),
  );
  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title" className="card-title">
        Trade history
      </h2>
      <div className="filters" role="group" aria-label="Filter trades">
        <label>
          <span>Villager</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="all">All fills</option>
            <option value="open">Opens</option>
            <option value="close">Closes</option>
            <option value="own">Own calls</option>
          </select>
        </label>
        <label>
          <span>Coin</span>
          <select value={coin} onChange={(e) => setCoin(e.target.value)}>
            <option value="all">Every coin</option>
            {coins.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="card-note" aria-live="polite">
        {shown.length} of {trades.length} recent fills
      </p>
      {shown.length ? (
        <ul className="trade-list">
          {shown.map((t, i) => (
            <TradeRow key={`${t.t}-${t.id}-${i}`} t={t} tape={tape} details />
          ))}
        </ul>
      ) : (
        <EmptyNote>{trades.length ? "No fills match these filters." : "No trades yet."}</EmptyNote>
      )}
    </section>
  );
}

function TradeRow({ t, tape, details = false }: { t: TradeEvent; tape: Tape; details?: boolean }) {
  const verb = t.action === "open" ? (t.side === "long" ? "Bought" : "Shorted") : "Closed";
  const time = new Date(t.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const head = (
    <>
      <span className="trade-time">{time}</span>
      <span className="trade-what">
        <strong>{t.name}</strong> {verb.toLowerCase()} {t.coin} at {formatCoinPrice(t.price)}
        {t.own ? <span className="tag">own call</span> : null}
      </span>
      <span className="trade-pnl">{t.action === "close" && t.pnl !== undefined ? <Money sats={t.pnl} tape={tape} /> : null}</span>
    </>
  );
  if (!details) return <li className="trade-row">{head}</li>;
  return (
    <li>
      <details className="trade-details">
        <summary className="trade-row">{head}</summary>
        <dl className="fill">
          <div>
            <dt>Why</dt>
            <dd>{t.reason}</dd>
          </div>
          {t.mid ? (
            <div>
              <dt>Filled</dt>
              <dd>
                {formatCoinPrice(t.price)} against a mid of {formatCoinPrice(t.mid)}
                {t.qty ? ` · ${t.qty} ${t.coin}` : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Costs</dt>
            <dd>
              fee {formatPurse(t.fee ?? 0, tape)}
              {t.cost !== undefined ? `, spread & slippage ${formatPurse(t.cost, tape)}` : ""}
            </dd>
          </div>
          {t.action === "open" && t.risk ? (
            <div>
              <dt>At risk</dt>
              <dd>{(t.risk * 100).toFixed(1)}% of the purse if the stop is hit</dd>
            </div>
          ) : null}
          {t.action === "close" && t.pnl !== undefined ? (
            <div>
              <dt>Result</dt>
              <dd>
                <Money sats={t.pnl} tape={tape} /> after every cost
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
    </li>
  );
}

// ── Chronicle ───────────────────────────────────────────────────────────────

const KINDS: { id: LogEntry["kind"] | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "crown", label: "The crown" },
  { id: "subject", label: "Villagers" },
  { id: "tape", label: "Markets" },
  { id: "death", label: "Gallows" },
  { id: "system", label: "Reports" },
];

export function ChronicleList() {
  const log = useGame((s) => s.log);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("all");
  const shown = log.filter((e) => kind === "all" || e.kind === kind || (kind === "crown" && e.kind === "dawn"));
  return (
    <section className="card" aria-labelledby="chronicle-title">
      <h2 id="chronicle-title" className="card-title">
        Chronicle
      </h2>
      <div className="chips" role="group" aria-label="Show">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ol className="chronicle">
          {shown.map((entry) => (
            <li key={entry.id} data-kind={entry.kind}>
              <time className="log-time" dateTime={entry.at ? new Date(entry.at).toISOString() : undefined}>
                Day {entry.day}
                {entry.at ? ` · ${new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
              </time>
              {entry.text}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyNote>Nothing of that kind yet.</EmptyNote>
      )}
    </section>
  );
}

// ── The guide: onboarding and glossary ──────────────────────────────────────

const GLOSSARY: [string, string][] = [
  ["Long", "a bet that the price rises: buy now, sell later."],
  ["Short", "a bet that the price falls: sell now, buy back later."],
  ["Take-profit", "the gain (in %) at which a trade is closed to bank the profit."],
  ["Stop-loss", "the loss (in %) at which a trade is closed to stop it losing more."],
  ["Spread", "the gap between the best price to buy (ask) and to sell (bid); every trade crosses it."],
  ["Slippage", "how much worse than the quoted price a trade fills — bigger orders slip more."],
  ["Fee", "what the exchange charges on every fill (0.4% here)."],
  ["Kelly sizing", "a formula that stakes more when a trader's record shows a real edge, and less when it doesn't."],
  ["Edge", "how much better than break-even a trade's chance of winning is, after costs."],
  ["Drawdown", "the fall from a high point to a low point — the worst stretch."],
  ["Paper trading", "trading real prices with pretend money. Nothing here is real money."],
];

/** Opens once for a first-time visitor, and any time from the help button. */
export function Guide() {
  const open = useGame((s) => s.guideOpen);
  const setGuide = useGame((s) => s.setGuide);
  const setTab = useGame((s) => s.setTab);
  return (
    <Dialog.Root open={open} onOpenChange={setGuide}>
      <Dialog.Portal>
        <Dialog.Overlay className="guide-overlay" />
        <Dialog.Content className="guide" aria-describedby="guide-lede">
          <div className="guide-head">
            <Dialog.Title className="guide-title">Welcome to Ledgerford</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close the guide">
              <X size={18} />
            </Dialog.Close>
          </div>
          <p id="guide-lede" className="guide-lede">
            A medieval market town whose villagers are AI trading bots. They trade real crypto prices from the Kraken exchange with pretend
            money — nothing here is real money, and nothing is guaranteed to make a profit.
          </p>
          <ol className="guide-steps">
            <li>
              <strong>The goal.</strong> Each 7-day season the parish must grow its total wealth by a target. Villagers who lose too much end
              up on the gallows.
            </li>
            <li>
              <strong>How they trade.</strong> Every 5 minutes each villager&apos;s strategy checks 50 coins and trades the strongest signal,
              paying real-world fees and spreads. Every trade is sized to risk at most a few percent of its purse, and every penny is recorded
              in a ledger anyone can audit.
            </li>
            <li>
              <strong>Who decides.</strong> The King advises the villagers every few hours; they debate and choose their own strategies, learn
              from every trade, and rise through the ranks as their records improve.
            </li>
            <li>
              <strong>What you can do.</strong> Ask the King anything, click any villager on the map to see their purse and trades, and watch
              the trading floor.
            </li>
          </ol>
          <details className="glossary">
            <summary>Words used here</summary>
            <dl>
              {GLOSSARY.map(([term, meaning]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
          <div className="guide-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setGuide(false);
                setTab("king");
              }}
            >
              <Crown size={16} aria-hidden /> Ask the King how the villagers fare
            </button>
            <Dialog.Close className="btn">Look around first</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

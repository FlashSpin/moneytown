import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, BookOpenCheck, CheckCircle2, ChevronRight, Crown, Landmark, OctagonX, PiggyBank, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatFundPrice } from "@/lib/market";
import { LIVING_CAP } from "./constants";
import { performance, strategyLabel, type FundTrade } from "./guild";
import { FUNDS, type FundId } from "./merchant";
import { parishWealth } from "./progress";
import { useGame } from "./store";
import { Exposure, Money } from "./TradingViews";
import { ago } from "./view-helpers";
import type { LogEntry, Subject } from "./types";
import { money } from "./wallets";

const living = (s: Subject) => s.state !== "condemned" && s.state !== "hanging";
/** No close for this long (a long weekend plus a missed run) means the market-day schedule has stopped. */
const STALE_MARKET_MS = 4 * 24 * 3_600_000;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

// ── Overview ────────────────────────────────────────────────────────────────

/** The headline numbers: the guild's wealth, the treasury, the merchants, and how much is invested. */
export function KpiTiles() {
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const alive = subjects.filter(living);
  const wealth = parishWealth({ king, subjects });
  const worth = alive.reduce((n, s) => n + (s.worth ?? s.balance), 0);
  const cash = alive.reduce((n, s) => n + s.balance, 0);
  const staked = alive.reduce((n, s) => n + (s.track?.start ?? 0), 0);
  const invested = worth - cash;
  return (
    <dl className="kpis">
      <div className="kpi kpi-wide">
        <dt>
          <Landmark size={14} aria-hidden /> Guild wealth
        </dt>
        <dd className="kpi-num">{money(wealth)}</dd>
        <dd className="kpi-sub">
          The merchants&apos; ISAs {money(worth)}: <Money pence={worth - staked} /> on their stakes
        </dd>
      </div>
      <div className="kpi">
        <dt>
          <Crown size={14} aria-hidden /> Treasury
        </dt>
        <dd className="kpi-num">{money(king.balance)}</dd>
      </div>
      <div className="kpi">
        <dt>
          <Users size={14} aria-hidden /> Merchants
        </dt>
        <dd className="kpi-num">
          {alive.length}
          <span className="kpi-of">/{LIVING_CAP}</span>
        </dd>
      </div>
      <div className="kpi kpi-wide">
        <dt>
          <PiggyBank size={14} aria-hidden /> Invested
        </dt>
        <dd className="kpi-num">{worth > 0 ? `${Math.round((invested / worth) * 100)}%` : "—"}</dd>
        <dd className="kpi-sub">
          {money(invested)} in funds, {money(cash)} in cash
        </dd>
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

/** Is the guild running, and can its numbers be trusted? */
export function StatusCard() {
  const lastMarketAt = useGame((s) => s.lastMarketAt);
  const halt = useGame((s) => s.halt);
  const books = useGame((s) => s.ledger);
  const board = useGame((s) => s.board);
  const bench = useGame((s) => s.bench);
  const stale = !lastMarketAt || Date.now() - lastMarketAt > STALE_MARKET_MS;
  const funds = board ? (Object.entries(board.funds) as [FundId, NonNullable<(typeof board.funds)[FundId]>][]) : [];

  return (
    <section className="card" aria-labelledby="status-title">
      <h2 id="status-title" className="card-title">
        Guild status
      </h2>
      <dl className="status">
        <StatusRow health={halt ? "bad" : stale ? "warn" : "good"} label="Orders">
          {halt
            ? `Halted — ${halt.reason}. Purses are still valued at every close.`
            : lastMarketAt
              ? `Last market day ${ago(lastMarketAt)}${stale ? " — the closing-price schedule seems to have stopped" : ""}.`
              : "Waiting for the first closing prices."}
        </StatusRow>
        <StatusRow health={board ? "good" : "warn"} label="Market board">
          {board
            ? `The close of ${board.d}: ${funds.length} funds priced (Yahoo daily closes, dividends included).`
            : "No closing prices yet — they arrive after each US market close."}
        </StatusRow>
        <StatusRow health={!books?.check ? "warn" : books.check.ok ? "good" : "bad"} label="Books">
          {!books?.check
            ? "The ledger check runs with the next market day."
            : books.check.ok
              ? `Balanced — every purse matches the ledger (${ago(books.check.checkedAt)}).`
              : `Out of balance on ${books.check.diffs.length} accounts — orders halted.`}{" "}
          <a href="/api/ledger" target="_blank" rel="noreferrer">
            Audit
          </a>
        </StatusRow>
      </dl>
      {bench ? (
        <p className="card-note">
          Since the guild began, a 60/40 of shares and bonds has made {pct(bench.sf / 100 - 1)} and US shares {pct(bench.us / 100 - 1)} — the
          bars every merchant is judged against.
        </p>
      ) : null}
      {funds.length ? (
        <ul className="board-list">
          {funds.map(([f, q]) => (
            <li key={f} title={FUNDS[f].name}>
              <strong>{f}</strong> {formatFundPrice(q.close)}{" "}
              <span className={q.change1d >= 0 ? "tape-up" : "tape-down"}>{pct(q.change1d)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="card-note">
        <a href="/api/health?soft=1" target="_blank" rel="noreferrer">
          Full health report
        </a>{" "}
        — job runs, failures and timings over the last day.
      </p>
    </section>
  );
}

/** What the last dawn did to the treasury. */
export function DawnReport() {
  const book = useGame((s) => s.lastDawn);
  if (!book) return null;
  const net = book.dues + book.gallows - book.stakes;
  return (
    <section className="card" aria-labelledby="dawn-title">
      <h2 id="dawn-title" className="card-title">
        Last dawn · day {book.day}
      </h2>
      <dl className="dawn-grid">
        <div>
          <dt>Dues</dt>
          <dd>{book.dues ? money(book.dues) : "—"}</dd>
        </div>
        <div>
          <dt>From the gallows</dt>
          <dd>{book.gallows ? money(book.gallows) : "—"}</dd>
        </div>
        <div>
          <dt>New stakes</dt>
          <dd>{book.stakes ? `-${money(book.stakes)}` : "—"}</dd>
        </div>
        <div>
          <dt>Treasury net</dt>
          <dd>
            <Money pence={net} />
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
  return (
    <section className="card" aria-labelledby="latest-title">
      <div className="card-head">
        <h2 id="latest-title" className="card-title">
          Latest orders
        </h2>
        <button type="button" className="link-btn" onClick={() => setTab("trading")}>
          All orders <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      {trades?.length ? (
        <ul className="trade-list">
          {trades.slice(0, 5).map((t, i) => (
            <TradeRow key={`${t.t}-${t.id}-${t.fund}-${i}`} t={t} />
          ))}
        </ul>
      ) : (
        <EmptyNote>
          No orders yet. After each close every merchant&apos;s strategy sets its target mix of funds; the orders fill at the next close.
        </EmptyNote>
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
        <Users size={16} aria-hidden /> Meet the merchants
      </button>
      <a className="btn" href="/isa">
        <Landmark size={16} aria-hidden /> Guild lab &amp; model ISA
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

// ── Investing ───────────────────────────────────────────────────────────────

/** Every merchant's ISA: its worth, how it stands against the 60/40, and its biggest holdings. */
export function PositionsList() {
  const subjects = useGame((s) => s.subjects);
  const select = useGame((s) => s.select);
  const board = useGame((s) => s.board);
  const bench = useGame((s) => s.bench?.sf ?? 100);
  const alive = subjects.filter(living).sort((a, b) => (b.worth ?? b.balance) - (a.worth ?? a.balance));
  return (
    <section className="card" aria-labelledby="positions-title">
      <h2 id="positions-title" className="card-title">
        The merchants&apos; ISAs · {alive.length}
      </h2>
      {alive.length ? (
        <ul className="pos-list">
          {alive.map((s) => {
            const worth = s.worth ?? s.balance;
            const p = performance(s, bench);
            const top = (Object.entries(s.holdings ?? {}) as [FundId, number][])
              .map(([f, u]) => ({ f, value: u * (board?.funds[f]?.close ?? 0) }))
              .filter((x) => x.value > 0)
              .sort((a, b) => b.value - a.value)
              .slice(0, 3);
            const days = s.track?.days ?? 0;
            return (
              <li key={s.id}>
                <button type="button" className="pos-row" onClick={() => select(s.id)} aria-label={`${s.firstName}: ISA worth ${money(worth)}`}>
                  <span className="pos-who">
                    <strong>{s.firstName}</strong> {strategyLabel(s.strategy)}
                  </span>
                  <span className="pos-pnl">
                    {money(worth)}
                    {p && days ? (
                      <span className={`pos-pct ${p.ahead >= 0 ? "tape-up" : "tape-down"}`}>
                        {pct(p.ret)} vs {pct(p.bench)}
                      </span>
                    ) : null}
                  </span>
                  <span className="pos-meta">
                    {top.length
                      ? top.map(({ f, value }) => `${f} ${worth > 0 ? Math.round((value / worth) * 100) : 0}%`).join(" · ")
                      : "All in cash"}
                    {days ? ` · ${days} market ${days === 1 ? "day" : "days"}` : " · not yet invested"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyNote>No merchants on the roll.</EmptyNote>
      )}
      <Exposure subjects={subjects} />
    </section>
  );
}

/** Every recent fill, filterable, each with its cost and why it was placed. */
export function TradeHistory() {
  const stored = useGame((s) => s.trades);
  const trades = useMemo(() => stored ?? [], [stored]);
  const [who, setWho] = useState("all");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [fund, setFund] = useState("all");
  const names = useMemo(() => [...new Set(trades.map((t) => t.name))].sort(), [trades]);
  const funds = useMemo(() => [...new Set(trades.map((t) => t.fund))].sort(), [trades]);
  const shown = trades.filter(
    (t) => (who === "all" || t.name === who) && (fund === "all" || t.fund === fund) && (side === "all" || (side === "buy") === t.value >= 0),
  );
  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title" className="card-title">
        Order history
      </h2>
      <div className="filters" role="group" aria-label="Filter orders">
        <label>
          <span>Merchant</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
            <option value="all">Both</option>
            <option value="buy">Buys</option>
            <option value="sell">Sells</option>
          </select>
        </label>
        <label>
          <span>Fund</span>
          <select value={fund} onChange={(e) => setFund(e.target.value)}>
            <option value="all">Every fund</option>
            {funds.map((f) => (
              <option key={f}>{f}</option>
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
            <TradeRow key={`${t.t}-${t.id}-${t.fund}-${i}`} t={t} details />
          ))}
        </ul>
      ) : (
        <EmptyNote>{trades.length ? "No fills match these filters." : "No orders yet."}</EmptyNote>
      )}
    </section>
  );
}

function TradeRow({ t, details = false }: { t: FundTrade; details?: boolean }) {
  const bought = t.value >= 0;
  const head = (
    <>
      <span className="trade-time">{t.d || new Date(t.t).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
      <span className="trade-what">
        <strong>{t.name}</strong> {bought ? "bought" : "sold"} {money(Math.abs(t.value))} of {t.fund}
      </span>
      <span className="trade-pnl bt-muted">{money(t.cost)} cost</span>
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
            <dd>{t.why}</dd>
          </div>
          <div>
            <dt>Fund</dt>
            <dd>
              {FUNDS[t.fund].name} — in a real ISA, {FUNDS[t.fund].isa}
            </dd>
          </div>
          <div>
            <dt>Filled</dt>
            <dd>At the close of {t.d}, after it was decided at the close before.</dd>
          </div>
          <div>
            <dt>Costs</dt>
            <dd>{money(t.cost)} (spread and currency fee)</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

// ── Chronicle ───────────────────────────────────────────────────────────────

const KINDS: { id: LogEntry["kind"] | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "crown", label: "The crown" },
  { id: "subject", label: "Merchants" },
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
  ["ISA", "an Individual Savings Account: in the UK, gains and dividends inside a stocks & shares ISA are free of tax."],
  ["Index fund", "one fund that owns a whole market (say the 500 biggest US companies), so one purchase spreads the money widely."],
  ["60/40", "60% in shares, 40% in bonds — the plain, sleepy mix every merchant is judged against."],
  ["Rebalance", "selling what has grown too big and buying what has shrunk, to get back to the target mix."],
  ["200-day average", "the average close over roughly the last ten months; a trend strategy holds a fund only while it is above it."],
  ["Momentum", "holding what has risen most over recent months, on the evidence that winners tend to keep winning for a while."],
  ["Drawdown", "the fall from a high point to a low point — the worst stretch."],
  ["Dues", "the share of each merchant's season gain paid to the treasury (the guild's only tax; ISAs pay none)."],
  ["Paper trading", "investing at real closing prices with pretend money. Nothing here is real money."],
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
            A medieval market town whose villagers are AI merchants, each running a stocks &amp; shares ISA of index funds at real closing
            prices with pretend money — nothing here is real money, and nothing is guaranteed to make a profit.
          </p>
          <ol className="guide-steps">
            <li>
              <strong>The goal.</strong> Each 28-day season the guild must grow its wealth more than a plain 60/40 of shares and bonds would
              have. A merchant whose ISA falls below half its stake goes to the gallows.
            </li>
            <li>
              <strong>How they invest.</strong> After each US market close, every merchant&apos;s strategy sets its target mix of ten funds
              (shares, bonds, property, gold). The orders fill at the next close, paying realistic costs, and every penny is recorded in a
              ledger anyone can audit.
            </li>
            <li>
              <strong>Who decides.</strong> Every week the King advises and the merchants choose their strategies from those tested over twenty
              years of prices. A merchant far behind the 60/40 is retrained, and merchants rise through the ranks as their records improve.
            </li>
            <li>
              <strong>What you can do.</strong> Ask the King anything, click any merchant on the map to see its ISA, and open the guild lab to
              see how every strategy fared on years it never saw.
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
              <Crown size={16} aria-hidden /> Ask the King how the merchants fare
            </button>
            <Dialog.Close className="btn">Look around first</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

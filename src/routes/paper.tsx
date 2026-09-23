import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { formatCoinPrice } from "@/lib/market";
import { getPaperReport } from "@/lib/paper";
import type { PaperReport } from "@/lib/paper.server";
import type { PaperStats } from "@/game/paper";

export const Route = createFileRoute("/paper")({
  loader: () => getPaperReport(),
  component: PaperPage,
  head: () => ({ meta: [{ title: "Paper trading — Ledgerford" }] }),
});

const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const time = (ms: number) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function PaperPage() {
  const report = Route.useLoaderData() as PaperReport | null;
  return (
    <main className="bt-page">
      <header className="bt-head">
        <Link to="/" className="bt-back">
          ← Back to Ledgerford
        </Link>
        <h1>Paper trading</h1>
        <p className="bt-lede">
          The villagers trade live Kraken prices with pretend money, paying realistic costs. This page measures how that is going, compares it
          with the backtests, and lists the gates that would have to pass before anyone considered real money. Nothing here ever switches to
          real money on its own.
        </p>
      </header>
      {!report ? (
        <section className="bt-card">
          <h2>No paper trading recorded yet</h2>
          <p>Orders are recorded from the next trading tick onwards.</p>
        </section>
      ) : (
        <Report r={report} />
      )}
    </main>
  );
}

function Report({ r }: { r: PaperReport }) {
  const money = (sats: number | null | undefined) =>
    sats == null ? "—" : `${sats >= 0 ? "+" : "-"}£${(Math.abs(sats) * r.gbpPerSat).toFixed(2)}`;
  const passed = r.readiness.gates.filter((g) => g.status === "pass").length;
  return (
    <>
      <section className="bt-card" aria-labelledby="gates-title">
        <h2 id="gates-title">Real money: {r.readiness.ready ? "ready for a decision" : "not ready"}</h2>
        <p className="bt-note">
          {passed} of {r.readiness.gates.length} gates pass.{" "}
          {r.readiness.ready
            ? "Every gate passes — that makes it a decision for a person, never an automatic switch."
            : "Every gate must pass, and then it is still a person's decision."}
        </p>
        <ul className="readiness-gates">
          {r.readiness.gates.map((g) => {
            const Icon = g.status === "pass" ? CheckCircle2 : g.status === "fail" ? XCircle : CircleDashed;
            return (
              <li key={g.id} className={`rgate rgate-${g.status}`}>
                <Icon size={18} aria-hidden />
                <span>
                  <strong>{g.title}</strong>
                  <span className="sr-only"> — {g.status === "pass" ? "passes" : g.status === "fail" ? "fails" : "needs sign-off"}</span>
                  <span className="rgate-detail">{g.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="bt-small bt-muted">
          Sign-offs are recorded by the owner setting READINESS_SECURITY_REVIEW, READINESS_MONITORING and READINESS_LEGAL (e.g. to a date and
          name) in the deployment&apos;s environment.
        </p>
      </section>

      <section className="bt-card" aria-labelledby="summary-title">
        <h2 id="summary-title">The whole parish</h2>
        <StatsGrid s={r.all} money={money} />
        <p className="bt-note">
          {r.since ? `Recorded since ${time(r.since)}.` : ""} {r.backtest ? `Compared with backtest #${r.backtest.id} (${r.backtest.days} days of data).` : "No backtest to compare with yet."}
        </p>
      </section>

      <section className="bt-card" aria-labelledby="by-title">
        <h2 id="by-title">By strategy</h2>
        <div className="bt-table-wrap">
          <table className="bt-table">
            <thead>
              <tr>
                <th scope="col">Approach</th>
                <th scope="col">Opens / day</th>
                <th scope="col">Closed</th>
                <th scope="col">Win rate</th>
                <th scope="col">P&amp;L</th>
                <th scope="col">Cost / fill</th>
                <th scope="col">Rejected</th>
                <th scope="col">Follow-through</th>
              </tr>
            </thead>
            <tbody>
              {r.byApproach.length ? (
                r.byApproach.map((s) => (
                  <tr key={s.approach}>
                    <th scope="row">{s.approach === "own" ? "own calls" : s.approach}</th>
                    <td>{s.opensPerDay == null ? "—" : s.opensPerDay.toFixed(1)}</td>
                    <td>{s.closes}</td>
                    <td>{pct(s.winRate, 0)}</td>
                    <td className={s.pnl > 0 ? "tape-up" : s.pnl < 0 ? "tape-down" : ""}>{money(s.pnl)}</td>
                    <td>{pct(s.avgCostPct, 2)}</td>
                    <td>{pct(s.rejectRate, 0)}</td>
                    <td>{pct(s.followThrough, 2)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>No orders yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="bt-small bt-muted">Follow-through: how far the price moved the trade&apos;s way one tick after entry — a rough read of signal quality.</p>
      </section>

      <section className="bt-card" aria-labelledby="diff-title">
        <h2 id="diff-title">Differences from the backtest</h2>
        {r.discrepancies.length ? (
          <ul className="bt-list">
            {r.discrepancies.map((d, i) => (
              <li key={i}>
                <strong>{d.approach}</strong> — {d.measure}: paper {d.measure === "trades a day" ? d.paper.toFixed(1) : pct(d.paper, 2)}, backtest{" "}
                {d.measure === "trades a day" ? d.backtest.toFixed(1) : pct(d.backtest, 2)} ({d.note}).
              </li>
            ))}
          </ul>
        ) : (
          <p className="bt-note">None found — or not enough closed trades yet to compare (10 per strategy).</p>
        )}
      </section>

      <section className="bt-card" aria-labelledby="orders-title">
        <h2 id="orders-title">Recent orders</h2>
        <div className="bt-table-wrap">
          <table className="bt-table bt-compact">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Villager</th>
                <th scope="col">Order</th>
                <th scope="col">Expected → filled</th>
                <th scope="col">Costs</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {r.recentOrders.length ? (
                r.recentOrders.map((o, i) => (
                  <tr key={i}>
                    <td>{time(o.at)}</td>
                    <th scope="row">{o.name}</th>
                    <td>
                      {o.action} {o.side} {o.coin} · {o.approach === "own" ? "own call" : o.approach}
                    </td>
                    <td>
                      {o.expectedPrice ? formatCoinPrice(o.expectedPrice) : "—"} → {o.fillPrice ? formatCoinPrice(o.fillPrice) : "—"}
                    </td>
                    <td>{o.status === "filled" ? money(-((o.costSats ?? 0) + (o.feeSats ?? 0))) : "—"}</td>
                    <td className="bt-verdict">{o.status === "rejected" ? `Rejected: ${o.reason.replace(/^rejected:\s*/i, "")}` : o.pnlSats != null ? money(o.pnlSats) : "opened"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No orders yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bt-card" aria-labelledby="changes-title">
        <h2 id="changes-title">Strategy changes</h2>
        {r.strategyChanges.length ? (
          <ul className="bt-list">
            {r.strategyChanges.map((c, i) => (
              <li key={i}>
                {time(c.at)} · <strong>{c.name}</strong>: {c.before ? `${c.before.kind} (TP ${c.before.takeProfitPct}% SL ${c.before.stopLossPct}%)` : "no strategy"} →{" "}
                {c.after.kind} (TP {c.after.takeProfitPct}% SL {c.after.stopLossPct}%) — by {c.by}.
              </li>
            ))}
          </ul>
        ) : (
          <p className="bt-note">No changes recorded yet.</p>
        )}
      </section>
    </>
  );
}

function StatsGrid({ s, money }: { s: PaperStats; money: (sats: number | null | undefined) => string }) {
  const items: [string, string][] = [
    ["Days recorded", s.days < 1 ? "under a day" : String(s.days)],
    ["Trades opened", `${s.opens} (${s.opensPerDay == null ? "—" : s.opensPerDay.toFixed(1)} a day)`],
    ["Closed · win rate", `${s.closes} · ${pct(s.winRate, 0)}`],
    ["P&L after costs", money(s.pnl)],
    ["Worst drawdown", s.maxDrawdown ? money(-s.maxDrawdown) : "£0.00"],
    ["Cost per fill", pct(s.avgCostPct, 2)],
    ["Fill vs expected price", pct(s.avgSlipPct, 3)],
    ["Rejected by the exchange", `${s.rejected} (${pct(s.rejectRate, 0)})`],
  ];
  return (
    <dl className="bt-stats bt-stats-wide">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { CORE, CORE_SHARE, describeM, FUNDS, ISA_ALLOWANCE, ISA_START, type FundId, type Isa, type MScore } from "@/game/merchant";
import { getMerchant } from "@/lib/merchant";
import type { MerchantState } from "@/lib/merchant.server";

export const Route = createFileRoute("/isa")({
  loader: () => getMerchant(),
  component: IsaPage,
  head: () => ({ meta: [{ title: "Merchant guild — Ledgerford" }] }),
});

const gbp = (x: number) => `£${x.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);

function IsaPage() {
  const s = Route.useLoaderData() as MerchantState | null;
  return (
    <main className="bt-page isa-page">
      <header className="bt-head">
        <Link to="/" className="bt-back">
          ← Back to Ledgerford
        </Link>
        <h1>The Merchant guild</h1>
        <p className="bt-lede">
          Every merchant in Ledgerford invests the way a stocks &amp; shares ISA can: long-only, in a handful of index funds, checked once a
          week or month. Here is the guild&apos;s lab, and its model ISA of {gbp(ISA_START)} — {Math.round(CORE_SHARE * 100)}% on a well-tested trend rule,
          the rest on the best strategy their lab has proven — and measure it against simply holding shares, and a 60/40 of shares and bonds.
          Pretend money only.
        </p>
      </header>
      {!s ? (
        <section className="bt-card">
          <h2>The guild&apos;s books can&apos;t be read right now</h2>
        </section>
      ) : (
        <>
          <Portfolio isa={s.isa} />
          <Verdict s={s} />
          <Trades isa={s.isa} />
          <About />
        </>
      )}
    </main>
  );
}

function Portfolio({ isa }: { isa?: Isa }) {
  if (!isa || !isa.history.length) {
    return (
      <section className="bt-card">
        <h2>The paper ISA</h2>
        <p className="bt-note">Opens with the first day of prices from the merchant workflow (weekdays after the US close).</p>
      </section>
    );
  }
  const last = isa.history[isa.history.length - 1]!;
  const first = isa.history[0]!;
  const ch = (a: number, b: number) => (b > 0 ? a / b - 1 : 0);
  const holdings = (Object.entries(isa.units) as [FundId, number][])
    .map(([f, u]) => ({ f, value: u * (isa.lastPx?.[f] ?? 0) }))
    .sort((a, b) => b.value - a.value);
  return (
    <section className="bt-card" aria-labelledby="isa-title">
      <h2 id="isa-title">The paper ISA</h2>
      <div className="isa-stats">
        <div className="isa-stat">
          <span className="isa-stat-label">Worth now</span>
          <strong>{gbp(last.v)}</strong>
          <span>{pct(ch(last.v, ISA_START))} since {isa.started}</span>
        </div>
        <div className="isa-stat">
          <span className="isa-stat-label">Holding US shares instead</span>
          <strong>{gbp(last.us)}</strong>
          <span>{pct(ch(last.us, ISA_START))}</span>
        </div>
        <div className="isa-stat">
          <span className="isa-stat-label">A 60/40 instead</span>
          <strong>{gbp(last.sf)}</strong>
          <span>{pct(ch(last.sf, ISA_START))}</span>
        </div>
      </div>
      {isa.history.length > 1 ? <IsaChart h={isa.history} /> : <p className="bt-small bt-muted">The chart starts after the second trading day.</p>}
      <h3>How it&apos;s invested</h3>
      <p className="bt-note">
        {Math.round(CORE_SHARE * 100)}%: {describeM(CORE)}. {Math.round((1 - CORE_SHARE) * 100)}%:{" "}
        {isa.satellite.proven ? `the guild's proven strategy ${isa.satellite.id} — ${isa.satellite.desc}` : "also the core rule, until the lab proves something better"}.
      </p>
      {holdings.length ? (
        <ul className="isa-holdings">
          {holdings.map(({ f, value }) => (
            <li key={f}>
              <strong>{f}</strong> {FUNDS[f].name}: {gbp(value)} ({Math.round((value / last.v) * 100)}%){" "}
              <span className="bt-muted bt-small">· in an ISA: {FUNDS[f].isa}</span>
            </li>
          ))}
          {isa.cash > 1 ? <li>Cash {gbp(isa.cash)}</li> : null}
        </ul>
      ) : (
        <p className="bt-note">All in cash{isa.pending ? " — its first orders fill at the next close" : ""}.</p>
      )}
      {isa.pending ? (
        <p className="bt-small bt-muted">
          Orders decided at the close of {isa.pending.d}, filling at the next close:{" "}
          {Object.entries(isa.pending.w)
            .map(([f, w]) => `${f} ${Math.round((w ?? 0) * 100)}%`)
            .join(", ")}
          .
        </p>
      ) : null}
      <p className="bt-small bt-muted">
        Started {isa.started} with {gbp(ISA_START)}; first day {first.d}. A real ISA allows {gbp(ISA_ALLOWANCE)} of new money a tax year.
      </p>
    </section>
  );
}

/** The paper ISA against its two benchmarks, each indexed to 100 at the start. */
function IsaChart({ h }: { h: Isa["history"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 130;
  const PAD = { l: 34, r: 30, t: 8, b: 16 };
  const series = [
    { key: "v" as const, label: "Paper ISA", cls: "isa-a" },
    { key: "us" as const, label: "US shares", cls: "isa-b" },
    { key: "sf" as const, label: "60/40", cls: "isa-c" },
  ];
  const idx = (k: "v" | "us" | "sf") => h.map((p) => (h[0]![k] > 0 ? (p[k] / h[0]![k]) * 100 : 100));
  const lines = series.map((s) => ({ ...s, pts: idx(s.key) }));
  const all = lines.flatMap((l) => l.pts).concat(100);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const n = h.length;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const path = (pts: number[]) => pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r);
    setHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };
  return (
    <figure className="bt-chart">
      <figcaption className="bt-legend">
        {lines.map((l) => (
          <span key={l.key}>
            <i className={`bt-swatch ${l.cls}-swatch`} /> {l.label}
          </span>
        ))}
        <span className="bt-legend-note">start = 100</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={lines.map((l) => `${l.label} ${l.pts[n - 1]!.toFixed(1)}`).join(", ") + ", all starting at 100"}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[lo, 100, hi].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="bt-grid-line" />
            <text x={PAD.l - 4} y={y(v) + 3} className="bt-axis" textAnchor="end">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {lines
          .slice()
          .reverse()
          .map((l) => (
            <path key={l.key} d={path(l.pts)} className={`isa-line ${l.cls}`} />
          ))}
        {lines.map((l) => (
          <text key={l.key} x={W - PAD.r + 3} y={y(l.pts[n - 1]!) + 3} className="bt-axis">
            {l.pts[n - 1]!.toFixed(0)}
          </text>
        ))}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="bt-cross" />
            <text x={Math.min(x(hover) + 4, W - 150)} y={PAD.t + 10} className="bt-tip">
              {h[hover]!.d} · ISA {lines[0]!.pts[hover]!.toFixed(1)} · US {lines[1]!.pts[hover]!.toFixed(1)} · 60/40 {lines[2]!.pts[hover]!.toFixed(1)}
            </text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}

const cell = (s: MScore) => (
  <>
    {pct(s.cagr)}/yr
    <span className="bt-small bt-muted lab-genes">
      Sharpe {s.sharpe.toFixed(2)} · worst fall {pct(-s.maxDd)}
    </span>
  </>
);

function Verdict({ s }: { s: MerchantState }) {
  const run = s.lastRun;
  return (
    <section className="bt-card" aria-labelledby="verdict-title">
      <h2 id="verdict-title">The guild&apos;s lab</h2>
      {!run ? (
        <p className="bt-note">No lab run yet.</p>
      ) : (
        <>
          <p className="bt-note">
            {run.evaluated} fund strategies tested on daily prices from {run.from} to {run.to}: bred on the first 60%, the champion chosen on the
            next 20%, and judged once on the last 20%. Every trade pays 0.2%. A strategy is proven only if it made money on all three and beat
            60/40&apos;s risk-adjusted return (Sharpe) on both unseen slices.
          </p>
          <div className="bt-table-wrap">
            <table className="bt-table lab-table">
              <caption className="sr-only">The lab's champion and runners-up against the benchmarks</caption>
              <thead>
                <tr>
                  <th scope="col">Strategy</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Training</th>
                  <th scope="col">Validation</th>
                  <th scope="col">Unseen test</th>
                </tr>
              </thead>
              <tbody>
                {run.benchmarks.map((b) => (
                  <tr key={b.name}>
                    <th scope="row">
                      {b.name}
                      <span className="bt-small bt-muted lab-genes">{describeM(b.genome)}</span>
                    </th>
                    <td className="bt-muted">benchmark</td>
                    <td>{cell(b.train)}</td>
                    <td>{cell(b.val)}</td>
                    <td>{cell(b.test)}</td>
                  </tr>
                ))}
                {[run.champion, ...run.runnersUp].filter((e) => !!e).map((e, k) => (
                  <tr key={e!.id}>
                    <th scope="row">
                      {k === 0 ? "Champion" : "Runner-up"} <span className="lab-id">{e!.id}</span>
                      <span className="bt-small bt-muted lab-genes">{describeM(e!)}</span>
                    </th>
                    <td>
                      {e!.proven ? (
                        <span className="rgate rgate-pass lab-verdict">
                          <CheckCircle2 size={16} aria-hidden /> Proven
                        </span>
                      ) : (
                        <span className="rgate rgate-manual lab-verdict">
                          <CircleDashed size={16} aria-hidden /> Not proven
                        </span>
                      )}
                    </td>
                    <td>{cell(e!.train)}</td>
                    <td>{cell(e!.val)}</td>
                    <td>{cell(e!.test)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Trades({ isa }: { isa?: Isa }) {
  if (!isa?.trades.length) return null;
  return (
    <section className="bt-card" aria-labelledby="trades-title">
      <h2 id="trades-title">Recent trades</h2>
      <ul className="lab-history">
        {isa.trades.slice(0, 20).map((t, k) => (
          <li key={k}>
            {t.d}: {t.value >= 0 ? "bought" : "sold"} {gbp(Math.abs(t.value))} of {t.fund} (cost {gbp(t.cost)}) — {t.why}
          </li>
        ))}
      </ul>
    </section>
  );
}

function About() {
  return (
    <section className="bt-card" aria-labelledby="about-title">
      <h2 id="about-title">How it works</h2>
      <ul className="lab-method">
        <li>
          <strong>Real fund prices.</strong> The lab tests on US-listed funds with long histories (back to 2004, dividends included). A real ISA
          would hold the UK-listed (UCITS) version shown next to each; their returns would differ a little, and with the pound.
        </li>
        <li>
          <strong>No peeking.</strong> Decisions are made at a day&apos;s close and filled at the next, as a real order placed after the close
          would be.
        </li>
        <li>
          <strong>What to expect.</strong> Over the long run, roughly what the markets return — some years well ahead of cash, some years down.
          The trend rule aims for smaller falls, not a miracle.
        </li>
        <li>
          <strong>The town and the lab.</strong> The merchants in the town choose from the same strategies, and newcomers and retrained
          merchants are given the lab&apos;s proven ones first.
        </li>
        <li>
          <strong>Next, if it earns it:</strong> the same strategies placing orders on a Trading 212 practice account, then — only if you decide
          — a small real ISA with hard limits.
        </li>
      </ul>
      <p className="bt-small bt-muted">Paper trading only. Not financial advice. Past results never guarantee future ones.</p>
    </section>
  );
}

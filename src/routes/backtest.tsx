import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import type { KindReport } from "@/game/validation";
import { getLatestBacktest } from "@/lib/backtest";
import type { BacktestRun } from "@/lib/backtest.server";

export const Route = createFileRoute("/backtest")({
  loader: () => getLatestBacktest(),
  component: BacktestPage,
  head: () => ({ meta: [{ title: "Strategy backtests — Ledgerford" }] }),
});

const pct = (x: number | null | undefined, digits = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`);
const plain = (x: number | null | undefined, digits = 0) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

function BacktestPage() {
  const run = Route.useLoaderData();
  return (
    <main className="bt-page">
      <header className="bt-head">
        <Link to="/" className="bt-back">
          ← Back to Ledgerford
        </Link>
        <h1>Strategy backtests</h1>
        <p className="bt-lede">
          Every strategy the villagers run, replayed over stored market prices with the same trading code, costs and risk limits as the town.
          Settings are tuned only on earlier data and judged on later data they never saw. Past results don&apos;t predict future ones.
        </p>
      </header>
      {!run ? (
        <section className="bt-card">
          <h2>No backtest yet</h2>
          <p>
            The town records prices every trading tick. Run the <strong>Backtest strategies</strong> workflow in GitHub Actions (it also pulls
            Kraken&apos;s last ~2.5 days of 5-minute candles) and the results appear here.
          </p>
        </section>
      ) : (
        <Report run={run as BacktestRun} />
      )}
    </main>
  );
}

function Report({ run }: { run: BacktestRun }) {
  const r = run.results;
  const btc = r.baselines.btc;
  return (
    <>
      <section className="bt-card bt-meta" aria-label="About this run">
        <dl>
          <div>
            <dt>Data</dt>
            <dd>
              {r.days} days · {r.bars.toLocaleString()} five-minute bars · {r.coins} coins
            </dd>
          </div>
          <div>
            <dt>From → to</dt>
            <dd>
              {when(run.data.from)} → {when(run.data.to)}
            </dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd>
              #{run.id}, {new Date(run.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              <code>{run.version}</code> · data <code>{run.data.fingerprint}</code>
            </dd>
          </div>
        </dl>
        <p className="bt-note">
          Baselines over the same bars: holding cash {pct(0)}; holding Bitcoin {pct(btc?.totalReturn)} (on the unseen last 30%:{" "}
          {pct(r.baselines.btcValidation?.totalReturn)}).
        </p>
      </section>

      <section className="bt-card" aria-label="Summary">
        <h2>On data the strategies never saw</h2>
        <div className="bt-table-wrap">
          <table className="bt-table">
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col">Hold-out return</th>
                <th scope="col">Walk-forward</th>
                <th scope="col">Worst drawdown</th>
                <th scope="col">Trades</th>
                <th scope="col">Win rate</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {r.kinds.map((k) => (
                <tr key={k.kind}>
                  <th scope="row">{k.label}</th>
                  <td className={tone(k.holdout.validation.totalReturn)}>{pct(k.holdout.validation.totalReturn)}</td>
                  <td className={tone(k.walkForward.oosReturn)}>{pct(k.walkForward.oosReturn)}</td>
                  <td>{plain(Math.max(k.holdout.validation.maxDrawdown, k.walkForward.worstDrawdown), 1)}</td>
                  <td>{k.holdout.validation.trades}</td>
                  <td>{plain(k.holdout.validation.winRate)}</td>
                  <td className="bt-verdict">{k.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="bt-grid">
        {r.kinds.map((k) => (
          <KindCard key={k.kind} k={k} btc={r.btcEquity} />
        ))}
      </div>

      <section className="bt-card bt-method" aria-label="How it works">
        <h2>How this is tested</h2>
        <ul>
          <li>
            <strong>No look-ahead.</strong> A decision on a bar sees only prices up to that bar and fills at the next bar&apos;s price.
          </li>
          <li>
            <strong>Real costs.</strong> Every fill pays the 0.4% fee plus an estimated spread and slippage; closing at the end of a test pays too.
          </li>
          <li>
            <strong>Hold-out.</strong> Take-profit and stop-loss are tuned on the first 70% only, then judged once on the last 30%.
          </li>
          <li>
            <strong>Walk-forward.</strong> The data is cut in five; each of the last four parts is judged with settings tuned only on what came
            before it, and the four results are chained.
          </li>
          <li>
            <strong>Sensitivity.</strong> Each strategy is re-run with no costs and double costs, and at every setting on the tuning grid
            (in-sample — to see how fragile it is, never to choose).
          </li>
          <li>
            <strong>Nothing hidden.</strong> Every strategy is shown, including the ones that failed, and every run is kept with its version and a
            fingerprint of its data.
          </li>
        </ul>
      </section>
    </>
  );
}

const tone = (x: number) => (x > 0 ? "tape-up" : x < 0 ? "tape-down" : "");

function KindCard({ k, btc }: { k: KindReport; btc: number[] }) {
  const v = k.holdout.validation;
  return (
    <section className="bt-card bt-kind" aria-label={k.label}>
      <h3>{k.label}</h3>
      <p className="bt-verdict">{k.verdict}</p>
      <EquityChart strategy={k.equity} btc={btc} label={k.label} />
      <dl className="bt-stats">
        <Stat label="Whole period (default settings)" value={pct(k.full.totalReturn)} />
        <Stat label="Max drawdown" value={plain(k.full.maxDrawdown, 1)} />
        <Stat label="Trades · win rate" value={`${k.full.trades} · ${plain(k.full.winRate)}`} />
        <Stat label="Profit factor" value={k.full.profitFactor == null ? "—" : k.full.profitFactor.toFixed(2)} />
        <Stat label="Time in the market" value={plain(k.full.exposure)} />
        <Stat label="Sharpe (annualised)" value={k.full.sharpe == null ? "— (needs 2 weeks)" : k.full.sharpe.toFixed(2)} />
      </dl>
      <h4>Hold-out</h4>
      <p className="bt-small">
        Tuned on the first 70%: take-profit {k.holdout.chosen.tp}%, stop-loss {k.holdout.chosen.sl}% (tuning period {pct(k.holdout.dev.totalReturn)}).
        On the unseen 30%: <strong className={tone(v.totalReturn)}>{pct(v.totalReturn)}</strong> over {v.trades} trades; the untuned defaults made{" "}
        {pct(k.holdout.defaultValidation.totalReturn)}.
      </p>
      <h4>Walk-forward</h4>
      <FoldTable folds={k.walkForward.folds} />
      <h4>Costs</h4>
      <p className="bt-small">
        {k.costSensitivity.map((c) => `${c.costs === 0 ? "no costs" : c.costs === 1 ? "live costs" : "double costs"} ${pct(c.totalReturn)}`).join(" · ")}
      </p>
      <p className="bt-small bt-muted">Stakes shrink after losses (Kelly sizing), so higher costs can mean smaller bets — the runs aren&apos;t strictly ordered.</p>
      <h4>Settings (in-sample)</h4>
      <GridTable k={k} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FoldTable({ folds }: { folds: KindReport["walkForward"]["folds"] }) {
  return (
    <table className="bt-table bt-compact">
      <thead>
        <tr>
          <th scope="col">Part</th>
          <th scope="col">Tuned to</th>
          <th scope="col">Return</th>
          <th scope="col">Trades</th>
        </tr>
      </thead>
      <tbody>
        {folds.map((f, i) => (
          <tr key={f.from}>
            <th scope="row">{i + 2} of 5</th>
            <td>
              TP {f.chosen.tp}% · SL {f.chosen.sl}%
            </td>
            <td className={tone(f.test.totalReturn)}>{pct(f.test.totalReturn)}</td>
            <td>{f.test.trades}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GridTable({ k }: { k: KindReport }) {
  const tps = [...new Set(k.grid.map((g) => g.tp))];
  const sls = [...new Set(k.grid.map((g) => g.sl))];
  const at = (tp: number, sl: number) => k.grid.find((g) => g.tp === tp && g.sl === sl);
  return (
    <table className="bt-table bt-compact" aria-label="Return at each take-profit and stop-loss">
      <thead>
        <tr>
          <th scope="col">TP \ SL</th>
          {sls.map((sl) => (
            <th scope="col" key={sl}>
              {sl}%
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tps.map((tp) => (
          <tr key={tp}>
            <th scope="row">{tp}%</th>
            {sls.map((sl) => {
              const g = at(tp, sl);
              return (
                <td key={sl} className={g ? tone(g.totalReturn) : ""}>
                  {g ? pct(g.totalReturn, 1) : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One strategy's equity against holding Bitcoin, both indexed to 100 at the start. */
function EquityChart({ strategy, btc, label }: { strategy: number[]; btc: number[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const PAD = { l: 34, r: 8, t: 8, b: 16 };
  const idx = (s: number[]) => (s.length && s[0]! > 0 ? s.map((v) => (v / s[0]!) * 100) : []);
  const a = idx(strategy);
  const b = idx(btc);
  const all = [...a, ...b, 100];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number, n: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i, s.length).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const n = Math.max(a.length, b.length);
  const at = (s: number[], i: number) => s[Math.round((i / Math.max(1, n - 1)) * (s.length - 1))];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const f = (px - PAD.l) / (W - PAD.l - PAD.r);
    setHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };
  if (!a.length) return <p className="bt-small">No curve.</p>;
  return (
    <figure className="bt-chart">
      <figcaption className="bt-legend">
        <span>
          <i className="bt-swatch bt-swatch-a" /> {label}
        </span>
        <span>
          <i className="bt-swatch bt-swatch-b" /> Holding Bitcoin
        </span>
        <span className="bt-legend-note">start = 100</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ends at ${a[a.length - 1]!.toFixed(1)} against Bitcoin's ${b.length ? b[b.length - 1]!.toFixed(1) : "—"}, both starting at 100`}
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
        {b.length ? <path d={path(b)} className="bt-line-b" /> : null}
        <path d={path(a)} className="bt-line-a" />
        <circle cx={x(a.length - 1, a.length)} cy={y(a[a.length - 1]!)} r={4} className="bt-dot-a" />
        {hover !== null ? (
          <g>
            <line x1={x(hover, n)} x2={x(hover, n)} y1={PAD.t} y2={H - PAD.b} className="bt-cross" />
            <text x={Math.min(x(hover, n) + 4, W - 90)} y={PAD.t + 10} className="bt-tip">
              {label.split(" ")[0]} {at(a, hover)?.toFixed(1)} · BTC {b.length ? at(b, hover)?.toFixed(1) : "—"}
            </text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}

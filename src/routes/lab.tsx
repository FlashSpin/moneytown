import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { PoolEntry, Score } from "@/game/lab";
import { describe as describeGenome } from "@/game/lab";
import { BAR_LABEL, STRATEGY_INFO } from "@/game/strategies";
import { getLabBook, type LabBook } from "@/lib/lab";

export const Route = createFileRoute("/lab")({
  loader: () => getLabBook(),
  component: LabPage,
  head: () => ({ meta: [{ title: "Strategy lab — Ledgerford" }] }),
});

const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const when = (ms: number) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function LabPage() {
  const book = Route.useLoaderData() as LabBook | null;
  return (
    <main className="bt-page">
      <header className="bt-head">
        <Link to="/" className="bt-back">
          ← Back to Ledgerford
        </Link>
        <h1>Strategy lab</h1>
        <p className="bt-lede">
          Every day the lab breeds thousands of variants of each strategy — on hourly and 4-hour bars, where trading costs matter least — and
          backtests them on three years of real prices with every cost included. The best are adjusted a little and tried again, generation after generation, and each run
          starts from the previous run&apos;s best. What holds up on data it never saw goes into the guild book, and every new villager is trained in
          a slightly adjusted copy of the book&apos;s best — so the newer the villager, the more it has been tested.
        </p>
      </header>
      {!book ? (
        <section className="bt-card">
          <h2>The lab can&apos;t be read right now</h2>
          <p>Try again in a moment.</p>
        </section>
      ) : (
        <>
          <Book book={book} />
          <Runs book={book} />
          <Method />
        </>
      )}
    </main>
  );
}

function Verdict({ e }: { e: PoolEntry }) {
  if (e.retired)
    return (
      <span className="rgate rgate-fail lab-verdict">
        <XCircle size={16} aria-hidden /> Retired
      </span>
    );
  if (e.proven)
    return (
      <span className="rgate rgate-pass lab-verdict">
        <CheckCircle2 size={16} aria-hidden /> Proven
      </span>
    );
  return (
    <span className="rgate rgate-manual lab-verdict">
      <CircleDashed size={16} aria-hidden /> Promising
    </span>
  );
}

const cell = (s: Score) => (
  <>
    {pct(s.ret)}
    <span className="bt-muted bt-small"> · {s.trades} trades</span>
  </>
);

function Book({ book }: { book: LabBook }) {
  const money = (sats: number) => `${sats >= 0 ? "+" : "-"}£${(Math.abs(sats) * book.gbpPerSat).toFixed(2)}`;
  const open = book.pool.filter((e) => !e.retired);
  const proven = open.filter((e) => e.proven).length;
  return (
    <section className="bt-card" aria-labelledby="book-title">
      <h2 id="book-title">The guild book</h2>
      <p className="bt-note">
        {book.pool.length
          ? `${open.length} strategies in the book, ${proven} proven. ${book.runs} lab run${book.runs === 1 ? "" : "s"} so far; the latest ${book.at ? when(book.at) : "—"}.`
          : "Empty so far — it fills when the lab's first run reports. Until then, villagers trade their temperament's usual strategy."}
      </p>
      {book.pool.length > 0 && (
        <div className="bt-table-wrap">
          <table className="bt-table lab-table">
            <caption className="sr-only">Strategies in the guild book, best first</caption>
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col">Verdict</th>
                <th scope="col">Training (60%)</th>
                <th scope="col">Validation (20%)</th>
                <th scope="col">Unseen test (20%)</th>
                <th scope="col">Live paper trades</th>
              </tr>
            </thead>
            <tbody>
              {book.pool.map((e) => (
                <tr key={e.id}>
                  <th scope="row">
                    <strong>
                      {STRATEGY_INFO[e.kind].label}, {BAR_LABEL[e.genes.bar]} bars
                    </strong>
                    <span className="lab-id"> {e.id}</span>
                    <span className="bt-small bt-muted lab-genes">{describeGenome(e)}</span>
                  </th>
                  <td>
                    <Verdict e={e} />
                    {e.retired && <span className="bt-small bt-muted lab-genes">{e.retired}</span>}
                  </td>
                  <td>{cell(e.train)}</td>
                  <td>{cell(e.val)}</td>
                  <td>
                    {cell(e.test)}
                    <span className="bt-small bt-muted lab-genes">win {Math.round(e.test.winRate * 100)}%, worst fall {pct(-e.test.maxDd)}</span>
                  </td>
                  <td>
                    {e.live?.trades ? (
                      <>
                        {e.live.trades} trades, {money(e.live.pnl)}
                        <span className="bt-small bt-muted lab-genes">avg {pct(e.live.sum / e.live.trades, 2)} a trade</span>
                      </>
                    ) : (
                      <span className="bt-muted">none yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function nicheLabel(key: string): string {
  const [kind, bar] = key.split("/");
  const info = STRATEGY_INFO[kind as keyof typeof STRATEGY_INFO];
  const size = BAR_LABEL[Number(bar) as keyof typeof BAR_LABEL];
  return `${info?.label ?? kind} · ${size ?? bar} bars`;
}

function Runs({ book }: { book: LabBook }) {
  const latest = book.history[0];
  return (
    <section className="bt-card" aria-labelledby="runs-title">
      <h2 id="runs-title">Lab runs</h2>
      {!latest ? (
        <p className="bt-note">No runs yet. The lab runs daily on GitHub Actions (or by hand from the Actions tab: “Strategy lab”).</p>
      ) : (
        <>
          <p className="bt-note">
            Latest: {when(new Date(latest.createdAt).getTime())} — {latest.summary.niches?.reduce((n, x) => n + x.evaluated, 0) ?? 0} strategies
            backtested on {latest.summary.data?.coins.length ?? 0} coins (
            {latest.summary.data?.days5 ? `${latest.summary.data.days5} days of 5-minute and ` : ""}
            {latest.summary.data?.daysH ?? "?"} days of hourly candles); {latest.found} kept, {latest.proven} proven.
          </p>
          {latest.summary.market && (
            <p className="bt-note">
              For comparison, over the same unseen test period holding Bitcoin returned {pct(latest.summary.market.btc)}, and holding every coin
              equally {pct(latest.summary.market.basket)}.
            </p>
          )}
          {latest.summary.niches && latest.summary.niches.length > 0 && (
            <div className="bt-table-wrap">
              <table className="bt-table lab-table">
                <caption className="sr-only">Each strategy and bar size in the latest run</caption>
                <thead>
                  <tr>
                    <th scope="col">Strategy and bars</th>
                    <th scope="col">Variants tried</th>
                    <th scope="col">Generations</th>
                    <th scope="col">Usual settings on the unseen test</th>
                    <th scope="col">Champion</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.summary.niches.map((n) => {
                    const base = n.baseline?.test;
                    return (
                      <tr key={n.niche}>
                        <th scope="row">{nicheLabel(n.niche)}</th>
                        <td>{n.evaluated}</td>
                        <td>{n.generations}</td>
                        <td>{base ? cell(base) : "—"}</td>
                        <td>{n.champion ? `${n.champion}${n.proven ? " (proven)" : ""}` : <span className="bt-muted">none held up</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {book.history.length > 1 && (
            <ul className="lab-history">
              {book.history.slice(1).map((r) => (
                <li key={r.id}>
                  {when(new Date(r.createdAt).getTime())}: {r.found} kept, {r.proven} proven
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Method() {
  return (
    <section className="bt-card" aria-labelledby="method-title">
      <h2 id="method-title">How the lab keeps itself honest</h2>
      <ul className="lab-method">
        <li>
          <strong>No peeking.</strong> Prices are split in time: breeding only ever sees the first 60%; the next 20% chooses each strategy&apos;s
          champion; the last 20% is looked at once, for the verdict.
        </li>
        <li>
          <strong>Every cost.</strong> Orders fill at the next bar&apos;s price with the spread, slippage and exchange fee; stops fill where the
          price crossed them (or worse, if it jumped past).
        </li>
        <li>
          <strong>Not luck.</strong> Strategies are scored on the steadiness of their per-trade profit over many trades, not a few big wins, and
          by the worse of the two halves of the training data, so one lucky stretch can&apos;t carry them. “Proven” means money made on all three
          slices with enough trades, the unseen slices together clearly in profit (not by a whisker), and still made with costs 50% higher.
        </li>
        <li>
          <strong>Live results decide.</strong> Many strategies are tried, so one can still pass by chance. Every trade the villagers make with a
          book strategy is tracked; one that loses clearly over 20 live trades is retired.
        </li>
        <li>
          <strong>Tiny adjustments.</strong> A newcomer gets a slightly adjusted copy of a book strategy, so the parish keeps exploring close to what
          works, and the next lab run tests those neighbours properly.
        </li>
      </ul>
      <p className="bt-small bt-muted">
        Paper trading only. Past results — even on unseen data — never guarantee future ones. The King can summon a villager trained in a
        particular book strategy (“summon a breakout trader”), and the councils can put villagers on one by name.
      </p>
    </section>
  );
}

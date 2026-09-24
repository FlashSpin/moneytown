# Running Ledgerford

How the parish keeps running, how to tell when it isn't, and what to do about it.

## The jobs

| Job | Endpoint | Who calls it | How often | Guard |
|---|---|---|---|---|
| Trading tick | `POST /api/trade` (Bearer `CRON_SECRET`) | GitHub Actions `trading.yml`, an external cron, and open pages via the heartbeat | every 5 min | skips if a tick ran < 3 min ago |
| Heartbeat | `POST /api/heartbeat` (public) | every open page, when the last tick is over 6 min old | on demand | ticks only if none for 5.5 min; 20 s throttle per server |
| Strategy review | `POST /api/review` (Bearer) | GitHub Actions `king-review.yml` | every 4 h | skips if < 3 h since the last |
| Dawn | `GET /api/tick` (Bearer) | Vercel Cron (`vercel.json`) | daily 06:00 UTC | skips if < 20 h; a day can only advance once (row must still be on the previous day) |
| Backtest | `POST /api/backtest` (Bearer) | GitHub Actions `backtest.yml` | weekly, or by hand | — |
| Strategy lab | `POST /api/lab` (Bearer) | GitHub Actions `strategy-lab.yml` (main branch only) | daily 04:23 UTC, or by hand | — |

Every run is timed, logged as one JSON line (`trade.start`, `trade.end`, `dawn.end`, …) with a `requestId`,
and stored in `job_runs` (skips aren't stored). Responses carry the same id in `x-request-id`.

### Why there are three ways to trigger a tick

GitHub drops or delays frequent schedules when it's busy — in practice the 5-minute schedule may not fire
at all. So:

1. **Recommended: an external cron.** At [cron-job.org](https://cron-job.org) (free), create a job:
   URL `https://moneytown.vercel.app/api/trade`, every 5 minutes, method `POST`, header
   `Authorization: Bearer <CRON_SECRET>` (the same value as in Vercel), and `x-source: cron-job`.
2. GitHub Actions `trading.yml` stays as a backup.
3. **The heartbeat** keeps the parish trading whenever someone has it open, even if both of the above fail.

The guards make all three safe together: the parish never trades more than once per gap.

## Monitoring and alerts

- **Health:** `GET /api/health` → `{ status: ok | degraded | down, problems[], db, world, jobs }`.
  It answers **200** when healthy and **503** otherwise (`?soft=1` always 200). It is degraded when:
  no trading tick for 15 min, no review for 6 h, no dawn for 26 h, trading halted, the books don't
  reconcile, no market prices, or any job failed in the last hour.
- **Alerting:** point a free uptime monitor (e.g. UptimeRobot, every 5 min) at `/api/health` and alert on
  anything but 200. The `problems` list says what's wrong.
- **Job history:** `/api/health` includes, per job over 24 h: runs, failures, last run and outcome, last
  error, p50/p95 duration, and what triggered them (`cron`, `heartbeat`, `cron-job`, …). A healthy day has
  about 288 trading ticks.
- **Logs:** Vercel → project → Logs; filter by `event` or a `requestId` from a response.
- **The books:** `GET /api/ledger` rebuilds every balance from the ledger and reconciles it; the Overview
  tab shows the latest check.

## When something goes wrong

**Stop all new trading at once.** Present the royal seal and tell the King "halt trading" (resume with
"resume trading"), or set `TRADING_HALT=1` in Vercel and redeploy. Open trades are still watched and closed
by their stops; nothing new opens.

**The books don't reconcile.** The trading tick halts itself and the Overview shows it. Look at
`/api/ledger` → `reconciliation.diffs` (which accounts differ, by how much) and `unbalancedEvents` (should
be empty). Ledger rows are append-only (a database trigger refuses edits), so fix the cause, not the rows;
the halt is lifted only by the seal-bearer ("resume trading").

**No trading ticks.** Check `/api/health` → `jobs.trade`: no runs means nothing is calling it (set up the
external cron); failures carry `lastError`. A `409 world kept changing` now and then is a harmless race; a
steady stream is not.

**The AI isn't answering.** `/api/trade` returns `desk.why` with each provider's last error (quota, bad
key, overload); the King's audience shows provider status to the seal-bearer. The strategies trade without
the AI; only the desk and councils go quiet.

**Market data outage.** The tape goes dark, nobody trades, and the parish carries on when prices return.
Implausible jumps (> 25% in a tick) are held back until confirmed.

**A bad deploy.** In Vercel → Deployments, promote the previous deployment (instant rollback). Database
migrations only ever add tables, columns and indexes, so rolling the code back is safe.

## Backups and recovery

- The database is Neon Postgres: use its point-in-time restore (branch from a moment before the incident),
  check the branch with `/api/health` and `/api/ledger`, then point `DATABASE_URL` at it. The restore window
  depends on the Neon plan.
- Everything that matters lives in three tables: `world_state` (one row), `ledger_entries` (append-only),
  `price_history`. `backtest_runs` and `job_runs` are records, not state.
- For an independent copy, export periodically: `pg_dump --table=world_state --table=ledger_entries "$DATABASE_URL" > backup.sql`.

## Retention

| Data | Kept | Where it's pruned |
|---|---|---|
| `price_history` | 90 days | dawn |
| `job_runs` | 30 days | dawn |
| `ledger_entries` | forever (append-only; ~400 rows a day at full trading) | — |
| `backtest_runs` | forever (a few per week) | — |
| `lab_runs` | forever (one a day) | — |
| guild book (`state.lab.pool`) | best 40; a genome not found again for 21 days and never traded live leaves | each lab run |
| `paper_orders` | 1 year | dawn |
| `strategy_changes` | forever (a few per review) | — |
| trading floor / chronicle in the world | last 60 fills / 80 entries | every save |

## Performance notes

- The page polls the world once a minute, and not at all while its tab is hidden (it refreshes the moment
  it's shown again). The world sent to the browser leaves out the price history and postings.
- The client bundle is ~127 kB gzipped; the backtest page is its own chunk.
- A trading tick is one world read (world + ledger balances in a single statement), one Kraken ticker call
  (cached 15 s), at most one free AI call when the desk is due, and one atomic save.

## Operator controls

| Control | How | Effect |
|---|---|---|
| Halt all trading | Seal: "halt trading" · or env `TRADING_HALT=1` | No new trades open; open ones are still managed and closed by their stops. |
| Resume | Seal: "resume trading" · remove `TRADING_HALT` | Lifts a halt, including one set by a failed ledger check. |
| Pause one strategy | Seal: "pause the scalp strategy" | That strategy opens nothing; the villager's own desk calls and other strategies carry on. "resume scalp" lifts it. |
| Switch off the AI desk | env `TRADING_DESK=off` | Strategies trade alone; no desk AI calls. |
| Switch off a data source | env `DISABLE_SOURCES=coingecko,trending` (any of kraken, coingecko, trending, feargreed, coinbase) | That source isn't called; prices come from the rest, or the tape goes dark and nobody trades. |

Env changes take effect on the next deploy (Vercel → Settings → Environment Variables → redeploy).

## Security

**Who can do what.** The site has one shared town and no accounts. Anyone can watch and petition the King
(rate-limited, capped per day). The **royal seal** (`KING_SEAL`) is the owner's key: banish, tax, favoured
coin, strategies, halt and pause. The **scheduler secret** (`CRON_SECRET`) is for `/api/trade`, `/api/tick`,
`/api/review` and `POST /api/backtest`. Public read-only endpoints: `/api/health`, `/api/ledger`,
`GET /api/backtest`, and `POST /api/heartbeat` (can only run a trading tick that is already due).

**How they're checked.** Both secrets are compared in constant time. The seal passphrase is typed once; the
browser keeps a signed token that expires after 30 days (never the passphrase). Wrong guesses at the
passphrase are recorded (by a salted hash of the caller's address) and lock that address out after 10 in an
hour, or everyone after 100 in ten minutes; an owner with a token is unaffected.

**Secrets.** They live only in Vercel's environment and the `CRON_SECRET` repository secret — never in code,
chat or the browser. Log lines are scrubbed of every secret's value. Use a seal of 16+ random characters.

**Headers.** Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`Permissions-Policy` and `Strict-Transport-Security`. There is no frame-blocking header, because the app is
shown inside the builder's preview.

**Checks on every pull request** (`.github/workflows/ci.yml`): typecheck, lint, the app's tests, a production
build, and `npm audit` (high/critical in production dependencies fail). Turn on GitHub's secret scanning and
Dependabot alerts in the repository settings as well.

### Rotating a secret

- **Royal seal:** set a new `KING_SEAL` in Vercel and redeploy. Every seal token is void at once; present
  the new passphrase again.
- **Scheduler secret:** set a new `CRON_SECRET` in Vercel **and** the GitHub repository secret **and** any
  external cron, then redeploy.
- **AI keys:** create a new key with the provider, replace it in Vercel, redeploy, then delete the old key at
  the provider.
- **Database:** reset the password in Neon, update `DATABASE_URL` in Vercel, redeploy.

### If you suspect a leak or an attack

1. Halt trading (seal or `TRADING_HALT=1`).
2. Rotate the secret that may have leaked (above).
3. Check `/api/ledger` (books reconcile? any unbalanced events?) and `/api/health` (failures, triggers).
4. Search the Vercel logs for `seal.wrong_guess`, `401`s and unusual `requestId`s.
5. If the world was changed wrongly, restore from Neon's point-in-time history (see Backups).
6. Resume trading once the cause is fixed.

### Before any real money

This is a paper-trading game. A real exchange connection would need its own review first — see
`docs/real-money-kraken.md`: a key with trade-only permission (**never withdrawal**), an IP allow-list,
kept only on the server, and separate from the game.

## How the parish tries to win

Every lab run showed the same thing: trading costs (about 0.95% a round trip at market) sink short-term
strategies, and nearly every coin moves with Bitcoin. So:

- **Slow bars.** Strategies trade hourly (or 4-hour) bars. A villager whose strategy still had 5-minute
  defaults is moved onto hourly defaults automatically (`slowed`); a new kind starts there too. The AI may not
  set a take-profit under 2% or a stop under 1%.
- **Cheaper fills.** A take-profit rests on the book at its target: it fills there, at the maker fee (0.25%
  instead of 0.40%), with no spread. With the `entry` gene a strategy also enters with a resting limit order at
  the signal's price, filled only if the price trades through it and cancelled (free) after one bar. The
  backtest treats a limit fill cautiously: only a trade *through* the price fills it, and if that bar also hit
  the stop, the trade is stopped out.
- **Bitcoin's trend.** With the `regime` gene (on by default), a strategy buys only while Bitcoin is above its
  7-day average and shorts only below it. In a falling market, cash is a position.
- **Rotation.** A strategy that holds the market's leader by return over a few days and moves on when it falls
  out of the top few — the one pattern in crypto with a long record, and it trades rarely.
- **The desk on probation.** When the villagers' own calls at the trading desk have lost money over 20+
  trades, the desk looks only every two hours and a call needs a 15-point edge instead of 8.
- **Spread, retrain, retire.** Newcomers are spread across the book's kinds (a crowded kind is picked less). At
  dawn, a villager losing money over 10+ trades since its last training, or on a retired or fast-bar guild
  strategy, is retrained in a book strategy. A book strategy losing clearly over 20 live trades is retired.

- **Size by evidence.** Full Kelly sizing only for a villager on a guild strategy that made money on data it
  never saw (proven, or in profit on validation and test). Anything else risks at most 1% of its purse per
  trade, so a parish with no working strategy loses little while it learns.

None of this guarantees profit. The lab and the live paper record say whether it's working.

## The strategy lab

`.github/workflows/strategy-lab.yml` runs `scripts/strategy-lab.ts` on GitHub's runners (they can reach the
exchanges): it fetches three years of hourly candles from Coinbase (Kraken if a coin isn't listed) for 30
coins, and breeds every strategy kind on hourly and 4-hour bars (`src/game/lab.ts`): random variants plus the
guild book's current genomes, kept, mutated a little and crossed for up to 40 generations, within a 30-minute
budget, on four cores. A genome is scored by the worse of the two halves of its training data, so it has to
work in both. Genes include the bar size, windows, trigger, trend filter, trailing stop, hold, Bitcoin's trend
(`regime`) and limit entries (`entry`) — the lab decides which help.

- **Selection is out of sample.** Breeding sees the first 60% of the data; the next 20% picks each niche's
  champion; the last 20% is looked at once. *Proven* = money made on all three with enough trades, a profit
  factor above 1, validation and test together clearly positive (t ≥ 1.5), and still with costs 50% higher.
  The job summary prints every niche's champion next to the usual settings.
- **The guild book** (`/lab`, `GET /api/lab`) keeps the best 40. New villagers (dawn and the King's summons) are
  trained in a slightly adjusted copy of a book genome, better-ranked ones more often (`summonAs` lets a
  petition ask for a kind or a genome). The councils see the book and may move a villager onto a genome by id;
  a villager on a book genome keeps its genes and targets unless it changes kind or genome.
- **Live results feed back.** Every close from a book strategy adds to that genome's live record; after 20
  live trades a genome losing clearly is retired and never drawn again. The next lab run starts from the book.
- **Longer bars live.** The ticks keep 10 days of hourly closes per coin (`ticks.h`); hourly and 4-hour
  strategies trade on finished bars only. Missing history is filled from Kraken's hourly candles, three coins a
  tick, Bitcoin first.
- **Running it by hand:** Actions → Strategy lab → Run workflow (minutes, post = 1). Pushes to the lab's files
  on the working branch run it without posting, to try changes on real data.

## The Merchant guild (paper ISA)

`.github/workflows/merchant.yml` runs `scripts/merchant-lab.ts` after the US close on weekdays: it fetches every
fund's full daily history (Yahoo, dividends included; Stooq as a fallback), breeds long-only fund strategies
(`src/game/merchant.ts`: hold, trend, momentum; weekly to quarterly) and judges them on ~21 years: bred on the
first 60%, the champion chosen on the next 20%, judged once on the last 20%, every trade paying 0.2%. *Proven*
= money made on all three and a better Sharpe than 60/40 on both unseen slices.

On the main branch it posts the last 400 days of prices and the verdict to `POST /api/merchant` (Bearer
`CRON_SECRET`); the paper ISA (£10,000, 80% the core trend rule, 20% the guild's best proven strategy or the core
rule) steps through every new trading day: decisions at a close, filled at the next. `/isa` and
`GET /api/merchant` show it against holding US shares and a 60/40. Stored in `daily_prices`, `merchant_state`
(one row) and `merchant_runs`. The lab tests US-listed proxies with long histories; a real ISA would hold the
UK-listed (UCITS) funds named next to each.

## Paper trading and the gates before real money

Every order the villagers send — filled or rejected by the (simulated) exchange — is stored in
`paper_orders` with the price expected, the price filled, costs, P&L and the price one tick later; every
change of strategy is stored in `strategy_changes` with who made it (the dawn council, a review, a royal
decree). Both are written in the same statement as the world.

`/paper` (and `GET /api/paper`) shows paper results for the whole parish and per strategy (trades a day,
win rate, P&L, cost per fill, fill against the expected price, rejections, follow-through), where they
differ from the latest backtest (pace, cost per fill, win rate — once a strategy has 10 closed trades), the
recent orders and the strategy change log.

It also runs the gates before any real money. **All** must pass, and even then it is a person's decision —
nothing switches automatically:

1. The schedule runs reliably — 95% of expected trading ticks over 7 days.
2. The books always reconcile — no ledger mismatch in 30 days.
3. Risk controls enforced on the server.
4. Realistic execution.
5. A strategy survives unseen data — the latest backtest shows one making money on the hold-out and in
   walk-forward, with 10+ trades.
6. 30 days of profitable paper trading, with the worst drawdown under 20% of the parish.
7. Paper trading matches the backtest — enough trades, and no unexplained differences.
8. Security review, 9. monitoring and alerts, 10. legal and regulatory assessment — signed off by the owner
   setting `READINESS_SECURITY_REVIEW`, `READINESS_MONITORING` and `READINESS_LEGAL` (e.g. a date and a name)
   in Vercel. Set them only once the work is actually done.

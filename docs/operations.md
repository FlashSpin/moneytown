# Running Ledgerford

How the Merchant guild keeps running, how to tell when it isn't, and what to do about it.

## What the town is

Every villager is a merchant with a paper stocks & shares ISA of index funds (`src/game/guild.ts`): long only,
never borrowing, ten US-listed funds standing in for their UK-listed (UCITS) equivalents. Money is in integer
pence. A merchant's strategy (a preset, or a genome from the guild's lab book) decides its target mix of funds
at a market day's close; the orders fill at the next close, paying 0.2% on every pound traded. Everyone is
judged against a plain 60/40 of shares and bonds over the same days.

## The jobs

| Job | Endpoint | Who calls it | How often | Guard |
|---|---|---|---|---|
| Market day | `POST /api/merchant` (Bearer `CRON_SECRET`) | GitHub Actions `merchant.yml` (main branch only) | weekdays 22:15 UTC, after the US close, or by hand | each close is stepped once (`lastMarketDay`); the save only lands if the world hasn't changed |
| Dawn | `GET /api/tick` (Bearer) | Vercel Cron (`vercel.json`) | daily 06:00 UTC | skips if < 20 h; a day can only advance once |

**The market day** (`src/lib/merchant.server.ts` → `src/game/market-day.ts`): the workflow fetches every fund's
daily closes (Yahoo, dividends included; Stooq as a fallback), runs the lab, and posts the last 400 days of
prices with the verdict. The app stores the prices, updates the lab book, then for every new close: fills each
merchant's pending orders, posts every fill to the ledger, values every ISA, lets each strategy decide its next
orders, and moves the market board and the 60/40 index on. A first post steps only the latest close.

**Dawn** (`src/game/tick.server.ts`) keeps the calendar: the gallows for any ISA below half its stake (sold up,
the money to the treasury), the season (every 28 days: the guild wins if it grew more than the 60/40, and each
merchant pays the guild's dues on its season gain), retraining for merchants 5+ points behind the 60/40 after
60 market days, new merchants staked £1,000 by the treasury's fixed rule, and a council every 7 days where the
King advises and each merchant chooses its strategy.

Every run is timed, logged as one JSON line with a `requestId`, and stored in `job_runs`. Responses carry the
same id in `x-request-id`.

**Re-founding.** A world saved before the guild (the crypto era) is converted the first time it is loaded: its
books are closed back to `genesis`, the treasury opens at £50,000, and every living villager keeps its name
and face but starts afresh with a £1,000 ISA and its temperament's strategy.

## Monitoring and alerts

- **Health:** `GET /api/health` → `{ status: ok | degraded | down, problems[], db, world, jobs }`.
  It answers **200** when healthy and **503** otherwise (`?soft=1` always 200). It is degraded when: no market
  day for 4 days (a long weekend is fine), no dawn for 26 h, orders halted, the books don't reconcile, or any
  job failed in the last hour.
- **Alerting:** point a free uptime monitor (e.g. UptimeRobot) at `/api/health` and alert on anything but 200.
- **Logs:** Vercel → project → Logs; filter by `event` or a `requestId`. The workflow's job summary shows the
  lab's verdict each night.
- **The books:** `GET /api/ledger` rebuilds every balance from the ledger and reconciles it; the Overview tab
  shows the latest check.

## When something goes wrong

**Stop all orders at once.** Present the royal seal and tell the King "halt trading" (resume with "resume
trading"). While halted, ISAs are still valued at every close; nothing is bought or sold.

**The books don't reconcile.** The next market day halts orders itself and the Overview shows it. Look at
`/api/ledger` → `reconciliation.diffs` and `unbalancedEvents` (should be empty). Ledger rows are append-only (a
database trigger refuses edits), so fix the cause, not the rows; only the seal-bearer lifts the halt.

**No market days.** Check the Actions tab for the Merchant guild workflow: a failed fetch (Yahoo and Stooq both
down) posts nothing, and the next night catches up on every missed close. Check that the `CRON_SECRET`
repository secret matches Vercel's. A `409 world kept changing` now and then is a harmless race.

**The AI isn't answering.** The councils fall back to a plain heuristic in period English; strategies keep
investing without the AI.

**A bad deploy.** In Vercel → Deployments, promote the previous deployment. Migrations only ever add tables,
columns and indexes, so rolling the code back is safe.

## Backups and recovery

- The database is Neon Postgres: use its point-in-time restore, check the branch with `/api/health` and
  `/api/ledger`, then point `DATABASE_URL` at it.
- The state that matters: `world_state` (one row), `ledger_entries` (append-only), `daily_prices` and
  `merchant_state` (the model ISA and the lab book). `merchant_runs` and `job_runs` are records. Tables from the
  crypto era (`price_history`, `backtest_runs`, `lab_runs`, `paper_orders`, `strategy_changes`) are no longer
  written.
- For an independent copy: `pg_dump --table=world_state --table=ledger_entries "$DATABASE_URL" > backup.sql`.

## Retention

| Data | Kept | Where it's pruned |
|---|---|---|
| `job_runs` | 30 days | dawn |
| `ledger_entries` | forever (append-only; a few dozen rows a market day) | — |
| `daily_prices` | forever (one row per fund per trading day, ~2,500 a year) | — |
| `merchant_runs` | forever (one a weekday) | — |
| order history / chronicle in the world | last 60 fills / 80 entries | every save |

## Operator controls

| Control | How | Effect |
|---|---|---|
| Halt orders | Seal: "halt trading" | Nothing is bought or sold; ISAs are still valued. |
| Resume | Seal: "resume trading" | Lifts a halt, including one set by a failed ledger check. |
| Set a strategy | Seal: "give Agnes the trend strategy" | That merchant switches at its next decision. |
| Dues | Seal: "set the dues to 10%" | 0–30% of each merchant's season gain. |
| Summon / banish | Seal: "summon two merchants" / "banish Hugh" | A banished merchant's ISA is sold and returned to the treasury. |

## Security

**Who can do what.** The site has one shared town and no accounts. Anyone can watch and petition the King
(rate-limited, capped per day). The **royal seal** (`KING_SEAL`) is the owner's key: banish, dues, the
favoured fund, strategies and halting. The **scheduler secret** (`CRON_SECRET`) is for `/api/tick` and
`POST /api/merchant`. Public read-only endpoints: `/api/health`, `/api/ledger`, `GET /api/merchant`.

**How they're checked.** Both secrets are compared in constant time. The seal passphrase is typed once; the
browser keeps a signed token that expires after 30 days. Wrong guesses lock the caller's address out after 10
in an hour, or everyone after 100 in ten minutes.

**Secrets** live only in Vercel's environment and the `CRON_SECRET` repository secret — never in code, chat or
the browser. Log lines are scrubbed of every secret's value.

**Checks on every pull request** (`.github/workflows/ci.yml`): typecheck, lint, the app's tests, a production
build, and `npm audit`.

### Rotating a secret

- **Royal seal:** set a new `KING_SEAL` in Vercel and redeploy.
- **Scheduler secret:** set a new `CRON_SECRET` in Vercel **and** the GitHub repository secret, then redeploy.
- **AI keys / database:** replace in Vercel and redeploy, then revoke the old one.

## The guild's lab

`scripts/merchant-lab.ts` (run by `merchant.yml`) breeds long-only fund strategies (`src/game/merchant.ts`:
hold, trend, momentum; rebalanced weekly to quarterly) on ~21 years of daily prices: bred on the first 60%, the
champion chosen on the next 20%, judged once on the last 20%, every trade paying 0.2%. *Proven* = money made on
all three slices and a better Sharpe than a 60/40 on both unseen ones. The book feeds the town: newcomers and
retrained merchants are given a proven strategy first, and councils may move a merchant onto one by id.

`/isa` shows the lab's verdict and the model ISA (£10,000: 80% the core trend rule, 20% the best proven
strategy) against holding US shares and a 60/40. Pushes to the lab's files on the working branch run it without
posting, to try changes on real data.

## Before any real money

This is a paper game. Connecting a real Trading 212 stocks & shares ISA would need its own review first: an API
key limited to orders (never withdrawals), kept only on the server; a practice account for months first; hard
limits on order size and on how often a strategy may change; and the owner's explicit decision. Not financial
advice; past results never guarantee future ones.

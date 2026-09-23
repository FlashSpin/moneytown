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
| trading floor / chronicle in the world | last 60 fills / 80 entries | every save |

## Performance notes

- The page polls the world once a minute, and not at all while its tab is hidden (it refreshes the moment
  it's shown again). The world sent to the browser leaves out the price history and postings.
- The client bundle is ~127 kB gzipped; the backtest page is its own chunk.
- A trading tick is one world read (world + ledger balances in a single statement), one Kraken ticker call
  (cached 15 s), at most one free AI call when the desk is due, and one atomic save.

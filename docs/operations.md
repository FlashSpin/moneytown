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

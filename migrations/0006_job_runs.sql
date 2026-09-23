-- Every scheduled job run (trading tick, dawn, review, backtest, heartbeat):
-- when it ran, how long it took, how it ended, and a short summary. The
-- health check (/api/health) reads it for completion rates and failures.
-- Kept for 30 days.
create table if not exists job_runs (
  id bigserial primary key,
  kind text not null,
  source text not null default 'cron',
  request_id text not null,
  started_at timestamptz not null default now(),
  duration_ms integer not null,
  outcome text not null check (outcome in ('ok', 'skipped', 'failed')),
  error text,
  summary jsonb
);

create index if not exists job_runs_kind_started on job_runs (kind, started_at desc);

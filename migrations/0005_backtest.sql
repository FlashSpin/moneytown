-- Price history for backtesting (src/game/backtest.ts): one price per coin
-- per trading tick, written by /api/trade, plus Kraken's 5-minute candles
-- backfilled by /api/backtest. Kept for 90 days.
create table if not exists price_history (
  coin text not null,
  t timestamptz not null,
  price double precision not null check (price > 0),
  source text not null default 'tick',
  primary key (coin, t)
);

create index if not exists price_history_t on price_history (t);

-- Every backtest run, kept whole: the strategy version and settings, which
-- data it saw, and every result — failed strategies included.
create table if not exists backtest_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  version text not null,
  config jsonb not null,
  data jsonb not null,
  results jsonb not null
);

create index if not exists backtest_runs_created on backtest_runs (created_at desc);

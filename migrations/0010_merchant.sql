-- The Merchant guild (src/game/merchant.ts): daily fund prices posted by the
-- merchant workflow (the latest window is re-posted each day, since adjusted
-- closes are revised when dividends are paid), the paper ISA and the guild's
-- book of strategies (one row), and the lab's runs.
create table if not exists daily_prices (
  fund text not null,
  day date not null,
  close double precision not null,
  primary key (fund, day)
);

create table if not exists merchant_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists merchant_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  summary jsonb not null
);

create index if not exists merchant_runs_created_at on merchant_runs (created_at desc);

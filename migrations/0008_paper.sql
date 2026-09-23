-- Paper trading records (src/game/paper.ts): every order the villagers sent
-- to the (simulated) exchange — filled or rejected — with the price they
-- expected, the price they got, what it cost, and the price one tick later;
-- and every change of a villager's strategy, with who made it. Both are
-- written in the same statement that saves the world.
create table if not exists paper_orders (
  id bigserial primary key,
  at timestamptz not null,
  day integer not null,
  villager_id text not null,
  name text not null,
  approach text not null,
  coin text not null,
  side text not null,
  action text not null check (action in ('open', 'close')),
  status text not null check (status in ('filled', 'rejected')),
  stake bigint not null,
  expected_price double precision,
  fill_price double precision,
  cost_sats bigint,
  fee_sats bigint,
  pnl_sats bigint,
  reason text,
  next_price double precision
);

create index if not exists paper_orders_at on paper_orders (at);
create index if not exists paper_orders_approach_at on paper_orders (approach, at);

create table if not exists strategy_changes (
  id bigserial primary key,
  at timestamptz not null,
  day integer not null,
  villager_id text not null,
  name text not null,
  by text not null,
  before jsonb,
  after jsonb not null
);

create index if not exists strategy_changes_at on strategy_changes (at);

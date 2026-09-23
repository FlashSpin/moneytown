-- The parish ledger: every movement of money as double-entry postings
-- (src/game/ledger.ts). Append-only: rows are written in the same statement
-- that saves the world (src/lib/world.server.ts), never updated or deleted,
-- so every purse can be rebuilt from them and checked against the world.

create table if not exists ledger_entries (
  id bigserial primary key,
  event text not null,
  seq integer not null,
  at timestamptz not null,
  day integer not null,
  account text not null,
  amount bigint not null,
  kind text not null,
  coin text,
  memo text,
  recorded_at timestamptz not null default now(),
  unique (event, seq)
);

create index if not exists ledger_entries_account on ledger_entries (account);
create index if not exists ledger_entries_at on ledger_entries (at);

create or replace function ledger_entries_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only';
end;
$$;

drop trigger if exists ledger_entries_no_change on ledger_entries;
create trigger ledger_entries_no_change
  before update or delete on ledger_entries
  for each row execute function ledger_entries_append_only();

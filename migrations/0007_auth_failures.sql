-- Failed guesses at the royal seal, by a hash of the caller's address (never
-- the address itself), so the lockout holds across every server instance.
-- Rows older than a day are dropped as new ones arrive.
create table if not exists auth_failures (
  id bigserial primary key,
  key text not null,
  at timestamptz not null default now()
);

create index if not exists auth_failures_key_at on auth_failures (key, at);
create index if not exists auth_failures_at on auth_failures (at);

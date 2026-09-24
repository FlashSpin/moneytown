-- Strategy lab runs (scripts/strategy-lab.ts, posted to /api/lab): what each
-- run tried and found. The guild book itself — the genomes new villagers are
-- trained in, with their live results — lives in the world (state.lab).
create table if not exists lab_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  summary jsonb not null,
  found jsonb not null
);

create index if not exists lab_runs_created_at on lab_runs (created_at desc);

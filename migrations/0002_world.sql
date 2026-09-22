-- Shared, server-authoritative world state for the daily AI trading
-- simulation. One row only (id='default') — advanced once a day by
-- /api/tick (Vercel Cron), read by every visitor via the getWorldState
-- server function. See src/game/tick.server.ts for what advances it and
-- src/game/world.ts for the shape this seed mirrors.

create table if not exists world_state (
  id text primary key default 'default',
  day integer not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seeded a day in the past, not "now" — otherwise /api/tick's idempotency
-- guard would skip the very first tick right after this migration runs,
-- including the manual verification call in the deploy checklist.
insert into world_state (id, day, state, updated_at)
values (
  'default',
  0,
  '{
    "day": 0,
    "exchequer": 300000,
    "king": {
      "name": "His Majesty",
      "wallet": "bc1qledgerfordkingwatchonlyaddr0000",
      "balance": 300000,
      "x": 900, "y": 310, "destX": 900, "destY": 310,
      "dir": "down", "frame": 0, "frameT": 0,
      "lastAction": "hold",
      "lastFlavor": "The King waits upon the parish. His treasury opens new souls while the parish trades.",
      "favorAsset": "BTC"
    },
    "subjects": [],
    "taxRate": 0.2,
    "tape": {
      "btcUsd": 100000, "btcGbp": 74000, "change24h": 0,
      "fearGreed": 50, "fearGreedLabel": "Neutral",
      "dark": true, "source": "dark", "fetchedAt": 0,
      "assets": {
        "BTC": {"usd": 100000, "change24h": 0},
        "ETH": {"usd": 0, "change24h": 0},
        "SOL": {"usd": 0, "change24h": 0}
      }
    },
    "log": [
      {"id": "l-open", "day": 0, "text": "The parish of Ledgerford is founded. The King''s treasury will open souls and link them to trading agents.", "kind": "system"}
    ],
    "seed": 42,
    "brain": {"kind": "heuristic", "label": "Heuristic (period English)"},
    "speech": []
  }'::jsonb,
  now() - interval '1 day'
)
on conflict (id) do nothing;

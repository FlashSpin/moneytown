-- Optimistic-concurrency revision for world_state. Petitions to the King
-- write mid-day, so two simultaneous summons must not both spend the same
-- treasury: a petition saves only if `rev` is unchanged since it read the row.
-- Petitions deliberately leave updated_at alone — /api/tick's once-a-day
-- guard keys off it.
alter table world_state add column if not exists rev integer not null default 0;

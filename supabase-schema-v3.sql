-- Run this once in the Supabase SQL editor, AFTER supabase-schema-v2.sql.
-- Adds free-drag positioning + per-node lock for checkpoints on the mind map.
-- pos_x/pos_y are null until a checkpoint is manually dragged at least once
-- (until then it keeps using the auto-computed radial layout); locked
-- prevents further dragging once the user is happy with a position.

alter table checkpoints add column if not exists pos_x double precision;
alter table checkpoints add column if not exists pos_y double precision;
alter table checkpoints add column if not exists locked boolean not null default false;

-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- for the mind-map tracker app. Requires Email auth provider enabled (default).

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references checkpoints(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  assignee text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table project_team (
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  primary key (project_id, name)
);

alter table projects enable row level security;
alter table checkpoints enable row level security;
alter table project_team enable row level security;

-- Any logged-in user can read/write everything (shared workspace, gated only by login).
create policy "auth full access" on projects for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on checkpoints for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on project_team for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Enable Realtime so the app updates live instead of only polling.
alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table checkpoints;

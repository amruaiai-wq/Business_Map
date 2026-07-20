-- Run this once in the Supabase SQL editor, AFTER supabase-schema.sql.
-- Replaces the "any logged-in user sees everything" policies with real
-- per-project access control: only the project owner (created_by) and
-- explicitly-invited teammates (project_team.name, which is an email)
-- can see or edit a project's data.
-- Also adds checkpoints.doc_url for the Google Sheet/Doc link field.
--
-- IMPORTANT: this file is safe to re-run even if an earlier version was
-- already applied (all drops use "if exists", functions use "or replace").
--
-- Two bugs were found and fixed while testing this migration live:
-- 1. "infinite recursion detected in policy for relation projects" — the
--    projects policy queried project_team, whose own policy queried
--    projects right back. Fixed with a SECURITY DEFINER helper function
--    for the project_team lookup, which bypasses RLS internally instead
--    of re-triggering it.
-- 2. INSERT ... RETURNING (what every insert from the app does) failed
--    with "new row violates row-level security policy for table projects"
--    even though the INSERT's own WITH CHECK passed. Cause: the owner
--    check went through a helper function that re-queried projects for
--    the very row being inserted in that same statement, which is an
--    unreliable self-reference. Fixed by making the owner check a plain
--    "created_by = auth.uid()" column comparison directly in the policy
--    (no function, no subquery) — that's always immediately visible for
--    the row being evaluated. The helper function is now only used for
--    the project_team cross-table lookup, which never references
--    projects or checkpoints, so it can't recurse or hit this either.

drop policy if exists "auth full access" on projects;
drop policy if exists "auth full access" on checkpoints;
drop policy if exists "auth full access" on project_team;
drop policy if exists "owner or team can select projects" on projects;
drop policy if exists "owner can insert projects" on projects;
drop policy if exists "owner can update projects" on projects;
drop policy if exists "owner can delete projects" on projects;
drop policy if exists "owner or team can access checkpoints" on checkpoints;
drop policy if exists "owner or team can select team" on project_team;
drop policy if exists "owner manages team insert" on project_team;
drop policy if exists "owner manages team delete" on project_team;

-- Only ever touches project_team — never projects or checkpoints — so it
-- cannot participate in a policy recursion cycle no matter which table
-- calls it, and it never needs to reason about a row from its own table
-- being inserted in the same statement.
create or replace function public.is_shared_with_me(pid uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from project_team pt
    where pt.project_id = pid and lower(pt.name) = lower(auth.jwt()->>'email')
  );
$$;

-- projects: owner (plain column check, no function) or invited teammate can read; only the owner can write
create policy "owner or team can select projects" on projects for select
  using (created_by = auth.uid() or public.is_shared_with_me(id));
create policy "owner can insert projects" on projects for insert
  with check (created_by = auth.uid());
create policy "owner can update projects" on projects for update
  using (created_by = auth.uid());
create policy "owner can delete projects" on projects for delete
  using (created_by = auth.uid());

-- checkpoints: owner or invited teammate can read and write (shared task list)
create policy "owner or team can access checkpoints" on checkpoints for all
  using (
    exists (select 1 from projects p where p.id = checkpoints.project_id and p.created_by = auth.uid())
    or public.is_shared_with_me(checkpoints.project_id)
  )
  with check (
    exists (select 1 from projects p where p.id = checkpoints.project_id and p.created_by = auth.uid())
    or public.is_shared_with_me(checkpoints.project_id)
  );

-- project_team: owner or invited teammate can see the list; only the owner manages it
create policy "owner or team can select team" on project_team for select
  using (
    exists (select 1 from projects p where p.id = project_team.project_id and p.created_by = auth.uid())
    or lower(project_team.name) = lower(auth.jwt()->>'email')
  );
create policy "owner manages team insert" on project_team for insert
  with check (
    exists (select 1 from projects p where p.id = project_team.project_id and p.created_by = auth.uid())
  );
create policy "owner manages team delete" on project_team for delete
  using (
    exists (select 1 from projects p where p.id = project_team.project_id and p.created_by = auth.uid())
  );

-- Google Sheet/Doc link field for checkpoints
alter table checkpoints add column if not exists doc_url text not null default '';

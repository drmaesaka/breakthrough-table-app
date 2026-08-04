-- Run this in the Supabase SQL editor (project rfohsigmzabicfphpnzp).
-- Safe to run more than once.
--
-- Run it BEFORE deploying the co-leaders code. The app degrades gracefully if
-- you don't — leadership falls back to groups.leader_id, exactly as it behaves
-- today — but no co-leader can be added until this has run.
--
-- WHY THIS EXISTS
-- `groups.leader_id` is a single uuid, and every permission check in the app
-- resolves a leader's tables through it. One TC on vacation, ill, or simply
-- unreachable and their whole table is frozen: nobody else can start a period,
-- edit the meeting outline, book on a member's behalf, or send a broadcast.
-- With a launch coming and one TC per table, that is a single point of failure
-- attached to a human being.

-- ============================================================================
-- 1. THE JOIN TABLE
-- ============================================================================
create table if not exists public.group_leaders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The table's main TC — the one shown to members and used for attribution.
  -- Co-leaders have identical powers; this is a label, not a permission level.
  is_primary boolean not null default false,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles(id) on delete set null,
  unique (group_id, user_id)
);

-- At most one primary per table. A partial index rather than a constraint
-- because only the `true` rows need to be unique — every table has many
-- non-primary leaders and they must not collide with each other.
create unique index if not exists group_leaders_one_primary
  on public.group_leaders (group_id) where is_primary;

create index if not exists group_leaders_user_idx
  on public.group_leaders (user_id);

-- ============================================================================
-- 2. BACKFILL
--    Every existing leader becomes the primary leader of their table, so the
--    day this runs nothing changes for anyone.
-- ============================================================================
insert into public.group_leaders (group_id, user_id, is_primary)
select g.id, g.leader_id, true
from public.groups g
where g.leader_id is not null
on conflict (group_id, user_id) do nothing;

-- ============================================================================
-- 3. THE AUTHORIZATION HELPER
--    Deliberately a UNION of the new table and the legacy column rather than a
--    replacement. `groups.leader_id` is referenced by RLS policies written in
--    the Supabase console that are not in any migration file and cannot be
--    audited from the repo. A union can only ever grant access that already
--    existed, so nobody can be locked out of their own table by this change —
--    the failure mode of a migration that gets leadership wrong is a TC unable
--    to run their meeting, and that is not worth risking for tidiness.
--
--    SECURITY DEFINER so a policy on group_leaders can call it without
--    recursing into that same policy. search_path is pinned because a
--    SECURITY DEFINER function without one is a privilege-escalation vector.
-- ============================================================================
create or replace function public.leads_group(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_leaders gl
    where gl.group_id = gid and gl.user_id = auth.uid()
  ) or exists (
    select 1 from public.groups g
    where g.id = gid and g.leader_id = auth.uid()
  );
$$;

revoke all on function public.leads_group(uuid) from public;
grant execute on function public.leads_group(uuid) to authenticated;

-- ============================================================================
-- 3b. KEEP THE TWO IN SYNC AUTOMATICALLY
--     Creating a table writes groups.leader_id and nothing else, so without
--     this a brand new table would have no group_leaders row and its Table
--     Leaders list would render empty. A trigger covers every path — the admin
--     panel, a direct insert in the Supabase console, anything later.
--
--     Clears any other primary first rather than relying on the unique index to
--     reject the write, so editing groups.leader_id by hand heals the join
--     table instead of failing with a constraint error.
-- ============================================================================
create or replace function public.sync_primary_leader()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.leader_id is null then
    return new;
  end if;

  update public.group_leaders
    set is_primary = false
    where group_id = new.id and user_id <> new.leader_id and is_primary;

  insert into public.group_leaders (group_id, user_id, is_primary)
  values (new.id, new.leader_id, true)
  on conflict (group_id, user_id) do update set is_primary = true;

  return new;
end $$;

drop trigger if exists groups_primary_leader on public.groups;
create trigger groups_primary_leader
  after insert or update of leader_id on public.groups
  for each row execute function public.sync_primary_leader();

-- ============================================================================
-- 4. RLS
-- ============================================================================
alter table public.group_leaders enable row level security;

-- Members can see who leads their own table; leaders can see the roster of any
-- table they lead. No write policy: adding a leader is a group-wide change and
-- a browser write filtered by RLS would return 200 having changed nothing —
-- the dominant historical bug class in this codebase. Writes go through
-- /api/admin/group-leaders with the service key.
drop policy if exists "read leaders of my table" on public.group_leaders;
create policy "read leaders of my table" on public.group_leaders
  for select to authenticated
  using (
    group_id = (select group_id from public.profiles where id = auth.uid())
    or public.leads_group(group_id)
  );

-- Meeting plans were the one policy in the repo keyed directly to
-- groups.leader_id, so a co-leader could not read their own table's overrides.
drop policy if exists "read default and own-table meeting plans" on public.meeting_plans;
create policy "read default and own-table meeting plans" on public.meeting_plans
  for select to authenticated
  using (
    group_id is null
    or group_id = (select group_id from public.profiles where id = auth.uid())
    or public.leads_group(group_id)
  );

-- ============================================================================
-- 5. VERIFY
--    Should list every table with its leaders. Each existing table must show
--    exactly one row, is_primary = true, naming its current TC.
-- ============================================================================
-- select g.name as table_name, p.full_name as leader, gl.is_primary
-- from public.group_leaders gl
-- join public.groups g on g.id = gl.group_id
-- join public.profiles p on p.id = gl.user_id
-- order by g.name, gl.is_primary desc;

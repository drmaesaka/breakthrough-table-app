-- Run this in the Supabase SQL editor (project rfohsigmzabicfphpnzp).
-- Safe to run more than once. Run it BEFORE deploying the 2026-07-29 code, or
-- at worst shortly after — every code path degrades gracefully until this is in,
-- but the new behavior (multi-device push, revocable invites, per-table events)
-- only switches on once these statements have run.

-- ============================================================================
-- 1. Multi-device push: one row per DEVICE, not per user.
--    The unique key on user_id meant enabling notifications on a second device
--    silently replaced the first. The app already fans out to every row.
-- ============================================================================
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_user_id_key;

-- Endpoint URLs are unique per browser+device; dedupe any rows that would
-- collide before adding the constraint (keeps the newest).
delete from public.push_subscriptions a
  using public.push_subscriptions b
  where a.endpoint = b.endpoint and a.ctid < b.ctid;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_key;
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_key unique (endpoint);

-- ============================================================================
-- 2. Revocable invites + lock group_id.
--    Today a member can UPDATE their own profiles.group_id to any group id
--    (the existing trigger locks role only), and invite links carry the raw
--    group id, so they are permanent and unrevocable.
--
--    group_invites has RLS enabled with NO policies: invisible to every
--    client, readable only by the server's service key. Codes therefore never
--    reach a browser except inside a link the leader chose to share.
-- ============================================================================
create table if not exists public.group_invites (
  group_id uuid primary key references public.groups(id) on delete cascade,
  code uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);
alter table public.group_invites enable row level security;

-- Seed a code for every existing group.
insert into public.group_invites (group_id)
  select id from public.groups
  on conflict (group_id) do nothing;

-- Lock group_id the same way role is locked: only the server may move a member
-- between tables. The join flow goes through /api/join with the service key.
create or replace function public.profiles_lock_group()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.group_id is distinct from old.group_id
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'group_id can only be changed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_group on public.profiles;
create trigger profiles_lock_group
  before update on public.profiles
  for each row execute function public.profiles_lock_group();

-- ============================================================================
-- 3. Per-table events and rooms.
--    Neither table had a group_id, so every table saw every event and room.
--    Backfill assigns everything to the one existing group; a room left with
--    group_id NULL is deliberately shared across all tables.
-- ============================================================================
alter table public.events
  add column if not exists group_id uuid references public.groups(id);
alter table public.rooms
  add column if not exists group_id uuid references public.groups(id);

update public.events
  set group_id = (select id from public.groups order by created_at limit 1)
  where group_id is null;
-- Rooms are left NULL on purpose: physical suites are shared until you decide
-- a room belongs to one table, in which case set its group_id by hand.

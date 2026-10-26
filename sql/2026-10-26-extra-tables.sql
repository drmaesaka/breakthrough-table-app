-- 2026-10-26 — a member at more than one table.
--
-- profiles.group_id stays each person's MAIN table: habits, Reading &
-- Resources, nudges, the Library's "My TC". table_memberships lists any
-- OTHER tables they also belong to (e.g. Table 28 + Alumni Group 1): those
-- tables' chat, Follow-ups and announcements, and a table switcher.
--
-- RLS on with NO policies: only the server (service key) reads and writes
-- it, through /api/admin/members and the table routes that check access.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.table_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
create index if not exists table_memberships_group on public.table_memberships (group_id);
alter table public.table_memberships enable row level security;

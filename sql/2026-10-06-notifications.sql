-- 2026-10-06 — an in-app notification inbox (the 🔔 top right).
--
-- Push banners vanish once swiped away, and most members have no push at
-- all, so they never saw what they missed. Every notification the app sends
-- through lib/notify.ts is now also written here, one row per recipient.
-- Reads and writes go through /api/notifications with the service key; the
-- select policy is only so nothing else can read another person's rows.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  url text not null default '/dashboard',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_time on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

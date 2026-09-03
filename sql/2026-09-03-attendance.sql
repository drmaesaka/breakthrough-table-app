-- 2026-09-03 — meeting attendance.
--
-- The member dashboard is moving from "adherence this period" (a percentage
-- that starts every period at 0 and reads as failure) to "Your BT Journey":
-- the table's 12 meetings, with the ones this member attended filled in.
-- Attendance is taken by the TC on Admin → meetings, one tap per name.
--
-- One row = one person was at one meeting of one table. Absence is the lack
-- of a row; nothing negative is stored.
--
-- Writes go through /api/admin/attendance with the service key (a browser
-- write filtered by RLS returns 200 having changed nothing). Reads are direct:
-- members see their own rows for the dashboard; leaders see their tables'
-- rows for Stats.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  meeting_number int not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (group_id, meeting_number, user_id)
);
create index if not exists meeting_attendance_user on public.meeting_attendance (user_id);
create index if not exists meeting_attendance_group on public.meeting_attendance (group_id, meeting_number);

alter table public.meeting_attendance enable row level security;

drop policy if exists "members read own attendance" on public.meeting_attendance;
create policy "members read own attendance" on public.meeting_attendance
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "leaders read table attendance" on public.meeting_attendance;
create policy "leaders read table attendance" on public.meeting_attendance
  for select to authenticated
  using (
    exists (select 1 from public.groups g where g.id = meeting_attendance.group_id and g.leader_id = auth.uid())
    or exists (select 1 from public.group_leaders gl where gl.group_id = meeting_attendance.group_id and gl.user_id = auth.uid())
  );

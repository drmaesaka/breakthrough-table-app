-- 2026-09-21 — attendance is taken per meeting DATE, on the table's card.
--
-- Leaders asked for roll call under each table with a date box, and for it
-- to keep working after the 12-meeting playbook is finished. A roll call is
-- now one table on one day. The playbook meeting number is optional: set
-- while the table is working through the 12, blank afterwards.
--
-- Existing rows get the day they were marked as their date.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.meeting_attendance
  add column if not exists meeting_date date;

alter table public.meeting_attendance
  alter column meeting_number drop not null;

update public.meeting_attendance
  set meeting_date = (marked_at at time zone 'America/Chicago')::date
  where meeting_date is null;

alter table public.meeting_attendance
  alter column meeting_date set not null;

alter table public.meeting_attendance
  drop constraint if exists meeting_attendance_group_id_meeting_number_user_id_key;

create unique index if not exists meeting_attendance_one_per_day
  on public.meeting_attendance (group_id, meeting_date, user_id);
create index if not exists meeting_attendance_group_date
  on public.meeting_attendance (group_id, meeting_date desc);

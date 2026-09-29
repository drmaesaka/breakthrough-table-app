-- 2026-09-29 — habits can be daily, weekly or monthly.
--
-- Leaders asked for adjustable frequency. A habit's "period" is a day, a
-- Monday-to-Sunday week, or a calendar month; it is done for the period when
-- any check-in falls inside it, and its streak counts consecutive periods.
-- Existing habits stay daily. Nudges for weekly habits only start on Friday,
-- for monthly ones in the last five days of the month.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.habits
  add column if not exists frequency text not null default 'daily';

alter table public.habits
  drop constraint if exists habits_frequency_check;

alter table public.habits
  add constraint habits_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly'));

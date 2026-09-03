-- 2026-09-03 — sign-up sessions get an optional end time.
--
-- Table leaders asked for it: "Tuesday 6:00 PM" tells a drop-in nothing about
-- when they can leave. Optional, because most sessions were created without
-- one and a required column would have broken every existing row.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.signup_sessions
  add column if not exists end_date timestamptz;

alter table public.signup_sessions
  drop constraint if exists signup_sessions_end_after_start;

alter table public.signup_sessions
  add constraint signup_sessions_end_after_start
  check (end_date is null or end_date > session_date);

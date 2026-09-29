-- 2026-09-29 — when each table's programme actually started.
--
-- Tables are being brought into the app 6–10 months into the programme.
-- Nothing in the app knew that, so their members' "Your BT Journey" bar sat
-- at meeting 1 or 2. The TC now sets the date the table's programme began;
-- with a meeting every two weeks that places every member on the 12-meeting
-- line, and attendance / "mark as current" only ever move it forward.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.groups
  add column if not exists program_start_date date;

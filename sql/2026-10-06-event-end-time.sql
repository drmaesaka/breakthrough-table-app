-- 2026-10-06 — events can have an end time.
--
-- Optional: null means "no end time given", and the app shows only the start.
-- Set from Admin → events ("Ends"), same day as the start.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.events
  add column if not exists end_date timestamptz;

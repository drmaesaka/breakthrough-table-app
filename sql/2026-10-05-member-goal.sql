-- 2026-10-05 — each member's goal, pinned at the top of Home.
--
-- The goal from their goal card: the reason they came, and the strongest
-- reason to stay past the 12 meetings. Members write and edit their own; the
-- existing "update own profile" policy already covers it (the app updates
-- profiles.adherence_percent the same way).
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.profiles
  add column if not exists goal text;

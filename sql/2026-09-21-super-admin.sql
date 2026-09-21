-- 2026-09-21 — an owner role that sees and runs every table.
--
-- Admin shows a leader the tables they lead, primary or co-leader. That is
-- right for a TC and wrong for the people running Breakthrough Table: the
-- owner could see Tables 1 and 2 and had no idea the other TCs' tables
-- existed. is_super_admin makes leaderGroupIds() return every table, so
-- every admin screen and route treats them as a leader of all of them.
--
-- Set by SQL only, deliberately — there is no button for it.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

update public.profiles
  set is_super_admin = true, role = 'leader'
  where id in (select id from auth.users where lower(email) in ('drmaesaka@gmail.com'));

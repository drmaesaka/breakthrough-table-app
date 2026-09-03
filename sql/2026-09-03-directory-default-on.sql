-- 2026-09-03 — everyone is in the Member Directory unless they turn it off.
--
-- Table leaders' feedback: the directory was opt-in, so it sat nearly empty
-- and DMs had nobody to reach. New accounts now default to listed, and
-- existing members are switched on too — the toggle is still on the Profile
-- page for anyone who wants out.
--
-- Run once in Supabase → SQL Editor. Safe to re-run (the update is a no-op
-- the second time).

alter table public.profiles
  alter column directory_opt_in set default true;

update public.profiles
  set directory_opt_in = true
  where directory_opt_in is distinct from true;

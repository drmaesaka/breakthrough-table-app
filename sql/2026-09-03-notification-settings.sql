-- 2026-09-03 — what each member wants to be notified about.
--
-- Table leaders asked for notifications on chat, direct messages, and new
-- reading / prompts / library items. Three switches, all ON by default; a
-- member with no nudge_preferences row at all counts as all on. Only an
-- explicit false turns one off (Profile → Nudge Settings).
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.nudge_preferences
  add column if not exists notify_chat boolean not null default true,
  add column if not exists notify_dms boolean not null default true,
  add column if not exists notify_updates boolean not null default true;

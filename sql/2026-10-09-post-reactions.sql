-- 2026-10-09 — reactions on posts: Reading & Resources, events, announcements.
--
-- Same message_reactions table as the chats, three more kinds:
--   task         → tasks.id (Reading & Resources)
--   event        → events.id
--   announcement → notifications.post_id: one broadcast is one row per
--                  recipient, so they share a post_id to react to together.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.message_reactions drop constraint if exists message_reactions_chat_check;
alter table public.message_reactions add constraint message_reactions_chat_check
  check (chat in ('table', 'room', 'direct', 'leaders', 'task', 'event', 'announcement'));

alter table public.notifications add column if not exists post_id uuid;
create index if not exists notifications_post on public.notifications (post_id) where post_id is not null;

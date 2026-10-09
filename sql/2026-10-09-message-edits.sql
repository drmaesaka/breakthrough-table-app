-- 2026-10-09 — editing your own chat messages (typos).
--
-- edited_at is set by /api/reactions when someone edits a message; the chats
-- show "Edited" under it. Null = never edited.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.messages           add column if not exists edited_at timestamptz;
alter table public.chat_room_messages add column if not exists edited_at timestamptz;
alter table public.direct_messages    add column if not exists edited_at timestamptz;
alter table public.leader_messages    add column if not exists edited_at timestamptz;

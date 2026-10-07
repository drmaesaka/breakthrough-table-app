-- 2026-10-07 — photos in group chats, direct messages and the TC Room.
--
-- Same as table chat (sql/2026-10-07-chat-photos.sql, which made the
-- chat-photos bucket): image_url holds the photo's public URL, null for a
-- text-only message.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.chat_room_messages add column if not exists image_url text;
alter table public.direct_messages    add column if not exists image_url text;
alter table public.leader_messages    add column if not exists image_url text;

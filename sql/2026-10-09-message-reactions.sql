-- 2026-10-09 — reactions (❤️ 👍 😂 …) on chat messages, in all four chats.
--
-- One row per person per emoji per message. `chat` says which messages table
-- message_id points into: table = messages, room = chat_room_messages,
-- direct = direct_messages, leaders = leader_messages.
--
-- RLS on with NO policies: only /api/reactions (service key) reads and writes
-- it, and that route checks the person can see the message first.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  chat text not null check (chat in ('table', 'room', 'direct', 'leaders')),
  message_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (chat, message_id, user_id, emoji)
);
create index if not exists message_reactions_msg on public.message_reactions (chat, message_id);
alter table public.message_reactions enable row level security;

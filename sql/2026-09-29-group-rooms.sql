-- 2026-09-29 — custom group chats: any set of people, across tables.
--
-- Leaders asked to chat with, say, three people at three different tables.
-- Table chat is one table and DMs are one-to-one; this is the third kind.
--
-- Reads are policy-gated to members of the room (helper below, security
-- definer so the policies do not recurse). Writes have no policies on
-- purpose: creating rooms, adding people and posting go through /api/rooms
-- with the service key, where membership is checked.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists chat_room_members_user on public.chat_room_members (user_id);

create table if not exists public.chat_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_room_messages_room_time on public.chat_room_messages (room_id, created_at);

create or replace function public.in_chat_room(room uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.chat_room_members m where m.room_id = room and m.user_id = auth.uid());
$$;

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_room_messages enable row level security;

drop policy if exists "members read their rooms" on public.chat_rooms;
create policy "members read their rooms" on public.chat_rooms
  for select to authenticated using (public.in_chat_room(id));

drop policy if exists "members read room rosters" on public.chat_room_members;
create policy "members read room rosters" on public.chat_room_members
  for select to authenticated using (public.in_chat_room(room_id));

drop policy if exists "members read room messages" on public.chat_room_messages;
create policy "members read room messages" on public.chat_room_messages
  for select to authenticated using (public.in_chat_room(room_id));

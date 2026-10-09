-- 2026-10-09 — Follow-ups: a table's feed of meeting follow-ups, on My Table.
--
-- table_posts: one follow-up. Written by a TC in the app (source 'app'), or
--   copied in from content posted to the table's Sunrise group (source
--   'sunrise', source_id = Cause Machine ResourceId) so TCs who post on
--   Sunrise do not post twice.
-- table_post_replies: the replies under a follow-up.
-- Reactions use message_reactions with chat = 'followup'.
--
-- RLS on with NO policies: only /api/followups (service key) reads and
-- writes them, and it checks the person sits at or leads the table.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.table_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  source text not null default 'app' check (source in ('app', 'sunrise')),
  source_id text,
  title text,
  body text not null default '',
  link_url text,
  image_url text,
  sunrise_author text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- A removed Sunrise copy is hidden, not deleted, so the sync does not bring it back.
  hidden boolean not null default false,
  unique (group_id, source, source_id)
);
create index if not exists table_posts_group_time on public.table_posts (group_id, created_at desc);
alter table public.table_posts enable row level security;

create table if not exists public.table_post_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.table_posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete cascade,
  body text not null,
  image_url text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists table_post_replies_post on public.table_post_replies (post_id, created_at);
alter table public.table_post_replies enable row level security;

alter table public.message_reactions drop constraint if exists message_reactions_chat_check;
alter table public.message_reactions add constraint message_reactions_chat_check
  check (chat in ('table', 'room', 'direct', 'leaders', 'task', 'event', 'announcement', 'followup'));

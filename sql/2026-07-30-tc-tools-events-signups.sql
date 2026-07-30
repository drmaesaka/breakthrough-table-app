-- Run this in the Supabase SQL editor (project rfohsigmzabicfphpnzp).
-- Safe to run more than once.
--
-- Run it BEFORE deploying the 2026-07-30 code. Unlike the 2026-07-29 migration,
-- these features do not degrade gracefully — the new pages read tables that do
-- not exist yet, so they will show an empty state until this has run.
--
-- Covers four features:
--   1. Editable TC meeting outlines (meeting_plans)
--   2. TC internal space (leader_messages, leader_resources)
--   3. Event announcements / reminders / follow-ups (columns on events)
--   4. Alumni + monthly drop-in sign-ups (signup_sessions, signup_registrations)

-- ============================================================================
-- 1. MEETING PLANS
--    The curriculum lived in lib/meeting-plans.ts as a hardcoded array, so a
--    TC could read it but never change it. Moving it into the database makes
--    it editable; keeping a group_id-NULL row as the BT-wide default means a
--    table can diverge without forking the curriculum for everyone.
--
--    Resolution order for a table: its own row for that meeting number if one
--    exists, otherwise the default. The app never mixes the two.
-- ============================================================================
create table if not exists public.meeting_plans (
  id uuid primary key default gen_random_uuid(),
  -- NULL = the BT-wide default plan. Non-NULL = one table's override.
  group_id uuid references public.groups(id) on delete cascade,
  number int not null,
  title text not null,
  resources text[] not null default '{}',
  foundations text[] not null default '{}',
  curriculum text[] not null default '{}',
  challenges text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- Two partial indexes rather than `unique (group_id, number)`: Postgres treats
-- NULLs as distinct, so a plain composite unique would happily allow twenty
-- different "default meeting 3" rows and leave the resolver picking at random.
create unique index if not exists meeting_plans_default_number
  on public.meeting_plans (number) where group_id is null;
create unique index if not exists meeting_plans_group_number
  on public.meeting_plans (group_id, number) where group_id is not null;

alter table public.meeting_plans enable row level security;

-- Readable by the table it belongs to (plus the defaults, which everyone
-- sees). Writes are deliberately absent: meeting plans are group-wide content,
-- and a browser-side write filtered by RLS returns 200 having changed nothing.
-- Every mutation goes through /api/admin/meeting-plans with the service key.
drop policy if exists "read default and own-table meeting plans" on public.meeting_plans;
create policy "read default and own-table meeting plans" on public.meeting_plans
  for select to authenticated
  using (
    group_id is null
    or group_id = (select group_id from public.profiles where id = auth.uid())
    or exists (
      select 1 from public.groups g
      where g.id = meeting_plans.group_id and g.leader_id = auth.uid()
    )
  );

-- Which meeting the table is currently on, so the meeting view opens on the
-- right one instead of making the TC scroll to it live in front of everyone.
alter table public.groups
  add column if not exists current_meeting_number int;

-- ============================================================================
-- 2. TC INTERNAL SPACE
--    Leaders had no way to talk to each other: table chat is scoped to a
--    group_id, and DMs are one-to-one. This is a single cross-table channel
--    plus a shared resource shelf, both visible only to leaders.
-- ============================================================================

-- user_id references profiles rather than auth.users so PostgREST can embed
-- profiles(full_name) on the message query, the same way table chat does.
create table if not exists public.leader_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists leader_messages_created_at on public.leader_messages (created_at);

alter table public.leader_messages enable row level security;

drop policy if exists "leaders read leader chat" on public.leader_messages;
create policy "leaders read leader chat" on public.leader_messages
  for select to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

-- `user_id = auth.uid()` matters as much as the role check: without it a leader
-- could post a message attributed to another leader.
drop policy if exists "leaders post to leader chat" on public.leader_messages;
create policy "leaders post to leader chat" on public.leader_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
    )
  );

drop policy if exists "leaders delete own leader chat" on public.leader_messages;
create policy "leaders delete own leader chat" on public.leader_messages
  for delete to authenticated
  using (user_id = auth.uid());

create table if not exists public.leader_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  type text,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.leader_resources enable row level security;

-- Any leader may manage the shelf. It is a small trusted group and a shared
-- shelf that only its author can edit is not a shared shelf.
drop policy if exists "leaders read resources" on public.leader_resources;
create policy "leaders read resources" on public.leader_resources
  for select to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

drop policy if exists "leaders write resources" on public.leader_resources;
create policy "leaders write resources" on public.leader_resources
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

drop policy if exists "leaders update resources" on public.leader_resources;
create policy "leaders update resources" on public.leader_resources
  for update to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

drop policy if exists "leaders delete resources" on public.leader_resources;
create policy "leaders delete resources" on public.leader_resources
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

-- ============================================================================
-- 3. EVENT NOTIFICATIONS
--    Announce-once, remind, then follow up. Each stage records its own
--    timestamp, so the sweep is idempotent no matter how often it runs or how
--    wide its window is. The nudge route matches a half-hour slot instead, and
--    that design is exactly why widening its window double-sent to everyone;
--    this avoids inheriting the problem.
-- ============================================================================
alter table public.events
  add column if not exists notifications_enabled boolean not null default true,
  add column if not exists announced_at timestamptz,
  add column if not exists reminder_24h_sent_at timestamptz,
  add column if not exists reminder_1h_sent_at timestamptz,
  add column if not exists followup_sent_at timestamptz,
  add column if not exists followup_message text;

-- Backfill every existing event as already announced. Without this the first
-- sweep after deploy treats the entire back catalogue as new and pushes a
-- "New event" notification for each one.
update public.events set announced_at = now() where announced_at is null;

-- Events that have already finished should not generate a follow-up for a
-- meeting nobody is thinking about any more.
update public.events
  set followup_sent_at = now()
  where followup_sent_at is null and event_date < now();

-- ============================================================================
-- 4. ALUMNI + DROP-IN SIGN-UPS
--    Deliberately NOT group-scoped. An alumnus keeps their account but has no
--    group_id, so anything filtered by table would be invisible to exactly the
--    people the alumni table is for.
--
--    No payment column. Whether drop-ins pay, and through what, is unresolved
--    — see the handoff. Adding a price here would imply an answer.
-- ============================================================================
create table if not exists public.signup_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('alumni', 'dropin')),
  title text not null,
  session_date timestamptz not null,
  location text,
  description text,
  -- NULL = no cap.
  capacity int check (capacity is null or capacity > 0),
  -- Denormalised on purpose. A member may only read their OWN registration
  -- rows, so counting client-side would tell them "11 seats left" on a full
  -- session and only reveal the truth when the insert bounced. The trigger
  -- below keeps this honest and it is readable by everyone.
  registered_count int not null default 0,
  open boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists signup_sessions_date on public.signup_sessions (session_date);

alter table public.signup_sessions enable row level security;

drop policy if exists "members read sessions" on public.signup_sessions;
create policy "members read sessions" on public.signup_sessions
  for select to authenticated using (true);

drop policy if exists "leaders manage sessions insert" on public.signup_sessions;
create policy "leaders manage sessions insert" on public.signup_sessions
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

drop policy if exists "leaders manage sessions update" on public.signup_sessions;
create policy "leaders manage sessions update" on public.signup_sessions
  for update to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

drop policy if exists "leaders manage sessions delete" on public.signup_sessions;
create policy "leaders manage sessions delete" on public.signup_sessions
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
  ));

create table if not exists public.signup_registrations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.signup_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  -- Stops a double-tap registering the same person twice and eating a seat.
  unique (session_id, user_id)
);
create index if not exists signup_registrations_session on public.signup_registrations (session_id);

alter table public.signup_registrations enable row level security;

drop policy if exists "read own registrations or all as leader" on public.signup_registrations;
create policy "read own registrations or all as leader" on public.signup_registrations
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
    )
  );

drop policy if exists "sign self up" on public.signup_registrations;
create policy "sign self up" on public.signup_registrations
  for insert to authenticated with check (user_id = auth.uid());

-- A member can withdraw; a leader can remove anyone (no-shows, moving someone
-- between sessions).
drop policy if exists "withdraw self or remove as leader" on public.signup_registrations;
create policy "withdraw self or remove as leader" on public.signup_registrations
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader'
    )
  );

-- Capacity and open/closed enforced in the database, not the client. Counting
-- rows in the browser and then inserting is a race: two members tapping the
-- last seat at once both read "1 left" and both get in. `for update` on the
-- session row serialises them so the second one is rejected.
create or replace function public.signup_enforce_capacity()
returns trigger
language plpgsql
as $$
declare
  session_capacity int;
  session_open boolean;
  taken int;
begin
  select capacity, open into session_capacity, session_open
    from public.signup_sessions
    where id = new.session_id
    for update;

  if not found then
    raise exception 'That session no longer exists';
  end if;

  if session_open is distinct from true then
    raise exception 'This session is closed for sign-ups';
  end if;

  if session_capacity is not null then
    select count(*) into taken
      from public.signup_registrations
      where session_id = new.session_id;
    if taken >= session_capacity then
      raise exception 'This session is full';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists signup_enforce_capacity on public.signup_registrations;
create trigger signup_enforce_capacity
  before insert on public.signup_registrations
  for each row execute function public.signup_enforce_capacity();

-- Keeps signup_sessions.registered_count in step with the roster. Recounting
-- rather than incrementing means the column self-heals: a bad count can never
-- drift permanently, it is corrected by the next sign-up or withdrawal.
create or replace function public.signup_sync_count()
returns trigger
language plpgsql
as $$
declare
  target uuid := coalesce(new.session_id, old.session_id);
begin
  update public.signup_sessions
    set registered_count = (
      select count(*) from public.signup_registrations where session_id = target
    )
    where id = target;
  return null;
end;
$$;

drop trigger if exists signup_sync_count on public.signup_registrations;
create trigger signup_sync_count
  after insert or delete on public.signup_registrations
  for each row execute function public.signup_sync_count();

-- Backfill for anything that existed before the trigger.
update public.signup_sessions s
  set registered_count = (
    select count(*) from public.signup_registrations r where r.session_id = s.id
  );

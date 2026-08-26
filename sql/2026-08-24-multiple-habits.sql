-- Run this in the Supabase SQL editor (project rfohsigmzabicfphpnzp).
-- Safe to run more than once.
--
-- RUN THIS BEFORE DEPLOYING THE MATCHING CODE. The tasks and profile screens
-- read a `habits` table that does not exist yet; until this runs they will show
-- a member no habits at all.
--
-- WHY
-- A habit was a single text column on the member's profile, and a completion
-- was just "this person did their habit on this date" with no record of WHICH
-- habit. The table leaders asked to track several separately, each with its own
-- streak, so one lapsing does not wipe the others.

-- ============================================================================
-- 1. HABITS
-- ============================================================================
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  -- Archived rather than deleted: habit_completions references this row, and a
  -- member who graduates a habit should keep the history that proves they did.
  archived_at timestamptz
);

create index if not exists habits_user on public.habits (user_id) where archived_at is null;

alter table public.habits enable row level security;

-- A member manages their own habits. Leaders read their table's, so the stats
-- page can show what each member is working on.
drop policy if exists "read own habits or as leader" on public.habits;
create policy "read own habits or as leader" on public.habits
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles me, public.profiles them
      where me.id = auth.uid() and them.id = habits.user_id
        and me.role = 'leader' and me.group_id = them.group_id
    )
  );

drop policy if exists "manage own habits insert" on public.habits;
create policy "manage own habits insert" on public.habits
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "manage own habits update" on public.habits;
create policy "manage own habits update" on public.habits
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "manage own habits delete" on public.habits;
create policy "manage own habits delete" on public.habits
  for delete to authenticated using (user_id = auth.uid());

-- ============================================================================
-- 2. COMPLETIONS POINT AT A HABIT
-- ============================================================================
alter table public.habit_completions
  add column if not exists habit_id uuid references public.habits(id) on delete cascade;

-- Every member with a habit gets a row, and their existing completions are
-- attributed to it. Without this backfill every streak in the app resets to
-- zero on deploy — the completions would still exist but belong to no habit.
insert into public.habits (user_id, name, created_at)
select p.id, p.current_habit, now()
from public.profiles p
where p.current_habit is not null
  and btrim(p.current_habit) <> ''
  and not exists (
    select 1 from public.habits h
    where h.user_id = p.id and h.name = p.current_habit and h.archived_at is null
  );

update public.habit_completions hc
set habit_id = h.id
from public.habits h
where hc.habit_id is null
  and h.user_id = hc.user_id
  and h.archived_at is null;

-- ============================================================================
-- 3. THE UNIQUENESS RULE HAS TO CHANGE
--    One row per member per day was the old rule, and it is exactly what makes
--    a second habit impossible — logging habit B would collide with habit A on
--    the same date. The name of that constraint is not recorded anywhere in the
--    repo (the base schema was built in the Supabase console), so find it
--    rather than guess it.
-- ============================================================================
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'habit_completions' and con.contype = 'u'
  loop
    execute format('alter table public.habit_completions drop constraint %I', r.conname);
  end loop;

  -- Plain unique indexes are not constraints and would survive the loop above.
  for r in
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'habit_completions'
      and indexdef like 'CREATE UNIQUE INDEX%'
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;

-- The new rule: one completion per habit per day. Still stops a double-tap
-- double-counting, without stopping a second habit.
create unique index if not exists habit_completions_habit_day
  on public.habit_completions (user_id, habit_id, completed_date);

-- ============================================================================
-- 4. profiles.current_habit IS DELIBERATELY LEFT IN PLACE
--    Dropping it in the same migration that adds habits means one bad deploy
--    loses the only copy of what every member was working on. It is no longer
--    read by the app after this ships; drop it in a later migration once the
--    habits table has been live and correct for a while.
-- ============================================================================

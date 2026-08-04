-- Run this in the Supabase SQL editor (project rfohsigmzabicfphpnzp).
-- Safe to run more than once.
--
-- Run it BEFORE deploying the 2026-08-03 code. The booking page reads
-- venue_hours to build its time grid; without this migration it has no slots to
-- offer and renders an empty day.
--
-- WHY THIS EXISTS
-- Skedda was the venue's real room schedule and this app's bookings held
-- nothing. Skedda support confirmed in writing (2026-07-29) that no external
-- system can create a booking in it, so the two could never be reconciled.
-- Decision 2026-08-03: retire Skedda, and this app becomes the system of record
-- for the physical suites. That promotion is what this migration pays for —
-- a real schedule needs editable rooms, editable hours, variable-length
-- bookings, and overlap protection that actually holds under a race.
--
-- Covers:
--   1. Venue hours, per weekday
--   2. Venue booking settings (granularity, duration bounds, limits)
--   3. Room lifecycle columns (is_active, sort_order, description)
--   4. Real overlap prevention on room_bookings

-- ============================================================================
-- 1. VENUE HOURS
--    Opening hours were the hardcoded array TIME_SLOTS = ['08:00'...'19:00'],
--    duplicated in app/booking/page.tsx and the admin rooms tab. Two copies of
--    the same truth in a file only a developer can edit is exactly the kind of
--    thing that made Skedda the system of record in the first place.
--
--    One row per weekday, 0 = Sunday through 6 = Saturday, matching
--    JavaScript's Date.getDay() so the client needs no translation table.
-- ============================================================================
create table if not exists public.venue_hours (
  day_of_week int primary key check (day_of_week between 0 and 6),
  open_time time not null default '08:00',
  close_time time not null default '20:00',
  is_closed boolean not null default false,
  -- close_time is the last moment a booking may END, not the last start time.
  constraint venue_hours_open_before_close check (is_closed or open_time < close_time)
);

-- Seeded open seven days a week on purpose. The old booking page offered every
-- date on the calendar including weekends, so seeding Sat/Sun closed would
-- silently withdraw booking that members can use today. 08:00-20:00 reproduces
-- the old grid exactly: starts ran 08:00-19:00 and every booking was an hour.
-- Adjust real hours in Admin -> Rooms once the venue's actual hours are known.
insert into public.venue_hours (day_of_week, open_time, close_time, is_closed)
values (0,'08:00','20:00',false), (1,'08:00','20:00',false), (2,'08:00','20:00',false),
       (3,'08:00','20:00',false), (4,'08:00','20:00',false), (5,'08:00','20:00',false),
       (6,'08:00','20:00',false)
on conflict (day_of_week) do nothing;

alter table public.venue_hours enable row level security;

-- Everyone signed in needs to read the hours to see a booking grid at all.
-- No write policy: hours are venue-wide, and a browser write filtered by RLS
-- returns 200 having changed nothing. All writes go through /api/admin/venue.
drop policy if exists "read venue hours" on public.venue_hours;
create policy "read venue hours" on public.venue_hours
  for select to authenticated using (true);

-- ============================================================================
-- 2. VENUE SETTINGS
--    Single row. The id check is what keeps it single — without it, a second
--    row appears eventually and the app silently picks one.
-- ============================================================================
create table if not exists public.venue_settings (
  id int primary key default 1 check (id = 1),
  -- Grid granularity. Bookings must start on a multiple of this past open_time
  -- and last a multiple of it.
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  min_duration_minutes int not null default 30 check (min_duration_minutes > 0),
  max_duration_minutes int not null default 240 check (max_duration_minutes > 0),
  -- How far ahead a member may book.
  booking_horizon_days int not null default 60 check (booking_horizon_days > 0),
  -- NULL means no limit. These exist because one member holding a room all week
  -- is the failure mode a shared calendar invites, and it is far easier to cap
  -- now than to claw back later.
  max_active_bookings_per_member int check (max_active_bookings_per_member > 0),
  max_minutes_per_member_per_day int check (max_minutes_per_member_per_day > 0),
  updated_at timestamptz not null default now(),
  constraint venue_settings_duration_order check (min_duration_minutes <= max_duration_minutes)
);

insert into public.venue_settings (id) values (1) on conflict (id) do nothing;

alter table public.venue_settings enable row level security;

drop policy if exists "read venue settings" on public.venue_settings;
create policy "read venue settings" on public.venue_settings
  for select to authenticated using (true);

-- ============================================================================
-- 3. ROOM LIFECYCLE
--    Rooms could only be created by hand in the Supabase table editor, which is
--    fine while a developer is the only admin and untenable the moment the app
--    owns the schedule.
-- ============================================================================
alter table public.rooms
  -- Retiring a room must not delete its history: bookings reference it, and a
  -- hard delete would either cascade away real records or fail outright.
  add column if not exists is_active boolean not null default true,
  add column if not exists sort_order int not null default 0,
  add column if not exists description text;

-- ============================================================================
-- 4. OVERLAP PREVENTION
--    The old guard was `unique (room_id, booking_date, start_time)`. That only
--    catches two bookings starting at the identical minute, which was enough
--    while every booking was exactly one hour on the hour. With variable
--    durations it is not: 09:00-11:00 and 10:00-10:30 have different start
--    times and occupy the same room at the same time.
--
--    Checking for a clash in application code before inserting cannot fix this
--    — two requests both read "free" before either writes. The check has to be
--    the constraint itself.
-- ============================================================================

-- Needed so a GiST exclusion constraint can use plain `=` on room_id alongside
-- a range overlap test.
create extension if not exists btree_gist;

-- FIRST: make the columns the types they always should have been.
--
-- room_bookings.start_time and end_time were created as `text` holding 'HH:MM'
-- strings, not as `time`. That has been invisible so far because the only
-- operations on them were equality and sorting, and zero-padded 'HH:MM' strings
-- happen to sort chronologically. It stops being invisible the moment you do
-- arithmetic on them, which is exactly what variable-length bookings require.
--
-- Text also silently accepts '9:00', '09:00 AM' and 'lunchtime', and compares
-- '9:00' as LATER than '10:00' because '9' > '1'. Converting now, while there
-- are three members and a handful of bookings, is as cheap as this ever gets.
--
-- Written as an inspection rather than a plain ALTER so the migration is
-- idempotent and works whether or not a previous run already converted them.
do $$
declare
  col record;
begin
  for col in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'room_bookings'
      and column_name in ('start_time', 'end_time')
  loop
    if col.data_type in ('text', 'character varying') then
      -- nullif('') because an empty string is not a valid time but is a
      -- perfectly valid text value, and casting it directly would abort here.
      execute format(
        'alter table public.room_bookings alter column %I type time using nullif(%I, '''')::time',
        col.column_name, col.column_name
      );
      raise notice 'converted room_bookings.% from % to time', col.column_name, col.data_type;
    end if;
  end loop;

  -- Same treatment for the date, for the same reason.
  if (
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'room_bookings' and column_name = 'booking_date'
  ) in ('text', 'character varying') then
    alter table public.room_bookings
      alter column booking_date type date using nullif(booking_date, '')::date;
    raise notice 'converted room_bookings.booking_date to date';
  end if;
end $$;

-- A NULL end_time would become an unbounded range that overlaps everything and
-- makes the constraint below unsatisfiable. Close them first. This has to run
-- AFTER the conversion above — `text + interval` is what failed on the first
-- attempt at this migration.
update public.room_bookings
  set end_time = start_time + interval '1 hour'
  where end_time is null;

alter table public.room_bookings
  alter column end_time set not null;

-- `booking_date + start_time` yields a timestamp, so the date is carried inside
-- the range rather than compared separately. That also makes a booking which
-- runs past midnight behave correctly instead of silently comparing times of
-- day across different dates.
-- Adding the constraint fails outright if the table already contains overlapping
-- rows, and Postgres reports only the first offending pair. There should be none
-- — every existing booking is a fixed hour on the hour, guarded by the old
-- unique index — but failing here with the actual clashes listed beats failing
-- with a bare constraint violation and no idea which rows to fix.
do $$
declare
  clashes int;
begin
  select count(*) into clashes
  from public.room_bookings a
  join public.room_bookings b
    on a.id < b.id
   and a.room_id = b.room_id
   and a.booking_date = b.booking_date
   and a.start_time < b.end_time
   and b.start_time < a.end_time;

  if clashes > 0 then
    raise exception
      'Cannot add the overlap constraint: % pair(s) of existing bookings already overlap. Run the SELECT in the comment below to list them, cancel the duplicates, then re-run this migration.',
      clashes;
  end if;
end $$;

-- To list them:
--   select a.id, b.id, a.room_id, a.booking_date, a.start_time, a.end_time,
--          b.start_time, b.end_time
--   from public.room_bookings a
--   join public.room_bookings b on a.id < b.id and a.room_id = b.room_id
--    and a.booking_date = b.booking_date
--    and a.start_time < b.end_time and b.start_time < a.end_time;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'room_bookings_no_overlap'
  ) then
    alter table public.room_bookings
      add constraint room_bookings_no_overlap
      exclude using gist (
        room_id with =,
        tsrange(booking_date + start_time, booking_date + end_time, '[)') with &&
      );
  end if;
end $$;

-- Now redundant: any two bookings sharing a start time necessarily overlap, so
-- the exclusion constraint above already rejects them, and with a better error.
--
-- Written defensively because the original guard was created by hand in the
-- Supabase console on 2026-07-29 and is in no migration file, so neither its
-- exact name nor whether it is an index or a table constraint is known here.
-- `drop index` against a constraint-backed index raises an error rather than
-- skipping, which would abort this whole migration partway through.
do $$
declare
  target text;
begin
  -- A unique CONSTRAINT covering exactly (room_id, booking_date, start_time).
  select con.conname into target
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'room_bookings' and con.contype = 'u'
    and (
      select array_agg(att.attname::text order by att.attname)
      from unnest(con.conkey) k
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
    ) = array['booking_date','room_id','start_time']
  limit 1;

  if target is not null then
    execute format('alter table public.room_bookings drop constraint %I', target);
    return;
  end if;

  -- Otherwise a plain unique INDEX over the same three columns.
  select idx.relname into target
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class rel on rel.oid = i.indrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'room_bookings'
    and i.indisunique and not i.indisprimary
    and (
      select array_agg(att.attname::text order by att.attname)
      from unnest(i.indkey::int[]) k
      join pg_attribute att on att.attrelid = i.indrelid and att.attnum = k
    ) = array['booking_date','room_id','start_time']
  limit 1;

  if target is not null then
    execute format('drop index public.%I', target);
  end if;
end $$;

-- The availability query filters by date on every page load.
create index if not exists room_bookings_date_idx
  on public.room_bookings (booking_date);

-- Enforcing "your booking must end after it starts" in the database as well.
-- The API checks it too, but the API is not the only thing that writes here —
-- the admin book-on-behalf route uses the service key and bypasses RLS.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'room_bookings_end_after_start'
  ) then
    alter table public.room_bookings
      add constraint room_bookings_end_after_start check (end_time > start_time);
  end if;
end $$;

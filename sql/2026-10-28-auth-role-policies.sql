-- 2026-10-28 — read policies that stopped letting signed-in users in.
--
-- On 2026-10-28 every user lost their Home buttons and Admin tab, and chats
-- showed "Member" for every sender: the console-made SELECT policies on
-- profiles, events and rooms checked `auth.role() = 'authenticated'`, and
-- that deprecated check stopped matching signed-in users. Grants were fine.
-- Rewritten to the current form, `to authenticated using (true)`, which
-- allows exactly what the old check meant to.
--
-- Run 2026-10-28 in Supabase → SQL Editor. Safe to re-run.
-- Do not write new policies with auth.role(); use `to authenticated`.

drop policy if exists "Authenticated users read profiles" on public.profiles;
create policy "Authenticated users read profiles" on public.profiles
  for select to authenticated using (true);

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'events'
             and policyname = 'Anyone can read events' and qual = '(auth.role() = ''authenticated''::text)') then
    drop policy "Anyone can read events" on public.events;
    create policy "Anyone can read events" on public.events for select to authenticated using (true);
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rooms'
             and policyname = 'Anyone can read rooms' and qual = '(auth.role() = ''authenticated''::text)') then
    drop policy "Anyone can read rooms" on public.rooms;
    create policy "Anyone can read rooms" on public.rooms for select to authenticated using (true);
  end if;
end $$;

-- Anything still using the old check:
select tablename, policyname, qual
from pg_policies
where schemaname = 'public'
  and (qual like '%auth.role()%' or with_check like '%auth.role()%');

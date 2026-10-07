-- 2026-10-07 — members' own items under Reading & Resources.
--
-- The "+" on My Table → You lets a member add anything for themselves (a
-- book, a link, a reminder). Private: only the member sees their own rows,
-- and they never count toward Stats or adherence. Kept apart from `tasks`
-- (the table's reading, which every member of a table reads) so a personal
-- item can never leak to tablemates through a group-wide query.
--
-- The browser reads and writes these directly; the policies below are the
-- whole access model and live here in the repo, not in the console.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.personal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  note text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists personal_items_user on public.personal_items (user_id, created_at);

alter table public.personal_items enable row level security;

drop policy if exists "own personal items: read" on public.personal_items;
create policy "own personal items: read" on public.personal_items
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own personal items: add" on public.personal_items;
create policy "own personal items: add" on public.personal_items
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own personal items: change" on public.personal_items;
create policy "own personal items: change" on public.personal_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own personal items: remove" on public.personal_items;
create policy "own personal items: remove" on public.personal_items
  for delete to authenticated using (user_id = auth.uid());

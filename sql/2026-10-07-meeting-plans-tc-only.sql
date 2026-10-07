-- 2026-10-07 — meeting outlines are for TCs only.
--
-- Before this, any signed-in member could read every BT-wide outline and
-- their own table's (the Meetings page was the only thing hiding them).
-- Now a reader must be a TC (profiles.role = 'leader'), and still sees only
-- the defaults plus their own / led tables' versions. Writes are unchanged:
-- there are no write policies; every write goes through
-- /api/admin/meeting-plans with the service key.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

drop policy if exists "read default and own-table meeting plans" on public.meeting_plans;
drop policy if exists "TCs read meeting plans" on public.meeting_plans;
create policy "TCs read meeting plans" on public.meeting_plans
  for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader')
    and (
      group_id is null
      or group_id = (select group_id from public.profiles where id = auth.uid())
      or public.leads_group(group_id)
    )
  );

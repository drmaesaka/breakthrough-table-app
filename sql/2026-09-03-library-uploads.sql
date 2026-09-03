-- 2026-09-03 — the resource library can hold files, not just links.
--
-- Leaders asked to put PDFs, videos and documents IN the app instead of
-- linking out to the Sunrise site. Files live in a Supabase Storage bucket
-- named "library"; the content row's url points at the file's public URL,
-- so the library page needs no change to open them.
--
-- Public bucket: anyone holding the exact URL can open the file. Paths carry
-- a random uuid, so URLs cannot be guessed, and this is the same material
-- that was being linked from a public website. Only leaders can add, replace
-- or remove files.
--
-- Per-file cap here is 500 MB. The PROJECT-wide upload cap (Settings →
-- Storage → "Upload file size limit") defaults to 50 MB and wins when lower;
-- raise it there for big videos.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', true, 524288000)
on conflict (id) do update set public = true, file_size_limit = 524288000;

drop policy if exists "leaders upload library files" on storage.objects;
create policy "leaders upload library files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'library'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader')
  );

drop policy if exists "leaders update library files" on storage.objects;
create policy "leaders update library files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'library'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader')
  );

drop policy if exists "leaders delete library files" on storage.objects;
create policy "leaders delete library files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'library'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'leader')
  );

drop policy if exists "members read library files" on storage.objects;
create policy "members read library files" on storage.objects
  for select to authenticated
  using (bucket_id = 'library');

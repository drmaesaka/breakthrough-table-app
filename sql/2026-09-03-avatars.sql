-- 2026-09-03 — profile pictures.
--
-- profiles.avatar_url holds the public URL of the member's photo in the
-- "avatars" storage bucket; NULL means initials, as before. Each member
-- writes only inside their own folder (avatars/<their uuid>/...), anyone
-- signed in can read. Public bucket so <img> tags need no token; the path
-- carries a random uuid so URLs cannot be guessed.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists "members upload own avatar" on storage.objects;
create policy "members upload own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members update own avatar" on storage.objects;
create policy "members update own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members delete own avatar" on storage.objects;
create policy "members delete own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members read avatars" on storage.objects;
create policy "members read avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

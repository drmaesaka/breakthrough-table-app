-- 2026-10-07 — photos in table chat.
--
-- messages.image_url holds the public URL of a photo in the "chat-photos"
-- bucket; null for a text-only message. Photos are shrunk in the browser to
-- 1600px before upload. Each member writes only inside their own folder
-- (chat-photos/<their uuid>/...). Public bucket so <img> tags need no token;
-- paths carry a random uuid so URLs cannot be guessed — the same model as
-- avatars and the library.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.messages
  add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-photos', 'chat-photos', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "members upload own chat photos" on storage.objects;
create policy "members upload own chat photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members delete own chat photos" on storage.objects;
create policy "members delete own chat photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "members read chat photos" on storage.objects;
create policy "members read chat photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-photos');

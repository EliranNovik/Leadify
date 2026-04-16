-- External user avatars: Storage bucket + RLS policies
-- Bucket id/name: external-user-avatars
-- Object path convention: avatars/<auth.uid()>/<timestamp>.<ext>
--
-- IMPORTANT (Supabase Cloud / SQL Editor)
-- -----------------------------------------
-- Do NOT run: ALTER TABLE storage.objects ...
-- That table is owned by the storage subsystem; you will get:
--   ERROR: 42501: must be owner of table objects
-- RLS on storage.objects is already managed by Supabase; only add POLICIES.
--
-- If INSERT into storage.buckets still fails with a permission error, create the
-- bucket in the Dashboard instead: Storage → New bucket → name external-user-avatars,
-- Public, file size limit 5MB, allowed types image/jpeg, image/png, image/webp.
-- Then run ONLY the policy section below (from "drop policy" through last "create policy").

begin;

-- 1) Bucket (public URL → stored in firm_contacts.profile_image_url)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'external-user-avatars',
  'external-user-avatars',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 2) Policies
-- Path: avatars/<auth.uid()>/<filename>
-- Use split_part() so checks match reliably (avoids edge cases with LIKE).

-- 2a) Public read (bucket is public; img src + Storage client need SELECT on objects)
drop policy if exists "External avatars public read" on storage.objects;
create policy "External avatars public read"
on storage.objects
for select
to public
using (bucket_id = 'external-user-avatars');

-- 2b) Authenticated: insert only under own folder
drop policy if exists "External users can upload their avatars" on storage.objects;
create policy "External users can upload their avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'external-user-avatars'
  and split_part(name, '/', 1) = 'avatars'
  and lower(split_part(name, '/', 2)) = lower(auth.uid()::text)
  and split_part(name, '/', 3) <> ''
);

drop policy if exists "External users can update their avatars" on storage.objects;
create policy "External users can update their avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'external-user-avatars'
  and split_part(name, '/', 1) = 'avatars'
  and lower(split_part(name, '/', 2)) = lower(auth.uid()::text)
)
with check (
  bucket_id = 'external-user-avatars'
  and split_part(name, '/', 1) = 'avatars'
  and lower(split_part(name, '/', 2)) = lower(auth.uid()::text)
);

drop policy if exists "External users can delete their avatars" on storage.objects;
create policy "External users can delete their avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'external-user-avatars'
  and split_part(name, '/', 1) = 'avatars'
  and lower(split_part(name, '/', 2)) = lower(auth.uid()::text)
);

commit;

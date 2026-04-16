-- External users: connect to firms + use firm_contacts as profile source
-- Run in Supabase SQL editor (public schema).

-- 1) firm_contacts: ensure we can link an external auth user -> a firm contact row
-- Better/robust link: firm_contacts.user_id -> users.id (stable even if email changes).
alter table public.firm_contacts
  add column if not exists user_id uuid null;

alter table public.firm_contacts
  drop constraint if exists firm_contacts_user_id_fkey;
alter table public.firm_contacts
  add constraint firm_contacts_user_id_fkey
  foreign key (user_id) references public.users (id) on delete set null;

create index if not exists idx_firm_contacts_user_id on public.firm_contacts using btree (user_id);

-- Enforce ONE firm_contacts row per user_id (recommended).
create unique index if not exists uq_firm_contacts_user_id
on public.firm_contacts (user_id)
where (user_id is not null);

-- Optional: keep a unique link by user_email too (helps backfill + legacy).
create unique index if not exists uq_firm_contacts_user_email
on public.firm_contacts (user_email)
where (user_email is not null);

-- 2) users.extern_firm_id FK + index
-- You said you'll add the column yourself. After you add it, run the FK + index below:
-- alter table public.users add column if not exists extern_firm_id uuid null;

alter table public.users
  drop constraint if exists users_extern_firm_id_fkey;
alter table public.users
  add constraint users_extern_firm_id_fkey
  foreign key (extern_firm_id) references public.firms (id) on delete set null;

create index if not exists idx_users_extern_firm_id on public.users using btree (extern_firm_id);

-- 3) RLS policies (recommended)
-- Assumption: users.auth_id maps to auth.users.id, and external users sign in via Supabase auth.
-- These policies allow an external user to read/update ONLY their own firm_contact row (by email).
-- This version uses auth.uid() + users.auth_id, so it doesn't depend on JWT email.

alter table public.firm_contacts enable row level security;

-- Row access: prefer firm_contacts.user_id -> users.id (stable).
-- Legacy / migration: if user_id is still null, allow the same auth user when
-- firm_contacts.user_email matches users.email (so profile_image_url updates work).
drop policy if exists "firm_contacts_select_own" on public.firm_contacts;
create policy "firm_contacts_select_own"
on public.firm_contacts
for select
using (
  (
    firm_contacts.user_id is not null
    and exists (
      select 1
      from public.users u
      where u.auth_id = auth.uid()
        and u.id = firm_contacts.user_id
    )
  )
  or
  (
    firm_contacts.user_id is null
    and firm_contacts.user_email is not null
    and exists (
      select 1
      from public.users u
      where u.auth_id = auth.uid()
        and lower(u.email) = lower(firm_contacts.user_email)
    )
  )
);

drop policy if exists "firm_contacts_update_own" on public.firm_contacts;
create policy "firm_contacts_update_own"
on public.firm_contacts
for update
using (
  (
    firm_contacts.user_id is not null
    and exists (
      select 1
      from public.users u
      where u.auth_id = auth.uid()
        and u.id = firm_contacts.user_id
    )
  )
  or
  (
    firm_contacts.user_id is null
    and firm_contacts.user_email is not null
    and exists (
      select 1
      from public.users u
      where u.auth_id = auth.uid()
        and lower(u.email) = lower(firm_contacts.user_email)
    )
  )
)
with check (
  (
    firm_contacts.user_id is not null
    and exists (
      select 1
      from public.users u
      where u.auth_id = auth.uid()
        and u.id = firm_contacts.user_id
    )
  )
  or
  (
    firm_contacts.user_id is null
    and firm_contacts.user_email is not null
    and exists (
      select 1
      from public.users u
      where u.auth_id = auth.uid()
        and lower(u.email) = lower(firm_contacts.user_email)
    )
  )
);

-- Backfill helper (optional): link firm_contacts.user_id from matching user_email.
-- Run once after adding extern_firm_id to users and setting firm_contacts.user_email.
-- update public.firm_contacts fc
-- set user_id = u.id
-- from public.users u
-- where fc.user_id is null
--   and fc.user_email is not null
--   and lower(fc.user_email) = lower(u.email);

-- Optional: allow external users to read their firm name (firms table).
-- Only enable if you want extern users to see firm details.
-- alter table public.firms enable row level security;
-- drop policy if exists "firms_select_own_extern_firm" on public.firms;
-- create policy "firms_select_own_extern_firm"
-- on public.firms
-- for select
-- using (
--   exists (
--     select 1
--     from public.users u
--     where u.auth_id = auth.uid()
--       and u.extern_firm_id = firms.id
--   )
-- );


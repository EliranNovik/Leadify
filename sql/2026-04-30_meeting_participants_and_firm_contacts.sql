-- 2026-04-30: Firm contacts + meeting participants (internal meeting attendees)

-- 1) Firm contacts table (as requested)
create table if not exists public.firm_contacts (
  id uuid not null default gen_random_uuid (),
  firm_id uuid not null,
  name text not null,
  email text null,
  second_email text null,
  phone text null,
  profile_image_url text null,
  user_email text null,
  password_hash text null,
  firm_owner boolean not null default false,
  is_active boolean not null default true,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  user_id uuid null,
  constraint firm_contacts_pkey primary key (id),
  constraint firm_contacts_firm_id_fkey foreign key (firm_id) references firms (id) on delete cascade,
  constraint firm_contacts_user_id_fkey foreign key (user_id) references users (id) on delete set null
) tablespace pg_default;

create index if not exists idx_firm_contacts_firm on public.firm_contacts using btree (firm_id) tablespace pg_default;

create index if not exists idx_firm_contacts_email on public.firm_contacts using btree (email) tablespace pg_default
where (email is not null);

create index if not exists idx_firm_contacts_user_email on public.firm_contacts using btree (user_email) tablespace pg_default
where (user_email is not null);

create unique index if not exists uq_firm_one_primary_owner on public.firm_contacts using btree (firm_id) tablespace pg_default
where (firm_owner = true);

create unique index if not exists uq_firm_contacts_user_email on public.firm_contacts using btree (user_email) tablespace pg_default
where (user_email is not null);

create index if not exists idx_firm_contacts_user_id on public.firm_contacts using btree (user_id) tablespace pg_default;

create unique index if not exists uq_firm_contacts_user_id on public.firm_contacts using btree (user_id) tablespace pg_default
where (user_id is not null);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'tr_firm_contacts_updated_at'
  ) then
    create trigger tr_firm_contacts_updated_at
    before update on public.firm_contacts
    for each row
    execute function firms_touch_updated_at ();
  end if;
end $$;

-- 3) Allow internal staff meetings in meetings.calendar_type
-- Existing constraint often allows only 'potential_client' and 'active_client'.
-- We add 'staff' so the Internal Meeting modal can insert rows with calendar_type='staff'.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'meetings_calendar_type_check'
  ) then
    alter table public.meetings drop constraint meetings_calendar_type_check;
  end if;
exception when undefined_table then
  -- ignore if meetings table doesn't exist in this environment
end $$;

alter table public.meetings
  add constraint meetings_calendar_type_check check (
    (calendar_type)::text = any (
      (array[
        'potential_client'::character varying,
        'active_client'::character varying,
        'staff'::character varying
      ])::text[]
    )
  );

-- 2) Meeting participants table
-- Each participant row is ONE of:
-- - employee_id (staff)
-- - firm_contact_id (firm contact)
-- - free participant (free_name + optional email/phone/notes)
create table if not exists public.meeting_participants (
  id uuid not null default gen_random_uuid (),
  meeting_id integer not null,
  employee_id bigint null,
  firm_contact_id uuid null,
  free_name text null,
  free_email text null,
  free_phone text null,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint meeting_participants_pkey primary key (id),
  constraint meeting_participants_meeting_id_fkey foreign key (meeting_id) references public.meetings (id) on delete cascade,
  constraint meeting_participants_employee_id_fkey foreign key (employee_id) references public.tenants_employee (id) on delete set null,
  constraint meeting_participants_firm_contact_id_fkey foreign key (firm_contact_id) references public.firm_contacts (id) on delete set null,
  constraint meeting_participants_one_source_chk check (
    (
      (case when employee_id is null then 0 else 1 end) +
      (case when firm_contact_id is null then 0 else 1 end) +
      (case when free_name is null or btrim(free_name) = '' then 0 else 1 end)
    ) = 1
  )
) tablespace pg_default;

create index if not exists idx_meeting_participants_meeting on public.meeting_participants using btree (meeting_id) tablespace pg_default;
create index if not exists idx_meeting_participants_employee on public.meeting_participants using btree (employee_id) tablespace pg_default
where (employee_id is not null);
create index if not exists idx_meeting_participants_firm_contact on public.meeting_participants using btree (firm_contact_id) tablespace pg_default
where (firm_contact_id is not null);
create index if not exists idx_meeting_participants_free_email on public.meeting_participants using btree (free_email) tablespace pg_default
where (free_email is not null);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'tr_meeting_participants_updated_at'
  ) then
    create trigger tr_meeting_participants_updated_at
    before update on public.meeting_participants
    for each row
    execute function firms_touch_updated_at ();
  end if;
end $$;

-- 4) RLS for meeting_participants
-- The app writes meeting_participants from the Internal Meeting modal.
-- In this project, similar tables typically allow authenticated CRUD (see other sql/*rls*.sql files).
alter table public.meeting_participants enable row level security;

drop policy if exists "meeting_participants_authenticated_select" on public.meeting_participants;
drop policy if exists "meeting_participants_authenticated_insert" on public.meeting_participants;
drop policy if exists "meeting_participants_authenticated_update" on public.meeting_participants;
drop policy if exists "meeting_participants_authenticated_delete" on public.meeting_participants;
drop policy if exists "meeting_participants_anon_insert" on public.meeting_participants;

create policy "meeting_participants_authenticated_select"
on public.meeting_participants
for select
to authenticated
using (true);

create policy "meeting_participants_authenticated_insert"
on public.meeting_participants
for insert
to authenticated
with check (true);

-- Some environments/sessions may still operate under `anon` (e.g. missing auth JWT on client).
-- Allow anon inserts as well so meeting creation doesn't partially fail.
create policy "meeting_participants_anon_insert"
on public.meeting_participants
for insert
to anon
with check (true);

create policy "meeting_participants_authenticated_update"
on public.meeting_participants
for update
to authenticated
using (true)
with check (true);

create policy "meeting_participants_authenticated_delete"
on public.meeting_participants
for delete
to authenticated
using (true);

grant select, insert, update, delete on public.meeting_participants to authenticated;
grant select, insert, update, delete on public.meeting_participants to anon;


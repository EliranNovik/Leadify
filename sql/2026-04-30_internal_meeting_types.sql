-- 2026-04-30: Internal meeting type lookup + meetings.internal_meeting_type_id

create table if not exists public.internal_meeting_types (
  id smallserial primary key,
  code text not null unique,
  label text not null,
  sort_order smallint not null default 0
);

insert into public.internal_meeting_types (code, label, sort_order)
values
  ('staff', 'Staff', 10),
  ('providers', 'Providers', 20),
  ('sub_contractor', 'Sub Contractor', 30),
  ('extern', 'Extern', 40),
  ('firm', 'Firm', 50),
  ('lawyer_group', 'Lawyer Group', 60),
  ('sponsor', 'Sponsor', 70),
  ('other', 'Other', 80)
on conflict (code) do nothing;

alter table public.meetings
  add column if not exists internal_meeting_type_id smallint null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meetings_internal_meeting_type_id_fkey'
  ) then
    alter table public.meetings
      add constraint meetings_internal_meeting_type_id_fkey
      foreign key (internal_meeting_type_id) references public.internal_meeting_types (id) on delete set null;
  end if;
end $$;

create index if not exists idx_meetings_internal_meeting_type on public.meetings (internal_meeting_type_id)
where internal_meeting_type_id is not null;

alter table public.internal_meeting_types enable row level security;

drop policy if exists "internal_meeting_types_select_authenticated" on public.internal_meeting_types;
drop policy if exists "internal_meeting_types_select_anon" on public.internal_meeting_types;

create policy "internal_meeting_types_select_authenticated"
on public.internal_meeting_types
for select
to authenticated
using (true);

create policy "internal_meeting_types_select_anon"
on public.internal_meeting_types
for select
to anon
using (true);

grant select on public.internal_meeting_types to authenticated, anon;

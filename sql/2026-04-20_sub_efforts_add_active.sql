-- Add `active` flag to lookup table for admin control

alter table public.sub_efforts
  add column if not exists active boolean not null default true;

create index if not exists idx_sub_efforts_active on public.sub_efforts(active);


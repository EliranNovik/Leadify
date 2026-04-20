-- Allow authenticated users to manage sub_efforts (lookup table).
-- Needed for Admin UI inserts/updates under RLS.

alter table public.sub_efforts enable row level security;

drop policy if exists "sub_efforts_authenticated_insert" on public.sub_efforts;
drop policy if exists "sub_efforts_authenticated_update" on public.sub_efforts;
drop policy if exists "sub_efforts_authenticated_delete" on public.sub_efforts;

create policy "sub_efforts_authenticated_insert" on public.sub_efforts
  for insert
  to authenticated
  with check (true);

create policy "sub_efforts_authenticated_update" on public.sub_efforts
  for update
  to authenticated
  using (true)
  with check (true);

create policy "sub_efforts_authenticated_delete" on public.sub_efforts
  for delete
  to authenticated
  using (true);

grant insert, update, delete on public.sub_efforts to authenticated;

do $$
begin
  grant usage, select on sequence public.sub_efforts_id_seq to authenticated;
exception when undefined_table or invalid_schema_name then
  null;
end;
$$;


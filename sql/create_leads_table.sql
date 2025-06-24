create table leads (
  id uuid default uuid_generate_v4() primary key,
  lead_number text not null unique,
  name text not null,
  email text,
  phone text,
  source text not null,
  language text not null,
  topic text,
  facts text,
  special_notes text,
  created_at timestamp with time zone default now(),
  status text default 'new'
); 
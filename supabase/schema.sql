-- Minimal tables for visitor-based chips + admin topups.
-- Run in Supabase SQL editor.

create table if not exists public.users (
  visitor_id text primary key,
  fingerprint_hash text not null,
  chip_balance integer not null default 200,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_fingerprint_hash_idx on public.users (fingerprint_hash);

create table if not exists public.chip_ledger (
  id bigserial primary key,
  visitor_id text not null references public.users(visitor_id) on delete cascade,
  delta integer not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists chip_ledger_visitor_id_idx on public.chip_ledger (visitor_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();


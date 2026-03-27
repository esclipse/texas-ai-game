-- Auth wallet schema (multi-device shared chips)
-- Run once in Supabase SQL editor.

create table if not exists public.player_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chip_balance int not null default 200 check (chip_balance >= 0 and chip_balance <= 200),
  daily_grant_date date not null default (now() at time zone 'Asia/Shanghai')::date,
  updated_at timestamptz not null default now()
);

alter table public.player_wallets
  add column if not exists daily_grant_date date not null default (now() at time zone 'Asia/Shanghai')::date;

alter table public.player_wallets
  drop constraint if exists player_wallets_chip_balance_check;

alter table public.player_wallets
  add constraint player_wallets_chip_balance_check check (chip_balance >= 0 and chip_balance <= 200);

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.player_wallets enable row level security;
alter table public.player_profiles enable row level security;

drop policy if exists "wallet self read" on public.player_wallets;
create policy "wallet self read"
  on public.player_wallets
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "profile self read" on public.player_profiles;
create policy "profile self read"
  on public.player_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "profile self write" on public.player_profiles;
create policy "profile self write"
  on public.player_profiles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


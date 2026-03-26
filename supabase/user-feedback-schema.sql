-- User profile + feedback tables for texas-ai-game
-- Run in Supabase SQL editor once.

create table if not exists public.user_profiles (
  visitor_id text primary key references public.users(visitor_id) on delete cascade,
  nickname text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_records (
  id bigint generated always as identity primary key,
  visitor_id text not null references public.users(visitor_id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_records_visitor_created
  on public.feedback_records (visitor_id, created_at desc);

alter table public.user_profiles enable row level security;
alter table public.feedback_records enable row level security;

-- Server-side API uses service_role, so deny anon by default.
drop policy if exists "deny all user_profiles anon" on public.user_profiles;
create policy "deny all user_profiles anon"
  on public.user_profiles
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "deny all feedback_records anon" on public.feedback_records;
create policy "deny all feedback_records anon"
  on public.feedback_records
  for all
  to anon
  using (false)
  with check (false);


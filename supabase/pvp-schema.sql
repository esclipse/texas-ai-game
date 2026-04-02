-- PVP Heads-up rooms (2 players) + realtime state
-- Run once in Supabase SQL editor.

create table if not exists public.pvp_rooms (
  room_id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  guest_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting','playing','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pvp_rooms_host on public.pvp_rooms(host_user_id, created_at desc);
create index if not exists idx_pvp_rooms_guest on public.pvp_rooms(guest_user_id, created_at desc);

create table if not exists public.pvp_game_states (
  room_id uuid primary key references public.pvp_rooms(room_id) on delete cascade,
  state_json jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.pvp_rooms enable row level security;
alter table public.pvp_game_states enable row level security;

-- Read policies (participants only). Writes are done via server service role.
drop policy if exists "pvp_rooms participant read" on public.pvp_rooms;
create policy "pvp_rooms participant read"
  on public.pvp_rooms
  for select
  to authenticated
  using (auth.uid() = host_user_id or auth.uid() = guest_user_id);

drop policy if exists "pvp_game_states participant read" on public.pvp_game_states;
create policy "pvp_game_states participant read"
  on public.pvp_game_states
  for select
  to authenticated
  using (exists (
    select 1 from public.pvp_rooms r
    where r.room_id = pvp_game_states.room_id
      and (auth.uid() = r.host_user_id or auth.uid() = r.guest_user_id)
  ));

-- Deny direct client writes (service role bypasses RLS anyway).
drop policy if exists "pvp_rooms deny write" on public.pvp_rooms;
create policy "pvp_rooms deny write"
  on public.pvp_rooms
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "pvp_game_states deny write" on public.pvp_game_states;
create policy "pvp_game_states deny write"
  on public.pvp_game_states
  for all
  to authenticated
  using (false)
  with check (false);

-- PVP 免邮箱登录：在 Supabase Dashboard → Authentication → Providers 中开启 Anonymous，
-- 客户端即可 signInAnonymously()，仍使用 JWT 与 auth.users 外键，无需改本表结构。

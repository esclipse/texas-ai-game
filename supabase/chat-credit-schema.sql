-- 角色扮演 credit（player_wallets.credit_*）：每日 200（按 Asia/Shanghai），每次 /api/chat 扣 10。
-- 与德州筹码 chip_balance / daily_grant_date 完全独立日刷；勿在 auth-wallet 里混刷 credit。
-- Run in Supabase SQL editor (after auth-wallet-schema.sql).

alter table public.player_wallets
  add column if not exists credit_balance int not null default 200
    constraint player_wallets_credit_balance_check check (credit_balance >= 0 and credit_balance <= 200);

alter table public.player_wallets
  add column if not exists credit_grant_date date not null
    default ((now() at time zone 'Asia/Shanghai')::date);

-- Atomically: refresh credits on new Asia/Shanghai calendar day, then deduct p_cost if enough.
create or replace function public.consume_chat_credit(p_user_id uuid, p_cost int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_credit int;
  v_grant date;
begin
  if p_cost is null or p_cost < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_cost');
  end if;

  select credit_balance, credit_grant_date into v_credit, v_grant
  from public.player_wallets
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_wallet');
  end if;

  if v_grant is null or v_grant < v_today then
    update public.player_wallets
    set
      credit_balance = 200,
      credit_grant_date = v_today,
      updated_at = now()
    where user_id = p_user_id
    returning credit_balance into v_credit;
  end if;

  if v_credit < p_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credit', 'credit_balance', v_credit);
  end if;

  update public.player_wallets
  set
    credit_balance = credit_balance - p_cost,
    updated_at = now()
  where user_id = p_user_id;

  select credit_balance into v_credit from public.player_wallets where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'credit_balance', v_credit);
end;
$$;

revoke all on function public.consume_chat_credit(uuid, int) from public;
grant execute on function public.consume_chat_credit(uuid, int) to service_role;

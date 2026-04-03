import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

function todayCstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function getAuthedUser(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return { ok: false as const, error: "Missing bearer token" };

  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, error: "Unauthorized" };
  return { ok: true as const, userId: data.user.id };
}

const normCredit = (v: unknown) => Math.max(0, Math.min(200, Math.floor(Number(v) || 0)));

/**
 * 角色扮演专用：只读/只刷 credit，不涉及德州筹码 daily_grant / chip_balance。
 * 与 GET /api/auth-wallet 结算逻辑完全独立。
 */
export async function GET(req: Request) {
  const auth = await getAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const today = todayCstDate();

  const supabase = supabaseAdmin();
  const { data: existing, error: selErr } = await supabase
    .from("player_wallets")
    .select("credit_balance, credit_grant_date")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (!existing) {
    const { data: inserted, error: insErr } = await supabase
      .from("player_wallets")
      .insert({
        user_id: auth.userId,
        chip_balance: 200,
        daily_grant_date: today,
        credit_balance: 200,
        credit_grant_date: today,
      })
      .select("credit_balance, credit_grant_date")
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({
      creditBalance: normCredit(inserted.credit_balance),
      creditGrantDate: inserted.credit_grant_date ?? today,
    });
  }

  const creditDay = (existing.credit_grant_date ?? "") as string;
  if (creditDay === today) {
    return NextResponse.json({
      creditBalance: normCredit(existing.credit_balance),
      creditGrantDate: existing.credit_grant_date ?? today,
    });
  }

  const { data: updated, error: upErr } = await supabase
    .from("player_wallets")
    .update({
      credit_balance: 200,
      credit_grant_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", auth.userId)
    .select("credit_balance, credit_grant_date")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({
    creditBalance: normCredit(updated.credit_balance),
    creditGrantDate: updated.credit_grant_date ?? today,
  });
}

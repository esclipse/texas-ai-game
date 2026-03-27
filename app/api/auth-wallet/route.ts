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

export async function GET(req: Request) {
  const auth = await getAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const today = todayCstDate();

  const supabase = supabaseAdmin();
  const { data: existing, error: selErr } = await supabase
    .from("player_wallets")
    .select("chip_balance, daily_grant_date")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (existing) {
    const hasGrantedToday = (existing.daily_grant_date ?? "") === today;
    if (hasGrantedToday) {
      return NextResponse.json({
        userId: auth.userId,
        chipBalance: Math.max(0, Math.min(200, Math.floor(existing.chip_balance ?? 0))),
        dailyGrantDate: existing.daily_grant_date,
      });
    }
    const { data: resetData, error: resetErr } = await supabase
      .from("player_wallets")
      .update({
        chip_balance: 200,
        daily_grant_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.userId)
      .select("chip_balance, daily_grant_date")
      .single();
    if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 500 });
    return NextResponse.json({
      userId: auth.userId,
      chipBalance: Math.max(0, Math.min(200, Math.floor(resetData.chip_balance ?? 200))),
      dailyGrantDate: resetData.daily_grant_date,
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("player_wallets")
    .insert({ user_id: auth.userId, chip_balance: 200, daily_grant_date: today })
    .select("chip_balance, daily_grant_date")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    userId: auth.userId,
    chipBalance: Math.max(0, Math.min(200, Math.floor(inserted.chip_balance ?? 200))),
    dailyGrantDate: inserted.daily_grant_date,
  });
}

type BalanceBody = {
  chipBalance: number;
};

export async function POST(req: Request) {
  const auth = await getAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const today = todayCstDate();

  const body = (await req.json()) as Partial<BalanceBody>;
  const chipBalance = typeof body.chipBalance === "number" ? Math.floor(body.chipBalance) : NaN;
  if (!Number.isFinite(chipBalance) || chipBalance < 0 || chipBalance > 200) {
    return NextResponse.json({ error: "Invalid chipBalance" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("player_wallets")
    .upsert(
      {
        user_id: auth.userId,
        chip_balance: chipBalance,
        daily_grant_date: today,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, userId: auth.userId, chipBalance });
}


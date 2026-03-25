import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

type Body = {
  visitorId: string;
  chipBalance: number;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Body>;
  const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
  const chipBalance = typeof body.chipBalance === "number" ? Math.floor(body.chipBalance) : NaN;

  if (!visitorId) return NextResponse.json({ error: "Missing visitorId" }, { status: 400 });
  if (!Number.isFinite(chipBalance) || chipBalance < 0) {
    return NextResponse.json({ error: "Invalid chipBalance" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("users")
    .update({ chip_balance: chipBalance })
    .eq("visitor_id", visitorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}


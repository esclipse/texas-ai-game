import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

type Body = {
  adminToken: string;
  visitorId: string;
  delta: number;
  reason?: string;
};

function requireAdmin(body: Partial<Body>) {
  const expected = (process.env.ADMIN_TOKEN ?? "").trim();
  if (!expected) return { ok: false as const, error: "Missing ADMIN_TOKEN on server" };
  const got = typeof body.adminToken === "string" ? body.adminToken.trim() : "";
  if (!got || got !== expected) return { ok: false as const, error: "Unauthorized" };
  return { ok: true as const };
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Body>;
  const auth = requireAdmin(body);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
  const delta = typeof body.delta === "number" ? Math.floor(body.delta) : NaN;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 80) : "admin topup";

  if (!visitorId) return NextResponse.json({ error: "Missing visitorId" }, { status: 400 });
  if (!Number.isFinite(delta) || delta === 0) return NextResponse.json({ error: "Invalid delta" }, { status: 400 });

  const supabase = supabaseAdmin();

  const { data: user, error: selErr } = await supabase
    .from("users")
    .select("visitor_id, chip_balance")
    .eq("visitor_id", visitorId)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const nextBalance = Math.max(0, (user.chip_balance ?? 0) + delta);

  const { error: upErr } = await supabase
    .from("users")
    .update({ chip_balance: nextBalance })
    .eq("visitor_id", visitorId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Optional ledger
  await supabase.from("chip_ledger").insert({
    visitor_id: visitorId,
    delta,
    reason,
  });

  return NextResponse.json({ ok: true, visitorId, chipBalance: nextBalance });
}


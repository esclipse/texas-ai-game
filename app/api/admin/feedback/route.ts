import { NextResponse } from "next/server";

import { getAdminToken } from "@/lib/app-config";
import { supabaseAdmin } from "@/lib/supabase/server";

function verifyAdminToken(raw: string | null) {
  const expected = getAdminToken();
  if (!expected) return { ok: false as const, error: "Missing ADMIN_TOKEN on server" };
  const got = (raw ?? "").trim();
  if (!got || got !== expected) return { ok: false as const, error: "Unauthorized" };
  return { ok: true as const };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = verifyAdminToken(url.searchParams.get("adminToken"));
  if (!token.ok) return NextResponse.json({ error: token.error }, { status: 401 });

  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;

  const supabase = supabaseAdmin();
  const { data: records, error } = await supabase
    .from("feedback_records")
    .select("id, visitor_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const visitorIds = Array.from(new Set((records ?? []).map((r) => String(r.visitor_id))));
  const { data: profiles } = visitorIds.length
    ? await supabase
        .from("user_profiles")
        .select("visitor_id, nickname")
        .in("visitor_id", visitorIds)
    : { data: [] as Array<{ visitor_id: string; nickname: string | null }> };
  const nicknameMap = new Map((profiles ?? []).map((p) => [p.visitor_id, p.nickname ?? ""]));

  return NextResponse.json({
    items: (records ?? []).map((x) => ({
      id: String(x.id),
      visitorId: x.visitor_id,
      nickname: nicknameMap.get(String(x.visitor_id)) ?? "",
      content: x.content ?? "",
      createdAt: x.created_at ?? null,
    })),
  });
}


import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

type ProfileBody = {
  visitorId: string;
  nickname?: string;
};

function normalizeVisitorId(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeNickname(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 12);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const visitorId = normalizeVisitorId(url.searchParams.get("visitorId"));
  if (!visitorId) return NextResponse.json({ error: "Missing visitorId" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("visitor_id, nickname, updated_at")
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ visitorId, nickname: "" });

  return NextResponse.json({
    visitorId: data.visitor_id,
    nickname: data.nickname ?? "",
    updatedAt: data.updated_at ?? null,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<ProfileBody>;
  const visitorId = normalizeVisitorId(body.visitorId);
  const nickname = normalizeNickname(body.nickname);

  if (!visitorId) return NextResponse.json({ error: "Missing visitorId" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("user_profiles")
    .upsert(
      {
        visitor_id: visitorId,
        nickname,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "visitor_id" }
    )
    .select("visitor_id, nickname, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    visitorId: data.visitor_id,
    nickname: data.nickname ?? "",
    updatedAt: data.updated_at ?? null,
  });
}


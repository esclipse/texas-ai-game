import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

type FeedbackBody = {
  visitorId: string;
  content: string;
};

function normalizeVisitorId(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeContent(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 300);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const visitorId = normalizeVisitorId(url.searchParams.get("visitorId"));
  if (!visitorId) return NextResponse.json({ error: "Missing visitorId" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("feedback_records")
    .select("id, visitor_id, content, created_at")
    .eq("visitor_id", visitorId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    items: (data ?? []).map((x) => ({
      id: String(x.id),
      visitorId: x.visitor_id,
      content: x.content ?? "",
      createdAt: x.created_at ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<FeedbackBody>;
  const visitorId = normalizeVisitorId(body.visitorId);
  const content = normalizeContent(body.content);

  if (!visitorId) return NextResponse.json({ error: "Missing visitorId" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "Missing content" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("feedback_records")
    .insert({
      visitor_id: visitorId,
      content,
    })
    .select("id, visitor_id, content, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    item: {
      id: String(data.id),
      visitorId: data.visitor_id,
      content: data.content ?? "",
      createdAt: data.created_at ?? null,
    },
  });
}


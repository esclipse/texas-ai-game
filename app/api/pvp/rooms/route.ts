import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { requireAuthedUserId } from "@/app/api/pvp/_auth";

export async function POST(req: Request) {
  const auth = await requireAuthedUserId(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("pvp_rooms")
    .insert({
      host_user_id: auth.userId,
      status: "waiting",
    })
    .select("room_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ roomId: data.room_id });
}


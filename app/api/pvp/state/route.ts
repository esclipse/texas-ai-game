import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { requireAuthedUserId } from "@/app/api/pvp/_auth";

export async function GET(req: Request) {
  const auth = await requireAuthedUserId(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const roomId = (url.searchParams.get("roomId") ?? "").trim();
  if (!roomId) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: room, error: roomErr } = await supabase
    .from("pvp_rooms")
    .select("room_id, host_user_id, guest_user_id, status")
    .eq("room_id", roomId)
    .maybeSingle();
  if (roomErr) return NextResponse.json({ error: roomErr.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  if (auth.userId !== room.host_user_id && auth.userId !== room.guest_user_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: gs, error: gsErr } = await supabase
    .from("pvp_game_states")
    .select("state_json, version, updated_at")
    .eq("room_id", roomId)
    .maybeSingle();
  if (gsErr) return NextResponse.json({ error: gsErr.message }, { status: 500 });

  return NextResponse.json({
    room: {
      roomId: room.room_id,
      status: room.status,
      hostUserId: room.host_user_id,
      guestUserId: room.guest_user_id ?? null,
    },
    game: gs
      ? { state: gs.state_json, version: gs.version, updatedAt: gs.updated_at }
      : null,
  });
}


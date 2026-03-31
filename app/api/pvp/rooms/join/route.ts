import { NextResponse } from "next/server";

import { createNewHand, type Player } from "@/lib/game";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireAuthedUserId } from "@/app/api/pvp/_auth";

type Body = { roomId: string };

function normalizeRoomId(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : "";
}

export async function POST(req: Request) {
  const auth = await requireAuthedUserId(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = (await req.json()) as Partial<Body>;
  const roomId = normalizeRoomId(body.roomId);
  if (!roomId) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

  const supabase = supabaseAdmin();

  const { data: room, error: selErr } = await supabase
    .from("pvp_rooms")
    .select("room_id, host_user_id, guest_user_id, status")
    .eq("room_id", roomId)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  if (room.host_user_id === auth.userId) {
    return NextResponse.json({ ok: true, role: "host", roomId: room.room_id, status: room.status, guestUserId: room.guest_user_id ?? null });
  }

  if (room.guest_user_id && room.guest_user_id !== auth.userId) {
    return NextResponse.json({ error: "ROOM_FULL" }, { status: 409 });
  }

  if (!room.guest_user_id) {
    // Atomic claim: only one user can set guest_user_id.
    const { data: claimed, error: claimErr } = await supabase
      .from("pvp_rooms")
      .update({
        guest_user_id: auth.userId,
        status: "playing",
        updated_at: new Date().toISOString(),
      })
      .eq("room_id", roomId)
      .is("guest_user_id", null)
      .select("room_id, host_user_id, guest_user_id, status")
      .maybeSingle();

    if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
    if (!claimed) return NextResponse.json({ error: "ROOM_FULL" }, { status: 409 });

    // Initialize game state if absent.
    const p1: Player = {
      id: "p1",
      name: "房主",
      stack: 200,
      isHuman: true,
      model: "human",
      style: "gto",
      emotion: "calm",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: "",
    };
    const p2: Player = {
      id: "p2",
      name: "对手",
      stack: 200,
      isHuman: true,
      model: "human",
      style: "gto",
      emotion: "calm",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: "",
    };
    const initial = createNewHand(1, [p1, p2]);

    await supabase.from("pvp_game_states").insert({
      room_id: roomId,
      state_json: initial,
      version: 1,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, role: "guest", roomId: claimed.room_id, status: claimed.status, hostUserId: claimed.host_user_id });
  }

  // Rejoin as guest
  return NextResponse.json({ ok: true, role: "guest", roomId: room.room_id, status: room.status, hostUserId: room.host_user_id });
}


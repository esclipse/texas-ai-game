import { NextResponse } from "next/server";

import { applyActionToState, type ActionType, type HandState } from "@/lib/game";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireAuthedUserId } from "@/app/api/pvp/_auth";

type Body = {
  roomId: string;
  action: ActionType;
  raiseBy?: number;
  text?: string;
  expectedVersion?: number;
};

export async function POST(req: Request) {
  const auth = await requireAuthedUserId(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = (await req.json()) as Partial<Body>;
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  const action = body.action as ActionType;
  const raiseBy = typeof body.raiseBy === "number" ? Math.floor(body.raiseBy) : 0;
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 60) : undefined;
  const expectedVersion = typeof body.expectedVersion === "number" ? Math.floor(body.expectedVersion) : null;

  if (!roomId) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
  if (!["fold", "call", "raise", "check"].includes(action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const supabase = supabaseAdmin();

  const { data: room, error: roomErr } = await supabase
    .from("pvp_rooms")
    .select("room_id, host_user_id, guest_user_id, status")
    .eq("room_id", roomId)
    .maybeSingle();
  if (roomErr) return NextResponse.json({ error: roomErr.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.status !== "playing") return NextResponse.json({ error: "Room not ready" }, { status: 409 });
  if (auth.userId !== room.host_user_id && auth.userId !== room.guest_user_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const myPlayerId = auth.userId === room.host_user_id ? "p1" : "p2";

  const { data: gs, error: gsErr } = await supabase
    .from("pvp_game_states")
    .select("state_json, version")
    .eq("room_id", roomId)
    .single();
  if (gsErr) return NextResponse.json({ error: gsErr.message }, { status: 500 });

  const version = Number(gs.version ?? 0) || 0;
  if (expectedVersion != null && expectedVersion !== version) {
    return NextResponse.json({ error: "VERSION_CONFLICT", version }, { status: 409 });
  }

  const state = gs.state_json as HandState;
  const toAct = state.players[state.toActIndex];
  if (!toAct || toAct.id !== myPlayerId) {
    return NextResponse.json({ error: "NOT_YOUR_TURN" }, { status: 409 });
  }

  const next = applyActionToState(state, myPlayerId, action, raiseBy, text);

  const { data: updated, error: upErr } = await supabase
    .from("pvp_game_states")
    .update({
      state_json: next,
      version: version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("room_id", roomId)
    .eq("version", version)
    .select("version")
    .maybeSingle();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "VERSION_CONFLICT", version }, { status: 409 });

  return NextResponse.json({ ok: true, version: version + 1 });
}


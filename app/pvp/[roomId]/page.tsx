"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ensurePvpSupabaseSession } from "@/lib/pvp-session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ActionType, HandState } from "@/lib/game";

type RoomInfo = {
  roomId: string;
  status: "waiting" | "playing" | "ended";
  hostUserId: string;
  guestUserId: string | null;
};

export default function PvpRoomPage() {
  const params = useParams() as { roomId?: string };
  const roomId = String(params.roomId ?? "").trim();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string>("");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [state, setState] = useState<HandState | null>(null);
  const [version, setVersion] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setSessionError("");
      const got = await ensurePvpSupabaseSession();
      if (!alive) return;
      if (!got.ok) {
        setSessionError(got.error);
        return;
      }
      setAuthToken(got.accessToken);
      setUserId(got.userId);
    };
    void run();
    const sb = supabaseBrowser();
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setAuthToken(session?.access_token ?? null);
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authToken || !roomId) return;
    let cancelled = false;
    const run = async () => {
      setError("");
      try {
        const joinResp = await fetch("/api/pvp/rooms/join", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ roomId }),
        });
        const joinData = (await joinResp.json()) as { error?: string };
        if (!joinResp.ok) {
          setError(joinData.error ?? `Join failed (${joinResp.status})`);
          return;
        }

        const stResp = await fetch(`/api/pvp/state?roomId=${encodeURIComponent(roomId)}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const stData = (await stResp.json()) as { room?: RoomInfo; game?: { state: HandState; version: number } | null; error?: string };
        if (!stResp.ok || !stData.room) {
          setError(stData.error ?? `State failed (${stResp.status})`);
          return;
        }
        if (cancelled) return;
        setRoom(stData.room);
        setState(stData.game?.state ?? null);
        setVersion(stData.game?.version ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "unknown error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authToken, roomId]);

  useEffect(() => {
    if (!authToken || !roomId) return;
    const sb = supabaseBrowser();
    const ch = sb.channel(`pvp:${roomId}`);
    ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "pvp_game_states", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const next = (payload.new as { state_json?: HandState; version?: number } | null) ?? null;
        if (next?.state_json) setState(next.state_json);
        if (typeof next?.version === "number") setVersion(next.version);
      }
    ).subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [authToken, roomId]);

  const myPlayerId = useMemo(() => {
    if (!room || !userId) return null;
    if (userId === room.hostUserId) return "p1";
    if (userId === room.guestUserId) return "p2";
    return null;
  }, [room, userId]);

  const canAct = useMemo(() => {
    if (!state || !myPlayerId) return false;
    const toAct = state.players[state.toActIndex];
    return Boolean(toAct && toAct.id === myPlayerId && !state.isHandOver);
  }, [state, myPlayerId]);

  const toCall = useMemo(() => {
    if (!state || !myPlayerId) return 0;
    const me = state.players.find((p) => p.id === myPlayerId);
    if (!me) return 0;
    return Math.max(0, state.currentBet - me.currentBet);
  }, [state, myPlayerId]);

  const minRaise = useMemo(() => {
    if (!state) return 2;
    return Math.max(2, state.lastRaiseSize);
  }, [state]);

  const submit = async (action: ActionType, raiseBy = 0) => {
    if (!authToken || !roomId) return;
    if (!canAct) return;
    setBusy(true);
    setError("");
    try {
      const resp = await fetch("/api/pvp/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ roomId, action, raiseBy, expectedVersion: version }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) {
        setError(data.error ?? `Action failed (${resp.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  if (!roomId) {
    return <main className="p-4">Missing roomId</main>;
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 text-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-base font-semibold">单挑房间</div>
        <button
          type="button"
          className="max-w-[60%] truncate text-xs text-zinc-500 hover:text-zinc-900"
          title="点击复制房间号"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(roomId);
            } catch {
              // ignore
            }
          }}
        >
          room: <span className="font-mono">{roomId}</span>
        </button>
      </div>

      {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      {sessionError ? (
        <Card className="border-zinc-200">
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-semibold text-zinc-900">连接失败</div>
            <p className="text-sm text-zinc-600">{sessionError}</p>
            <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              返回首页
            </Link>
          </CardContent>
        </Card>
      ) : !authToken ? (
        <Card className="border-zinc-200">
          <CardContent className="p-4 text-sm text-zinc-600">正在进入房间…</CardContent>
        </Card>
      ) : room?.status === "waiting" ? (
        <Card className="border-zinc-200">
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-semibold">等待玩家加入…</div>
            <div className="text-xs text-zinc-600">把当前链接发给对方，对方打开后会自动加入。</div>
          </CardContent>
        </Card>
      ) : !state ? (
        <Card className="border-zinc-200">
          <CardContent className="p-4 text-sm text-zinc-600">加载中…</CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-200">
          <CardContent className="space-y-3 p-4">
            <div className="text-sm text-zinc-700">
              hand {state.handId} · {state.stage.toUpperCase()} · pot {state.pot}bb
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {state.players.map((p) => (
                <div key={p.id} className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{p.id === myPlayerId ? "你" : "对手"}</span>
                    <span className="tabular-nums">{p.stack}bb</span>
                  </div>
                  <div className="text-xs text-zinc-500">本轮下注 {p.currentBet}bb</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button disabled={!canAct || busy} onClick={() => void submit("fold", 0)}>
                弃牌
              </Button>
              <Button disabled={!canAct || busy} onClick={() => void submit(toCall > 0 ? "call" : "check", 0)}>
                {toCall > 0 ? `跟注 ${toCall}` : "过牌"}
              </Button>
              <Button disabled={!canAct || busy} variant="outline" onClick={() => void submit("raise", minRaise)}>
                加注 +{minRaise}
              </Button>
            </div>

            {!canAct ? <div className="text-xs text-zinc-500">等待对手行动…</div> : null}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, Loader2, RefreshCcw, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  applyActionToState,
  aiDecision,
  createDefaultPlayers,
  createNewHand,
  type ActionType,
  type Player,
  type PublicRole,
} from "@/lib/game";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AiRecordChat } from "@/components/ai-record-chat";

async function sha256Base64Url(input: string) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return base64;
}

function stableFingerprintSeed() {
  const nav = typeof navigator !== "undefined" ? navigator : (null as unknown as Navigator | null);
  const scr = typeof window !== "undefined" ? window.screen : (null as unknown as Screen | null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const parts = [
    `ua=${nav?.userAgent ?? ""}`,
    `lang=${nav?.language ?? ""}`,
    `platform=${(nav as unknown as { platform?: string })?.platform ?? ""}`,
    `hc=${(nav as unknown as { hardwareConcurrency?: number })?.hardwareConcurrency ?? ""}`,
    `dm=${(nav as unknown as { deviceMemory?: number })?.deviceMemory ?? ""}`,
    `tz=${tz}`,
    `so=${new Date().getTimezoneOffset()}`,
    `sw=${scr?.width ?? ""}`,
    `sh=${scr?.height ?? ""}`,
    `cd=${scr ? (scr as unknown as { colorDepth?: number })?.colorDepth ?? "" : ""}`,
    `pr=${typeof window !== "undefined" ? window.devicePixelRatio : ""}`,
  ];
  return parts.join("|");
}

export default function Home() {
  const [initialHand] = useState(() => {
    const basePlayers = createDefaultPlayers();
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("ai-game:chipBalance") : null;
      const v = raw ? Number(raw) : NaN;
      const bal = Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
      if (bal != null) {
        return createNewHand(1, basePlayers.map((p) => (p.id === "human" ? { ...p, stack: bal } : p)));
      }
    } catch {
      // ignore
    }
    return createNewHand(1, basePlayers);
  });
  const [handId, setHandId] = useState(1);
  const [state, setState] = useState(initialHand);
  const [publicRoles, setPublicRoles] = useState<PublicRole[] | null>(null);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [visitorBalance, setVisitorBalance] = useState<number | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [authMessage, setAuthMessage] = useState<string>("");
  const [authBusy, setAuthBusy] = useState(false);
  const [heroName, setHeroName] = useState<string>("");
  const [isResolving, setIsResolving] = useState(false);
  // Auto-enable voice + sfx; audio will be unlocked on first user gesture.
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceFollowAction] = useState(true);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceLevel] = useState<"key" | "all">("key");
  const [sfxEnabled] = useState(true);
  const [raiseMode, setRaiseMode] = useState<"min" | "2x" | "3x" | "allin">("min");
  const [showRaiseOptions, setShowRaiseOptions] = useState(false);
  const [winFx, setWinFx] = useState<{ text: string; winners: string[] } | null>(null);
  const [thinkingActorId, setThinkingActorId] = useState<string | null>(null);
  const [autoChatFeed, setAutoChatFeed] = useState<Array<{ id: string; speaker: string; content: string }>>([]);
  const lastAutoTriggerRef = useRef("");
  const autoCooldownRef = useRef<number[]>([]);
  const tauntCooldownRef = useRef<number[]>([]);
  const stateRef = useRef(state);
  const lastSyncedBalanceRef = useRef<number | null>(null);
  const balanceSyncTimerRef = useRef<number | null>(null);
  const nextStreetRef = useRef<() => Promise<void>>(async () => {});
  const lastProcessedActionRef = useRef("");
  const recordListRef = useRef<HTMLDivElement | null>(null);
  const appliedPublicRolesRef = useRef(false);
  const voiceAbortRef = useRef<AbortController | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceUnlockedRef = useRef(false);
  const voiceCtxRef = useRef<AudioContext | null>(null);
  const voiceSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const voiceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const voiceQueueDepthRef = useRef(0);
  const lastTtsAtRef = useRef(0);
  const lastTtsByNameRef = useRef<Record<string, number>>({});
  const lastSfxKeyRef = useRef("");

  const unlockAudio = useCallback(async () => {
    if (voiceUnlockedRef.current) return true;
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
        | typeof AudioContext
        | undefined;
      if (!Ctx) {
        voiceUnlockedRef.current = true;
        return true;
      }
      const ctx = voiceCtxRef.current ?? new Ctx();
      voiceCtxRef.current = ctx;
      if (ctx.state !== "running") await ctx.resume();

      // Tiny silent buffer to "prime" playback within a user gesture.
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);

      voiceUnlockedRef.current = true;
      return true;
    } catch {
      return false;
    }
  }, []);

  // Auto-unlock audio on first user gesture (required by browsers).
  useEffect(() => {
    const onFirstGesture = () => {
      void unlockAudio();
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      window.removeEventListener("touchstart", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture, { passive: true });
    window.addEventListener("touchstart", onFirstGesture, { passive: true });
    window.addEventListener("keydown", onFirstGesture);
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      window.removeEventListener("touchstart", onFirstGesture);
    };
  }, [unlockAudio]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ai-game:heroName") ?? "";
      setHeroName(raw.trim().slice(0, 12));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const sb = supabaseBrowser();
    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const session = data.session;
      setAuthUserId(session?.user?.id ?? null);
      setAuthToken(session?.access_token ?? null);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
      setAuthToken(session?.access_token ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUserId && !visitorId) {
      setShowLoginPanel(true);
    }
  }, [authUserId, visitorId]);

  useEffect(() => {
    if (authUserId || visitorId) {
      setShowLoginPanel(false);
    }
  }, [authUserId, visitorId]);

  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    const run = async () => {
      try {
        const resp = await fetch("/api/auth-wallet", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = (await resp.json()) as { chipBalance?: number };
        if (!resp.ok || typeof data.chipBalance !== "number" || cancelled) return;
        setVisitorBalance(Math.max(0, Math.floor(data.chipBalance)));
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  // Guest visitor mode (single 200 chips, no daily refill)
  useEffect(() => {
    if (authUserId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const cached = typeof window !== "undefined" ? window.localStorage.getItem("ai-game:visitorId") : null;
        if (cached && cached.trim()) setVisitorId(cached.trim());

        const seed = stableFingerprintSeed();
        const fp = await sha256Base64Url(`v1|${seed}`);
        const resp = await fetch("/api/visitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: fp }),
        });
        const data = (await resp.json()) as { visitorId?: string; chipBalance?: number };
        if (!resp.ok || !data.visitorId || typeof data.chipBalance !== "number") return;
        if (cancelled) return;
        setVisitorId(data.visitorId);
        setVisitorBalance(Math.max(0, Math.floor(data.chipBalance)));
        window.localStorage.setItem("ai-game:visitorId", data.visitorId);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  const playSfx = useCallback(
    (kind: "bet" | "check" | "fold" | "deal" | "win") => {
      if (!sfxEnabled) return;
      const ctx = voiceCtxRef.current;
      if (!voiceUnlockedRef.current || !ctx || ctx.state !== "running") return;
      try {
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.connect(ctx.destination);

        if (kind === "bet") {
          // short chip click
          const o = ctx.createOscillator();
          o.type = "square";
          o.frequency.setValueAtTime(900, now);
          gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
          o.connect(gain);
          o.start(now);
          o.stop(now + 0.065);
          return;
        }
        if (kind === "check") {
          const o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.setValueAtTime(620, now);
          gain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
          o.connect(gain);
          o.start(now);
          o.stop(now + 0.055);
          return;
        }
        if (kind === "fold") {
          const o = ctx.createOscillator();
          o.type = "triangle";
          o.frequency.setValueAtTime(360, now);
          o.frequency.exponentialRampToValueAtTime(180, now + 0.12);
          gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
          o.connect(gain);
          o.start(now);
          o.stop(now + 0.15);
          return;
        }
        if (kind === "deal") {
          // quick whoosh noise
          const bufferSize = 22050 * 0.08;
          const noiseBuffer = ctx.createBuffer(1, bufferSize, 22050);
          const data = noiseBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
          const src = ctx.createBufferSource();
          src.buffer = noiseBuffer;
          gain.gain.exponentialRampToValueAtTime(0.09, now + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
          src.connect(gain);
          src.start(now);
          src.stop(now + 0.095);
          return;
        }
        // win: two-tone chime
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.type = "sine";
        o2.type = "sine";
        o1.frequency.setValueAtTime(523.25, now);
        o2.frequency.setValueAtTime(659.25, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        o1.connect(gain);
        o2.connect(gain);
        o1.start(now);
        o2.start(now);
        o1.stop(now + 0.23);
        o2.stop(now + 0.23);
      } catch {
        // ignore
      }
    },
    [sfxEnabled]
  );

  const shouldSpeak = useCallback(
    (speakerName: string, actionType: ActionType, amount: number, stage: string, text: string) => {
      if (!voiceEnabled) return false;
      const t = (text ?? "").trim();
      if (!t) return false;

      // Global + per-speaker cooldown to reduce cost.
      const now = Date.now();
      const globalCooldownMs = voiceLevel === "all" ? 3500 : 9000;
      const perSpeakerCooldownMs = voiceLevel === "all" ? 8000 : 16000;
      if (now - lastTtsAtRef.current < globalCooldownMs) return false;
      const lastBy = lastTtsByNameRef.current[speakerName] ?? 0;
      if (now - lastBy < perSpeakerCooldownMs) return false;

      if (voiceLevel === "all") return true;

      // "key" mode: only speak on impactful actions.
      const bigBet = amount >= 8;
      const isRaise = actionType === "raise";
      const isFold = actionType === "fold";
      const lateStreet = stage !== "preflop";
      return isRaise || (lateStreet && bigBet) || isFold;
    },
    [voiceEnabled, voiceLevel]
  );

  const speak = useCallback(async (speakerName: string, speakerId: string | null, text: string) => {
    if (!voiceEnabled) return;
    const t = (text ?? "").trim();
    if (!t) return;
    // Queue playback to keep action order stable and avoid concurrent decode/play causing UI stalls.
    voiceQueueDepthRef.current += 1;
    setVoicePlaying(true);
    const job = async () => {
      setVoiceError(null);

      const hardTimeoutMs = 15000;
      const hardTimer = window.setTimeout(() => {
        setVoiceError("Voice timeout");
      }, hardTimeoutMs);

      try {
        voiceAbortRef.current?.abort();
        const controller = new AbortController();
        voiceAbortRef.current = controller;

        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Send only the spoken content. Use `speakerName` for server-side voice mapping.
            // Some TTS engines may stop early on bracketed prefixes like "【系统】".
            text: t,
            speakerName,
            speaker: speakerId ?? undefined,
            format: "mp3",
          }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          setVoiceError(`TTS ${resp.status}`);
          return;
        }
        const buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength < 200) {
          setVoiceError("TTS audio empty");
          return;
        }

        const ctx = voiceCtxRef.current;
        if (voiceUnlockedRef.current && ctx && ctx.state === "running") {
          // Stop previous source if any (in case user toggles quickly).
          try {
            voiceSourceRef.current?.stop();
          } catch {
            // ignore
          }
          voiceSourceRef.current = null;

          const audioBuf = await ctx.decodeAudioData(buf.slice(0));
          await new Promise<void>((resolve) => {
            const src = ctx.createBufferSource();
            voiceSourceRef.current = src;
            src.buffer = audioBuf;
            src.connect(ctx.destination);
            src.onended = () => resolve();
            src.start();
          });
          lastTtsAtRef.current = Date.now();
          lastTtsByNameRef.current = { ...lastTtsByNameRef.current, [speakerName]: Date.now() };
          return;
        }

        // If WebAudio isn't ready, don't try to play via HTMLAudioElement (it can overlap / be blocked).
        // Just skip this utterance to keep game flow stable.
        setVoiceError("Audio not unlocked");
      } catch {
        // ignore
      } finally {
        window.clearTimeout(hardTimer);
        voiceQueueDepthRef.current = Math.max(0, voiceQueueDepthRef.current - 1);
        if (voiceQueueDepthRef.current === 0) setVoicePlaying(false);
      }
    };

    voiceQueueRef.current = voiceQueueRef.current.then(job, job);
  }, [voiceEnabled]);


  // Load public config (roles etc.) once.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const resp = await fetch("/api/public-config");
        const data = (await resp.json()) as { public?: { roles?: PublicRole[] } };
        if (!resp.ok) return;
        const roles = Array.isArray(data.public?.roles) ? data.public?.roles : [];
        if (cancelled) return;
        setPublicRoles(roles);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Once we have visitor balance, rebuild the initial hand using that balance (avoids refresh resetting to 200).
  useEffect(() => {
    if (visitorBalance == null) return;
    const players = createDefaultPlayers({ roles: publicRoles ?? undefined }).map((p) =>
      p.id === "human" ? { ...p, stack: visitorBalance } : p
    );
    const next = createNewHand(1, players);
    lastSyncedBalanceRef.current = visitorBalance;
    syncState(next);
    setHandId(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitorBalance, publicRoles]);

  // If roles arrive after first render (and before any real play), rehydrate once.
  useEffect(() => {
    if (appliedPublicRolesRef.current) return;
    if (!publicRoles || publicRoles.length === 0) return;
    const isFresh = stateRef.current.handId === 1 && stateRef.current.actions.length <= 1;
    if (!isFresh) return;
    appliedPublicRolesRef.current = true;

    const humanStack =
      typeof visitorBalance === "number"
        ? visitorBalance
        : stateRef.current.players.find((p) => p.id === "human")?.stack ?? 200;

    const players = createDefaultPlayers({ roles: publicRoles }).map((p) => (p.id === "human" ? { ...p, stack: humanStack } : p));
    const next = createNewHand(1, players);
    syncState(next);
  }, [publicRoles, visitorBalance]);

  // Debounced chip balance sync to Supabase (server-side).
  useEffect(() => {
    if (!authToken && !visitorId) return;
    const humanNow = state.players.find((p) => p.id === "human");
    if (!humanNow) return;
    const bal = Math.max(0, Math.floor(humanNow.stack));
    try {
      window.localStorage.setItem("ai-game:chipBalance", String(bal));
    } catch {}
    if (lastSyncedBalanceRef.current === bal) return;

    if (balanceSyncTimerRef.current) window.clearTimeout(balanceSyncTimerRef.current);
    balanceSyncTimerRef.current = window.setTimeout(() => {
      const req = authToken
        ? fetch("/api/auth-wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ chipBalance: bal }),
          })
        : fetch("/api/balance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visitorId, chipBalance: bal }),
          });
      void req.finally(() => {
        lastSyncedBalanceRef.current = bal;
      });
    }, 900);

    return () => {
      if (balanceSyncTimerRef.current) window.clearTimeout(balanceSyncTimerRef.current);
    };
  }, [state.players, authToken, visitorId]);

  const human = state.players.find((p) => p.id === "human") ?? state.players[0];
  const isBusted = human.stack <= 0 && state.isHandOver;
  const seats = useMemo(() => {
    const arr = [...state.players];
    const n = arr.length;
    const humanIdx = arr.findIndex((p) => p.id === "human");
    if (humanIdx < 0 || n === 0) return arr;
    const targetIdx = 3; // keep human at bottom-center seat
    const shift = (humanIdx - targetIdx + n) % n;
    return Array.from({ length: n }, (_, i) => arr[(i + shift) % n]);
  }, [state.players]);
  const seatIndexById = useMemo(() => {
    const map = new Map<string, number>();
    state.players.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [state.players]);
  const humanCards = state.holeCards[human.id] ?? ["--", "--"];
  const toActPlayer = state.players[state.toActIndex];
  const humanToCall = Math.max(0, state.currentBet - human.currentBet);
  const minRaiseDelta = Math.max(2, state.lastRaiseSize);
  const raiseDeltaByMode = (mode: "min" | "2x" | "3x" | "allin") => {
    if (mode === "allin") return Math.max(minRaiseDelta, human.stack - humanToCall);
    if (mode === "2x") return minRaiseDelta * 2;
    if (mode === "3x") return minRaiseDelta * 3;
    return minRaiseDelta;
  };
  const selectedRaiseDelta = raiseDeltaByMode(raiseMode);
  const canHumanRaise = state.raiseCountThisRound < 3 && human.stack > humanToCall + minRaiseDelta;
  const isHumanTurn = Boolean(toActPlayer?.isHuman && !state.isHandOver);
  const revealAllHoleCards = state.stage === "showdown" || state.isHandOver;
  const guestOutOfChips = Boolean(!authUserId && visitorId && isBusted);
  const displayNickname = (heroName || "").trim() || "小鱼";

  useEffect(() => {
    if (!guestOutOfChips) return;
    setShowLoginPanel(true);
    setAuthMessage("访客筹码已用完，登录可领取今日 200bb。");
  }, [guestOutOfChips]);

  const seatRingClasses = [
    "left-1/2 top-3 -translate-x-1/2",
    "right-6 top-20",
    "right-6 bottom-20",
    "left-1/2 bottom-3 -translate-x-1/2",
    "left-6 bottom-20",
    "left-6 top-20",
  ];

  const statusText = useMemo(() => {
    if (!authUserId && !visitorId) return "请先登录或进入访客模式开始对局";
    if (guestOutOfChips) return "访客筹码已用完，登录可领取今日免费 200bb";
    if (isBusted) return "积分耗尽，无法继续。";
    if (human.stack <= 0 && !state.isHandOver) return "你已全下，等待摊牌结算。";
    if (authUserId) return "已登录 · 每日最多 200bb（不累加，次日重置）";
    if (visitorId) return "访客模式 · 200bb";
    const turn = state.isHandOver ? "本局结束" : `行动: ${toActPlayer?.name ?? "-"}`;
    return `第 ${state.handId} 局 · ${state.stage.toUpperCase()} · 底池 ${state.pot}bb · ${turn}`;
  }, [authUserId, visitorId, guestOutOfChips, isBusted, human.stack, state.handId, state.pot, state.stage, state.isHandOver, toActPlayer?.name]);

  const recordChatContext = useMemo(() => {
    const recent = state.actions
      .filter((a) => a.actor !== "系统")
      .slice(-10);

    const trim = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
    const aiPlayers = state.players.filter((p) => !p.isHuman);
    const aiBrief = aiPlayers
      .map((p) => {
        const mem = (p.memory ?? []).slice(0, 3).map((m) => trim(m, 60)).join(" | ");
        const sys = trim(p.systemPrompt || "", 90);
        return `- ${p.name}（${p.style}/${p.emotion}）：${sys}${mem ? `；记忆：${mem}` : ""}`;
      })
      .join("\n");

    const lines = recent.map((a) => {
      const amount = a.amount > 0 ? ` ${a.amount}bb` : "";
      const text = a.text ? `：${a.text}` : "";
      return `${a.actor} ${a.action}${amount}${text}`;
    });

    return `你在一个德州“AI 群聊”里与同桌 AI 对话。所有 AI 都能看到同一条消息，但每次由 1 个 AI 发言（支持 @指定发言者）。

参与 AI（可 @）：${aiPlayers.map((p) => p.name).join("、")}

AI 角色设定：
${aiBrief || "（无）"}

当前牌局：第 ${state.handId} 局 · ${state.stage.toUpperCase()} · 底池 ${state.pot}bb · 当前需跟注 ${humanToCall}bb

最近行动：${lines.join(" | ") || "（无）"}`;
  }, [state.actions, state.handId, state.stage, state.pot, humanToCall, state.players]);

  const groupChatFeed = useMemo(() => {
    const items = state.actions
      .filter((a) => a.actor !== "系统" && Boolean(a.text))
      .slice(-40)
      .map((a, idx) => ({
        id: `${state.handId}-${idx}-${a.actor}`,
        speaker: a.actor,
        content: a.text ?? "",
      }));
    return items;
  }, [state.actions, state.handId]);

  const pickTaunt = useCallback(
    (kind: "steal" | "maniac" | "station") => {
      const name = heroName?.trim() || "你";
      const poolByKind: Record<typeof kind, string[]> = {
        steal: [
          `${name}又想偷盲？我盯着你呢。`,
          `别装了，${name}你这位置又想拿走底池？`,
          `${name}别想白拿，这手我给你压力。`,
        ],
        maniac: [
          `${name}别上头，冲太狠容易被收掉。`,
          `又想硬怼？行，${name}我接着。`,
          `${name}你这节奏太急了，小心被反打。`,
        ],
        station: [
          `${name}你又想一路跟？这钱我可不白送你。`,
          `你这手要是想跟到底，${name}得先想清楚。`,
          `${name}别老当跟注机器，挑一手硬的再跟。`,
        ],
      };
      const arr = poolByKind[kind];
      return arr[Math.floor(Math.random() * arr.length)];
    },
    [heroName]
  );

  const parseGroupSpeaker = (text: string) => {
    const trimmed = text.trim();
    const m = trimmed.match(/^【([^】]{1,12})】\s*([\s\S]*)$/);
    if (!m) return { speaker: "AI", content: trimmed };
    return { speaker: m[1].trim() || "AI", content: (m[2] ?? "").trim() };
  };

  const extractUiSseText = async (resp: Response) => {
    const raw = await resp.text();
    const parts = raw.split("\n\n").map((x) => x.trim()).filter(Boolean);
    let out = "";
    for (const p of parts) {
      if (!p.startsWith("data: ")) continue;
      const payload = p.slice("data: ".length).trim();
      if (payload === "[DONE]") break;
      try {
        const obj = JSON.parse(payload) as { type?: string; delta?: string };
        if (obj.type === "text-delta" && typeof obj.delta === "string") out += obj.delta;
      } catch {
        // ignore non-json
      }
    }
    return out.trim();
  };

  useEffect(() => {
    // Optional taunt at human decision point when profile is clear.
    if (!isHumanTurn || state.isHandOver) return;
    const seatActor = state.players[state.toActIndex];
    if (!seatActor?.isHuman) return;

    const prof = state.humanProfile;
    if (!prof) return;
    const preflopHands = Math.max(1, (prof.preflopRaises ?? 0) + (prof.preflopCalls ?? 0) + (prof.preflopFolds ?? 0));
    if (preflopHands < 10) return; // need enough signal

    const raiseRate = (prof.preflopRaises ?? 0) / preflopHands;
    const callRate = (prof.preflopCalls ?? 0) / preflopHands;
    const allInRate = (prof.allIns ?? 0) / preflopHands;
    const stealRate = (prof.stealsLatePos ?? 0) / Math.max(1, prof.preflopRaises ?? 0);

    const isManiac = raiseRate > 0.42 || allInRate > 0.08;
    const isStation = callRate > 0.48 && raiseRate < 0.35;
    const isSteal = stealRate > 0.35 && raiseRate > 0.25;
    const kind: "steal" | "maniac" | "station" | null = isManiac ? "maniac" : isSteal ? "steal" : isStation ? "station" : null;
    if (!kind) return;

    const now = Date.now();
    tauntCooldownRef.current = tauntCooldownRef.current.filter((t) => now - t < 45_000);
    const lastAt = tauntCooldownRef.current[tauntCooldownRef.current.length - 1] ?? 0;
    if (now - lastAt < 25_000) return;
    if (tauntCooldownRef.current.length >= 1) return;

    // low frequency
    if (Math.random() > 0.18) return;
    tauntCooldownRef.current.push(now);

    const speaker = "幂幂";
    const content = pickTaunt(kind);
    setAutoChatFeed((prev) => [...prev, { id: `taunt_${now}`, speaker, content }]);
    // Speak it as well (still guarded by global TTS cooldown).
    void speak(speaker, null, content);
  }, [isHumanTurn, state.isHandOver, state.players, state.toActIndex, state.humanProfile, pickTaunt, speak, heroName]);

  const lastActionByActor = useMemo(() => {
    const map = new Map<string, string>();
    for (const action of state.actions) {
      if (action.actor === "系统" || map.has(action.actor)) continue;
      const amount = action.amount > 0 ? ` ${action.amount}bb` : "";
      map.set(action.actor, `${action.action.toUpperCase()}${amount}`);
    }
    return map;
  }, [state.actions]);

  const getMobilePlayerSubtext = (p: Player) => {
    if (!p.inHand) return "已弃牌";
    const last = lastActionByActor.get(p.name);
    if (last && last !== "-") return last;
    if (p.currentBet > 0) return `本轮 ${p.currentBet}bb`;
    return "—";
  };

  const getPositionLabel = useCallback((seatIndex: number) => {
    if (seatIndex === state.dealerIndex) return "";
    if (seatIndex === state.sbIndex || seatIndex === state.bbIndex) return "";
    const offset = (seatIndex - state.bbIndex + state.players.length) % state.players.length;
    if (offset === 1) return "枪口";
    if (offset === 2) return "HJ位";
    if (offset === 3) return "CO位";
    return "-";
  }, [state.dealerIndex, state.sbIndex, state.bbIndex, state.players.length]);

  const primarySeatLabel = useCallback(
    (seatIndex: number, p: Player) => {
      if (seatIndex === state.dealerIndex) return "庄位";
      if (seatIndex === state.sbIndex) return "小盲";
      if (seatIndex === state.bbIndex) return "大盲";
      const pos = getPositionLabel(seatIndex);
      if (pos && pos !== "-") return pos;
      return p.name;
    },
    [state.dealerIndex, state.sbIndex, state.bbIndex, getPositionLabel]
  );

  /** 手机椭圆桌：贴近常见国内 App 的叫法 */
  const mobileAliasSeatTitle = useCallback(
    (seatIndex: number, p: Player) => {
      const raw = primarySeatLabel(seatIndex, p);
      if (raw === "CO位") return "关煞";
      if (raw === "HJ位") return "中位";
      return raw;
    },
    [primarySeatLabel]
  );

  const playerStripStatus = (p: Player, seatIndex: number) => {
    if (!p.inHand) return "弃牌";
    if (thinkingActorId === p.id) return "思考";
    if (seatIndex === state.toActIndex && !state.isHandOver) return "待行动";
    return "等待";
  };

  const heroSeatIndex = useMemo(() => state.players.findIndex((p) => p.id === human.id), [state.players, human.id]);
  const heroPositionLabel = useMemo(() => getPositionLabel(heroSeatIndex), [heroSeatIndex, getPositionLabel]);
  const heroNeedsFirstAction =
    state.stage === "preflop" &&
    !state.isHandOver &&
    heroPositionLabel === "枪口" &&
    !state.actedPlayerIds.includes(human.id);

  const heroHint = useMemo(() => {
    if (heroSeatIndex === state.dealerIndex && state.stage === "preflop" && !state.isHandOver) {
      return "你在庄位，翻前最后行动。";
    }
    if (heroPositionLabel === "枪口" && state.stage === "preflop" && !state.isHandOver) {
      return "你在枪口位，翻前第一个行动。";
    }
    return "";
  }, [heroSeatIndex, heroPositionLabel, state.dealerIndex, state.stage, state.isHandOver]);

  const raiseChoices = [
    { key: "min", label: `Min +${raiseDeltaByMode("min")}bb`, value: raiseDeltaByMode("min"), variant: "secondary" as const },
    { key: "2x", label: `2x +${raiseDeltaByMode("2x")}bb`, value: raiseDeltaByMode("2x"), variant: "secondary" as const },
    { key: "3x", label: `3x +${raiseDeltaByMode("3x")}bb`, value: raiseDeltaByMode("3x"), variant: "secondary" as const },
    { key: "allin", label: "All-in", value: raiseDeltaByMode("allin"), variant: "destructive" as const },
  ] as const;


  const syncState = (next: typeof state) => {
    stateRef.current = next;
    setState(next);
  };

  const requestAiAction = async (currentState: typeof state, ai: Player) => {
    const localFallback = aiDecision(currentState, ai);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const resp = await fetch("/api/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: currentState, ai, heroName }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!resp.ok) return localFallback;
      const remote = (await resp.json()) as {
        action?: ActionType;
        amount?: number;
        text?: string;
      };
      return {
        action: remote.action ?? localFallback.action,
        amount: typeof remote.amount === "number" ? remote.amount : localFallback.amount,
        text: remote.text ?? localFallback.text,
      };
    } catch {
      return localFallback;
    }
  };

  const runSingleAiTurn = async (incoming: typeof state) => {
    const actor = incoming.players[incoming.toActIndex];
    if (!actor || actor.isHuman || incoming.isHandOver) return incoming;

    setThinkingActorId(actor.id);
    const decision = await requestAiAction(incoming, actor);
    const acted = applyActionToState(incoming, actor.id, decision.action, decision.amount, decision.text);
    // Trigger TTS in background (do not block turn progression).
    // Prefer server mapping by AI display name; allow explicit override later.
    if (shouldSpeak(actor.name, decision.action, decision.amount, acted.stage, decision.text ?? "")) {
      void speak(actor.name, null, decision.text ?? "");
    }
    // Keep memory lean: do not append per-hand action logs.
    const next = {
      ...acted,
      players: acted.players,
    };

    setThinkingActorId(null);

    return next;
  };

  const getAvatarColor = (name: string) => {
    const palette = ["#c46687", "#788d5d", "#6a9bcc", "#d97757", "#bcd2ca"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  };

  const parseCard = (value: string) => {
    const rawRank = value.slice(0, -1).toUpperCase();
    const suit = value.slice(-1).toLowerCase();
    const rankMap: Record<string, string> = {
      A: "A",
      K: "K",
      Q: "Q",
      J: "J",
      T: "10",
    };
    const rank = rankMap[rawRank] ?? rawRank;
    const suitMap: Record<string, { symbol: string; color: string; label: string }> = {
      s: { symbol: "♠", color: "text-zinc-900", label: "黑桃" },
      h: { symbol: "♥", color: "text-[#c46687]", label: "红桃" },
      d: { symbol: "♦", color: "text-[#c46687]", label: "方块" },
      c: { symbol: "♣", color: "text-zinc-900", label: "梅花" },
    };
    return {
      rank,
      ...(suitMap[suit] ?? { symbol: "?", color: "text-zinc-500", label: "未知" }),
    };
  };

  const getCardImageSrc = (value: string) => {
    const rankRaw = value.slice(0, -1).toUpperCase();
    const suit = value.slice(-1).toLowerCase();

    const rankHexMap: Record<string, string> = {
      A: "1",
      K: "d",
      Q: "c",
      J: "b",
      T: "a",
      "9": "9",
      "8": "8",
      "7": "7",
      "6": "6",
      "5": "5",
      "4": "4",
      "3": "3",
      "2": "2",
    };
    const suitHexMap: Record<string, string> = {
      d: "0",
      c: "1",
      h: "2",
      s: "3",
    };

    const suitHex = suitHexMap[suit];
    const rankHex = rankHexMap[rankRaw];
    if (!suitHex || !rankHex) return null;

    return `/puke/0x${suitHex}${rankHex}.png`;
  };

  const cardView = (value: string, hidden = false, compact = false) => {
    const dim = compact ? "h-11 w-8" : "h-[3.6rem] w-[2.6rem]";
    const imgSizes = compact ? "32px" : "42px";
    const radius = compact ? "rounded" : "rounded-md";

    if (hidden) {
      return (
        <div className={cn(
          `flex ${dim} items-center justify-center ${radius} card-back border`,
          compact ? "border-[#6a9bcc]/20 shadow-sm" : "border-[#6a9bcc]/25 shadow-md"
        )}>
          <div className={cn(
            "rounded-sm border border-[#6a9bcc]/15",
            compact ? "h-5 w-3.5" : "h-7 w-4.5"
          )} />
        </div>
      );
    }

    if (value === "--") {
      return (
        <div className={cn(
          `flex ${dim} items-center justify-center ${radius} border border-dashed`,
          compact ? "border-white/8 bg-white/3" : "border-white/10 bg-white/4"
        )} />
      );
    }

    const card = parseCard(value);
    const cardImageSrc = getCardImageSrc(value);
    return (
      <div className={cn(`relative ${dim} ${radius} overflow-hidden`, compact ? "shadow-sm ring-1 ring-black/5" : "shadow-md ring-1 ring-black/10")} aria-label={`${card.label}${card.rank}`}>
        {cardImageSrc ? (
          <Image src={cardImageSrc} alt={`${card.label}${card.rank}`} fill sizes={imgSizes} className="object-cover" />
        ) : (
          <div className={cn(
            "flex h-full w-full flex-col items-center justify-center bg-white font-bold leading-tight",
            compact ? "text-[10px]" : "text-xs",
            card.color
          )}>
            <div>{card.symbol}</div>
            <div>{card.rank}</div>
          </div>
        )}
      </div>
    );
  };

  const nextStreet = async () => {
    if (isBusted) return;
    if (isResolving) return;
    setIsResolving(true);
    const current = stateRef.current;
    try {
      if (current.isHandOver) {
        await newHand();
        return;
      }
      if (current.players[current.toActIndex]?.isHuman) {
        const hero = current.players[current.toActIndex];
        if (!hero) return;
        const toCall = Math.max(0, current.currentBet - hero.currentBet);
        if (hero.stack <= 0) {
          const forced = applyActionToState(current, hero.id, toCall > 0 ? "call" : "check", 0, "全下自动推进");
          syncState(forced);
          return;
        }
        return;
      }
      const next = await runSingleAiTurn(current);
      syncState(next);
    } finally {
      setIsResolving(false);
    }
  };

  nextStreetRef.current = nextStreet;

  useEffect(() => {
    const latest = state.actions[0];
    if (!latest) return;

    if (latest.actor === "系统") {
      const text = latest.text ?? "";
      // new hand / system messages: light "deal" cue
      const sysKey = `${state.handId}-${text}`;
      if (lastSfxKeyRef.current !== sysKey) {
        lastSfxKeyRef.current = sysKey;
        if (text.includes("局开始")) playSfx("deal");
      }
      const matches = [...text.matchAll(/([^\s，。:+]+)\+(\d+)bb/g)];
      if (matches.length > 0) {
        const winners = matches.map((m) => m[1]);
        const actionKey = `${state.handId}-${text}`;
        if (lastProcessedActionRef.current === actionKey) return;
        lastProcessedActionRef.current = actionKey;
        setWinFx({ text, winners });
        playSfx("win");
        const clearWin = setTimeout(() => setWinFx(null), 2200);
        return () => {
          clearTimeout(clearWin);
        };
      }
      return;
    }
    if (latest.amount <= 0) return;

    const actionKey = `${state.handId}-${latest.actor}-${latest.action}-${latest.amount}-${latest.text ?? ""}`;
    if (lastProcessedActionRef.current === actionKey) return;
    lastProcessedActionRef.current = actionKey;
    // action sfx
    const kind =
      latest.action === "raise" || (latest.action === "call" && latest.amount > 0)
        ? "bet"
        : latest.action === "fold"
          ? "fold"
          : "check";
    playSfx(kind as never);

    return;
  }, [state.actions, state.handId, state.players, playSfx]);

  useEffect(() => {
    const el = recordListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [state.actions]);

  useEffect(() => {
    if (isResolving || state.isHandOver) return;
    if (heroNeedsFirstAction) return;
    if (voiceEnabled && voiceFollowAction && voicePlaying) return;
    const actor = state.players[state.toActIndex];
    if (!actor) return;
    if (actor.isHuman && actor.stack > 0) return;

    const timer = setTimeout(() => {
      void nextStreetRef.current();
    }, 500);
    return () => clearTimeout(timer);
  }, [state.toActIndex, state.isHandOver, isResolving, state.players, heroNeedsFirstAction, voiceEnabled, voiceFollowAction, voicePlaying]);

  const newHand = async () => {
    if (isResolving) return;
    const nextId = handId + 1;
    const current = stateRef.current;
    const nextDealer = (current.dealerIndex + 1) % current.players.length;
    const nextHand = createNewHand(nextId, current.players, nextDealer);
    setHandId(nextId);
    syncState(nextHand);
  };

  const handleHumanAction = async (action: ActionType, raiseBy = 0, text?: string) => {
    if (isResolving) return;
    // Ensure audio is unlocked on mobile within the click gesture.
    void unlockAudio();
    const current = stateRef.current;
    if (current.isHandOver) return;
    const actor = current.players[current.toActIndex];
    if (!actor || !actor.isHuman) return;

    setIsResolving(true);
    try {
      const acted = applyActionToState(current, actor.id, action, raiseBy, text);
      syncState(acted);
    } finally {
      setIsResolving(false);
    }
  };

  const actionDisabled = (!authUserId && !visitorId) || isBusted || state.isHandOver || !isHumanTurn || isResolving;

  const sendLoginLink = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email) {
      setAuthMessage("请输入邮箱");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const sb = supabaseBrowser();
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) {
        setAuthMessage(`发送失败：${error.message}`);
        return;
      }
      setAuthMessage("登录邮件已发送，请去邮箱点击链接完成登录。");
    } catch (e) {
      setAuthMessage(`发送失败：${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    setAuthBusy(true);
    try {
      const sb = supabaseBrowser();
      await sb.auth.signOut();
      setShowAccountPanel(false);
      setAuthMessage("已退出登录");
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col overflow-y-auto bg-[#faf9f6] p-2 pb-36 text-[#1A1A1A] sm:min-h-screen sm:h-auto sm:p-4 sm:pb-4 lg:pb-4 lg:p-5">
      <div className="mb-2 shrink-0 rounded-xl bg-white/70 p-2.5 shadow-sm backdrop-blur-sm sm:mb-3 sm:rounded-xl sm:p-3 lg:p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-[#1A1A1A] lg:text-xl">鱼桌</h1>
            <Badge
              variant="secondary"
              className={cn(
                "w-fit whitespace-nowrap border-0 text-left text-[10px] leading-snug sm:text-xs",
                guestOutOfChips || isBusted ? "bg-[#ebcecf] text-[#c46687]" : "bg-[#f1ede6] text-[#788d5d]"
              )}
            >
              {statusText}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {authUserId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg border-[#e9e5dc] bg-white px-3 text-xs text-[#788d5d] shadow-sm hover:bg-[#faf9f6] hover:text-[#1A1A1A]"
                onClick={() => setShowAccountPanel(true)}
              >
                {displayNickname}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg border-[#e9e5dc] bg-white px-3 text-xs text-[#788d5d] shadow-sm hover:bg-[#faf9f6] hover:text-[#1A1A1A]"
                onClick={() => {
                  setShowLoginPanel(true);
                  setAuthMessage("");
                }}
              >
                登录
              </Button>
            )}
            {!authUserId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-8 rounded-lg border-[#e9e5dc] bg-white px-0 text-[#788d5d] shadow-sm hover:bg-[#faf9f6] hover:text-[#1A1A1A]"
                onClick={() => {
                  setShowLoginPanel(true);
                  setAuthMessage("");
                }}
                aria-label="登录"
              >
                <UserRound className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[1fr_320px] lg:gap-3">
        <div className="flex min-h-0 flex-col gap-2 lg:block lg:space-y-3">
          <Card className="shrink-0 border-0 bg-[#623e25] shadow-none lg:bg-transparent rounded-xl lg:rounded-none">
            <CardContent className="relative flex min-h-0 flex-col p-0 sm:p-2 lg:p-3">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="hidden lg:block">
                  <div className="poker-rail relative mx-auto w-full max-w-[940px] rounded-[24px] p-[7px]">
                    <div className="relative h-[490px] w-full">
                      <div className="absolute inset-0 rounded-[200px] overflow-hidden poker-felt">
                        <div className="poker-felt-inner pointer-events-none absolute inset-0" />
                      </div>
                      {seats.map((p, idx) => {
                        const seatIndex = seatIndexById.get(p.id) ?? -1;
                        const isToAct = seatIndex === state.toActIndex && !state.isHandOver;
                        const isFolded = !p.inHand;
                        const isWinner = winFx?.winners.includes(p.name) ?? false;
                        const posLabel = getPositionLabel(seatIndex);
                        return (
                          <div key={p.id} className={cn("absolute w-46", seatRingClasses[idx % seatRingClasses.length])}>
                            <div className={cn(
                              "relative rounded-xl border p-2 text-xs shadow-lg transition-all duration-300",
                              isToAct ? "seat-active border-[#d97757]/50 bg-white/95" :
                              isWinner ? "seat-winner border-[#d97757]/50 bg-white/95" :
                              isFolded ? "border-[#e4dbcd]/50 bg-white/50 opacity-50" :
                              p.id === "human" ? "border-[#bcd2ca]/50 bg-white/92" :
                              "border-[#e4dbcd]/60 bg-white/90"
                            )}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                                  style={{ background: getAvatarColor(p.name) }}
                                >
                                  {p.name[0]}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="flex items-center gap-1 truncate text-[13px] font-semibold text-[#1A1A1A]">
                                      {p.name}
                                      {p.id === "human" && <span className="rounded bg-[#788d5d] px-1 py-px text-[8px] font-bold leading-none text-white">你</span>}
                                    </span>
                                    <span className={cn("shrink-0 text-xs font-bold tabular-nums", isWinner ? "text-[#d97757]" : "text-[#1A1A1A]")}>
                                      {p.stack}bb
                                    </span>
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-1">
                                    {seatIndex === state.dealerIndex && <span className="rounded bg-[#d97757] px-1 py-px text-[8px] font-bold leading-none text-white">D</span>}
                                    {seatIndex === state.sbIndex && <span className="rounded bg-[#6a9bcc] px-1 py-px text-[8px] font-bold leading-none text-white">SB</span>}
                                    {seatIndex === state.bbIndex && <span className="rounded bg-[#c46687] px-1 py-px text-[8px] font-bold leading-none text-white">BB</span>}
                                    {posLabel && posLabel !== "-" && <span className="text-[9px] text-[#d97757]">{posLabel}</span>}
                                    {p.currentBet > 0 && <span className="ml-auto text-[10px] font-medium text-[#d97757]">{lastActionByActor.get(p.name) ?? ""} {p.currentBet}bb</span>}
                                    {isFolded && <span className="text-[9px] text-[#e4dbcd]">FOLD</span>}
                                    {isToAct && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#d97757] animate-pulse" />}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-1.5 flex gap-1.5">
                                {p.id === "human" ? (
                                  <>{cardView(humanCards[0])}{cardView(humanCards[1])}</>
                                ) : revealAllHoleCards ? (
                                  <>{cardView(state.holeCards[p.id]?.[0] ?? "--")}{cardView(state.holeCards[p.id]?.[1] ?? "--")}</>
                                ) : p.inHand ? (
                                  <>{cardView("As", true)}{cardView("Ks", true)}</>
                                ) : null}
                              </div>
                              {thinkingActorId === p.id && !state.isHandOver && (
                                <div className="pointer-events-none absolute -bottom-3 right-2 flex items-center gap-1 rounded-full bg-[#1A1A1A] px-2.5 py-1 text-[10px] text-white shadow-lg">
                                  <Loader2 className="h-3 w-3 animate-spin" />思考中
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2 ">
                          <Coins className="h-4 w-4 text-[#d97757]" aria-hidden />
                          <span className="text-sm font-bold tracking-wide text-[#1A1A1A]">
                            底池 <span className="tabular-nums text-[#d97757] mt-1">{state.pot}</span> bb
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {(state.board.length ? state.board : ["--", "--", "--", "--", "--"]).map((c, i) => (
                            <div key={`${c}-${i}`}>{cardView(c)}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative mx-auto flex w-full items-center justify-center lg:hidden">
                  <div className="relative h-[min(56dvh,33rem)] w-[min(92vw,26rem)]">
                  <div
                    className="absolute inset-0 rounded-[50%]"
                    style={{ background: "linear-gradient(160deg, #623e25, #4a2e1a 40%, #3a2016)" }}
                    aria-hidden
                  />
                  <div
                    className="absolute inset-[2.5%] rounded-[50%] poker-felt poker-felt-inner"
                    aria-hidden
                  />
                  <div className="pointer-events-none absolute left-1/2 top-[45%] z-20 w-[58%] max-w-56 -translate-x-1/2 -translate-y-1/2 px-2 py-1.5 text-center">
                    <div className="mb-1.5 flex items-center justify-center gap-1.5 rounded-full">
                      <Coins className="h-3 w-3 text-[#d97757]" aria-hidden />
                      <span className="text-[11px] font-bold text-[#1A1A1A]">
                        底池 <span className="tabular-nums text-[#d97757] mt-1">{state.pot}</span> bb
                      </span>
                    </div>
                    <div className="flex justify-center gap-0.5">
                      {(state.board.length ? state.board : ["--", "--", "--", "--", "--"]).map((c, i) => (
                        <div key={`${c}-${i}`}>{cardView(c, false, true)}</div>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const ovalSlots = [
                      "top-[5%] left-1/2 -translate-x-1/2",
                      "top-[19%] right-[3%]",
                      "bottom-[35%] right-[3%]",
                      "bottom-[8%] left-1/2 -translate-x-1/2",
                      "bottom-[35%] left-[3%]",
                      "top-[19%] left-[3%]",
                    ];
                    return seats.map((p, idx) => {
                      const seatIndex = seatIndexById.get(p.id) ?? -1;
                      const isToAct = seatIndex === state.toActIndex && !state.isHandOver;
                      const isFolded = !p.inHand;
                      const seatTitle = mobileAliasSeatTitle(seatIndex, p);
                      const isWinner = winFx?.winners.includes(p.name) ?? false;
                      return (
                        <div
                          key={p.id}
                          className={cn("absolute z-10 w-[4.6rem]", ovalSlots[idx])}
                        >
                          <div className={cn(
                            "relative overflow-visible rounded-lg border text-[9px] leading-tight shadow-md transition-all",
                            isToAct ? "seat-active border-[#d97757]/50 bg-white/92" :
                            isWinner ? "seat-winner border-[#d97757]/50 bg-white/92" :
                            isFolded ? "border-[#e4dbcd]/40 bg-white/40 opacity-55" :
                            p.id === "human" ? "border-[#bcd2ca]/40 bg-white/88" :
                            "border-[#e4dbcd]/50 bg-white/85"
                          )}>
                            <div className="px-1 pt-1 pb-0.5">
                              {p.id === "human" ? (
                                <div className="mb-0.5 flex justify-center gap-0.5">
                                  {cardView(humanCards[0], false, true)}
                                  {cardView(humanCards[1], false, true)}
                                </div>
                              ) : p.inHand ? (
                                <div className="mb-0.5 flex justify-center gap-0.5">
                                  {revealAllHoleCards ? (
                                    <>{cardView(state.holeCards[p.id]?.[0] ?? "--", false, true)}{cardView(state.holeCards[p.id]?.[1] ?? "--", false, true)}</>
                                  ) : (
                                    <>{cardView("As", true, true)}{cardView("Ks", true, true)}</>
                                  )}
                                </div>
                              ) : null}
                              <div className="flex items-center justify-center gap-0.5">
                                <div
                                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
                                  style={{ background: getAvatarColor(p.name) }}
                                >{p.name[0]}</div>
                                <span className="truncate text-[9px] font-semibold text-[#1A1A1A]">{seatTitle}</span>
                                {isToAct && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d97757]" />}
                              </div>
                            </div>
                            <div className={cn(
                              "rounded-b-lg py-0.5 text-center text-[10px] font-bold leading-none tabular-nums",
                              isWinner ? "text-[#d97757]" : "text-[#788d5d]"
                            )}>
                              {isFolded ? <span className="text-[#e4dbcd]">FOLD</span> : `${p.stack}bb`}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  {(() => {
                    const chipSlots = [
                      "top-[24%] left-1/2 -translate-x-1/2",
                      "top-[30%] right-[24%]",
                      "bottom-[40%] right-[24%]",
                      "bottom-[26%] left-1/2 -translate-x-1/2",
                      "bottom-[40%] left-[24%]",
                      "top-[30%] left-[24%]",
                    ];
                    return seats.map((p, idx) => {
                      const seatIndex = seatIndexById.get(p.id) ?? -1;
                      void seatIndex;
                      const bet = Math.max(0, Math.floor(p.currentBet));
                      if (!p.inHand || bet <= 0) return null;
                      return (
                        <div
                          key={`chip-${p.id}`}
                          className={cn("pointer-events-none absolute z-10", chipSlots[idx])}
                        >
                          <div className="flex items-center gap-1 px-0.5 py-0.5 text-[10px] font-semibold tabular-nums text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">
                            <span className="relative h-4 w-4">
                              <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-[#d97757] shadow-[0_2px_10px_rgba(0,0,0,0.35)] ring-1 ring-black/25" />
                              <span className="absolute left-1.5 top-1.5 h-1 w-1 rounded-full bg-white/55" />
                            </span>
                            <span>{bet}</span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  </div>
                </div>

                <div className="relative mt-3 hidden grid-cols-3 gap-2 md:grid">
                  <Button
                    size="sm"
                    className="rounded-lg border-0 bg-[#c46687] text-sm font-bold text-white shadow-md hover:opacity-90 disabled:opacity-40"
                    onClick={() => handleHumanAction("fold", 0, "弃牌")}
                    disabled={actionDisabled}
                  >
                    弃牌
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-lg border-0 bg-[#788d5d] text-sm font-bold text-white shadow-md hover:opacity-90 disabled:opacity-40"
                    onClick={() => handleHumanAction(humanToCall > 0 ? "call" : "check", 0, humanToCall > 0 ? "跟注" : "过牌")}
                    disabled={actionDisabled}
                  >
                    {humanToCall > 0 ? `跟注 ${humanToCall}bb` : "过牌"}
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-lg border-0 bg-[#d97757] text-sm font-bold text-white shadow-md hover:opacity-90 disabled:opacity-40"
                    onClick={() => setShowRaiseOptions((s) => !s)}
                    disabled={actionDisabled || !canHumanRaise}
                  >
                    {state.raiseCountThisRound >= 3 ? "加注封顶" : canHumanRaise ? `加注 ${selectedRaiseDelta}bb` : "加注"}
                  </Button>
                  {showRaiseOptions && isHumanTurn && !isResolving && canHumanRaise && (
                    <div className="absolute bottom-full right-0 z-30 mb-2 w-48 rounded-xl border border-[#e9e5dc] bg-white p-1.5 shadow-xl">
                      {raiseChoices.map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => {
                            setRaiseMode(opt.key);
                            setShowRaiseOptions(false);
                            void handleHumanAction("raise", opt.value, opt.key === "allin" ? "全下" : `加注 ${opt.key}`);
                          }}
                          className={cn(
                            "mb-1 w-full rounded-lg px-3 py-2 text-left text-xs font-bold last:mb-0 transition-colors",
                            raiseMode === opt.key ? "bg-[#d97757] text-white" :
                            opt.variant === "destructive" ? "bg-[#c46687] text-white hover:opacity-90" :
                            "bg-[#faf9f6] text-[#1A1A1A] hover:bg-[#f1ede6]"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {heroHint && <div className="mt-1.5 text-center text-[11px] text-[#d97757]">{heroHint}</div>}
                <div className="mt-2 hidden md:flex">
                  <Button
                    className="w-full rounded-lg border-[#e9e5dc] bg-white text-sm text-[#788d5d] shadow-sm hover:bg-[#faf9f6] disabled:opacity-40"
                    variant="outline"
                    onClick={() => void newHand()}
                    disabled={isResolving}
                  >
                    <RefreshCcw className="mr-1.5 h-4 w-4" />
                    新一局
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="h-[18dvh] min-h-[130px] overflow-hidden rounded-xl border border-[#e9e5dc] bg-white md:hidden">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-[#e9e5dc] px-3 py-1.5">
                <span className="text-[11px] font-semibold text-[#1A1A1A]">群聊</span>
                <span className="text-[10px] text-[#e4dbcd]">{[...groupChatFeed, ...autoChatFeed].length}条</span>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-scroll overscroll-contain px-2 py-1.5 pb-2 [touch-action:pan-y]"
                ref={recordListRef}
              >
                {[...groupChatFeed, ...autoChatFeed].length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-[#e4dbcd]">暂无消息</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {[...groupChatFeed, ...autoChatFeed].slice(-30).map((msg) => (
                      <div key={msg.id} className="flex items-start gap-1.5">
                        <div
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                          style={{ background: getAvatarColor(msg.speaker) }}
                        >{msg.speaker[0]}</div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] font-semibold text-[#d97757]">{msg.speaker}</span>
                          <p className="text-[11px] leading-snug text-[#1A1A1A]">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col space-y-2 lg:space-y-3">
          <Card id="game-log" className="hidden md:flex md:flex-1 md:flex-col border border-[#e9e5dc] bg-white shadow-sm">
            <CardContent className="flex flex-1 flex-col px-2 pb-3 pt-0 sm:px-2 sm:py-1">
              <div className="hidden md:flex md:flex-1 md:flex-col">
                <div className="flex-1 min-h-0">
                  <AiRecordChat
                    gameContext={recordChatContext}
                    groupName="鱼桌"
                    memberCount={state.players.length}
                    externalMessages={[...groupChatFeed, ...autoChatFeed].slice(-80)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="fixed bottom-0 left-1/2 z-40 w-[96%] -translate-x-1/2 pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="rounded-2xl border border-[#e9e5dc] bg-white/95 p-2 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl">
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              className={cn(
                "min-w-0 rounded-xl px-2 py-2.5 text-[12px] font-bold shadow-sm transition active:scale-[0.97]",
                actionDisabled
                  ? "bg-[#f1ede6] text-[#e4dbcd]"
                  : "bg-[#1A1A1A] text-white"
              )}
              disabled={actionDisabled}
              onClick={() => void handleHumanAction("fold", 0, "弃牌")}
            >
              弃牌
            </button>
            <button
              type="button"
              className={cn(
                "min-w-0 rounded-xl px-2 py-2.5 text-[12px] font-bold shadow-sm transition active:scale-[0.97]",
                actionDisabled
                  ? "bg-[#f1ede6] text-[#e4dbcd]"
                  : "bg-[#788d5d] text-white"
              )}
              disabled={actionDisabled}
              onClick={() =>
                void handleHumanAction(humanToCall > 0 ? "call" : "check", 0, humanToCall > 0 ? "跟注" : "过牌")
              }
            >
              {humanToCall > 0 ? `跟注 ${humanToCall}bb` : "过牌"}
            </button>
            <button
              type="button"
              className={cn(
                "min-w-0 rounded-xl px-2 py-2.5 text-[12px] font-bold shadow-sm transition active:scale-[0.97]",
                actionDisabled || !canHumanRaise
                  ? "bg-[#f1ede6] text-[#e4dbcd]"
                  : "bg-[#d97757] text-white"
              )}
              disabled={actionDisabled || !canHumanRaise}
              onClick={() => setShowRaiseOptions((s) => !s)}
            >
              {state.raiseCountThisRound >= 3 ? "加注封顶" : `加注 ${selectedRaiseDelta}bb`}
            </button>
          </div>
          <button
            type="button"
            className={cn(
              "mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-semibold transition active:scale-[0.98]",
              isResolving ? "bg-[#f1ede6] text-[#e4dbcd]" : "bg-[#faf9f6] text-[#788d5d] hover:bg-[#f1ede6]"
            )}
            disabled={isResolving}
            onClick={() => void newHand()}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            新一局
          </button>
        </div>
      </div>
      {showRaiseOptions && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setShowRaiseOptions(false)}
          aria-hidden="true"
        />
      )}
      {showRaiseOptions && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-1/2 z-50 w-[96%] max-w-[380px] -translate-x-1/2 rounded-2xl border border-[#e9e5dc] bg-white/95 p-2 shadow-xl backdrop-blur-xl md:hidden">
          {raiseChoices.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setRaiseMode(opt.key);
                setShowRaiseOptions(false);
                void handleHumanAction("raise", opt.value, opt.key === "allin" ? "全下" : `加注 ${opt.key}`);
              }}
              className={cn(
                "mb-1 w-full rounded-xl px-3 py-2.5 text-left text-[12px] font-bold last:mb-0 transition-colors",
                raiseMode === opt.key ? "bg-[#d97757] text-white" :
                opt.variant === "destructive" ? "bg-[#c46687] text-white" :
                "bg-[#faf9f6] text-[#1A1A1A] hover:bg-[#f1ede6]"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {showLoginPanel && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#e9e5dc] bg-white p-4 shadow-xl">
            <div className="mb-2 text-sm font-semibold text-[#1A1A1A]">登录</div>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="输入邮箱"
              className="h-10 w-full rounded-lg border border-[#e9e5dc] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/25"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-[#e9e5dc] bg-white text-xs"
                onClick={() => setShowLoginPanel(false)}
              >
                继续访客
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-[#e9e5dc] bg-white text-xs"
                onClick={() => setShowLoginPanel(false)}
              >
                关闭
              </Button>
              <Button type="button" size="sm" className="text-xs" onClick={() => void sendLoginLink()} disabled={authBusy}>
                {authBusy ? "发送中..." : "发送登录邮件"}
              </Button>
            </div>
            {authMessage ? <div className="mt-2 text-xs text-[#d97757]">{authMessage}</div> : null}
          </div>
        </div>
      )}
      {showAccountPanel && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-[#e9e5dc] bg-white p-4 shadow-xl">
            <div className="mb-1 text-sm font-semibold text-[#1A1A1A]">{displayNickname}</div>
            <div className="mb-3 text-xs text-[#788d5d]">账号设置</div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-[#e9e5dc] bg-white text-xs"
                onClick={() => setShowAccountPanel(false)}
              >
                关闭
              </Button>
              <Button type="button" size="sm" className="text-xs" onClick={() => void logout()} disabled={authBusy}>
                {authBusy ? "处理中..." : "退出登录"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

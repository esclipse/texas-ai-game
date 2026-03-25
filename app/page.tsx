"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, Loader2, MessageCircleHeart, RefreshCcw, Send, Settings } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyActionToState,
  aiDecision,
  createDefaultPlayers,
  createNewHand,
  type ActionType,
  type Player,
} from "@/lib/game";
import { appendAiMemory, loadAiMemories } from "@/lib/ai-memory";
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
  const [initialHand] = useState(() => createNewHand(1, createDefaultPlayers()));
  const [handId, setHandId] = useState(1);
  const [state, setState] = useState(initialHand);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [visitorBalance, setVisitorBalance] = useState<number | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [raiseMode, setRaiseMode] = useState<"min" | "2x" | "3x" | "allin">("min");
  const [showRaiseOptions, setShowRaiseOptions] = useState(false);
  const [pcTableTheme, setPcTableTheme] = useState<"classic" | "neon" | "forest" | "amethyst" | "midnight">(
    "classic",
  );
  const [winFx, setWinFx] = useState<{ text: string; winners: string[] } | null>(null);
  const [thinkingActorId, setThinkingActorId] = useState<string | null>(null);
  const [autoChatFeed, setAutoChatFeed] = useState<Array<{ id: string; speaker: string; content: string }>>([]);
  const lastAutoTriggerRef = useRef("");
  const autoCooldownRef = useRef<number[]>([]);
  const stateRef = useRef(state);
  const lastSyncedBalanceRef = useRef<number | null>(null);
  const balanceSyncTimerRef = useRef<number | null>(null);
  const nextStreetRef = useRef<() => Promise<void>>(async () => {});
  const lastProcessedActionRef = useRef("");
  const recordListRef = useRef<HTMLDivElement | null>(null);

  // Visitor id + initial chip balance (Supabase backed)
  useEffect(() => {
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
        setVisitorBalance(data.chipBalance);
        window.localStorage.setItem("ai-game:visitorId", data.visitorId);
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
    const players = createDefaultPlayers().map((p) => (p.id === "human" ? { ...p, stack: visitorBalance } : p));
    const next = createNewHand(1, players);
    lastSyncedBalanceRef.current = visitorBalance;
    syncState(next);
    setHandId(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitorBalance]);

  // Debounced chip balance sync to Supabase (server-side).
  useEffect(() => {
    if (!visitorId) return;
    const humanNow = state.players.find((p) => p.id === "human");
    if (!humanNow) return;
    const bal = Math.max(0, Math.floor(humanNow.stack));
    if (lastSyncedBalanceRef.current === bal) return;

    if (balanceSyncTimerRef.current) window.clearTimeout(balanceSyncTimerRef.current);
    balanceSyncTimerRef.current = window.setTimeout(() => {
      void fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, chipBalance: bal }),
      }).finally(() => {
        lastSyncedBalanceRef.current = bal;
      });
    }, 900);

    return () => {
      if (balanceSyncTimerRef.current) window.clearTimeout(balanceSyncTimerRef.current);
    };
  }, [state.players, visitorId]);

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
  const seatRingClasses = [
    "left-1/2 top-3 -translate-x-1/2",
    "right-6 top-20",
    "right-6 bottom-20",
    "left-1/2 bottom-3 -translate-x-1/2",
    "left-6 bottom-20",
    "left-6 top-20",
  ];

  const statusText = useMemo(() => {
    if (isBusted) return "积分耗尽，无法继续。";
    if (human.stack <= 0 && !state.isHandOver) return "你已全下，等待摊牌结算。";
    const turn = state.isHandOver ? "本局结束" : `行动: ${toActPlayer?.name ?? "-"}`;
    return `第 ${state.handId} 局 · ${state.stage.toUpperCase()} · 底池 ${state.pot}bb · ${turn}`;
  }, [isBusted, human.stack, state.handId, state.pot, state.stage, state.isHandOver, toActPlayer?.name]);

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
    // Trigger one extra AI reply after a new table speech (a.text) appears.
    const last = groupChatFeed[groupChatFeed.length - 1];
    if (!last) return;

    const triggerKey = last.id;
    if (lastAutoTriggerRef.current === triggerKey) return;

    // Cooldown / rate-limit: at most 2 auto replies per 20s, and at least 6s apart.
    const now = Date.now();
    autoCooldownRef.current = autoCooldownRef.current.filter((t) => now - t < 20_000);
    const lastAt = autoCooldownRef.current[autoCooldownRef.current.length - 1] ?? 0;
    if (now - lastAt < 6_000) return;
    if (autoCooldownRef.current.length >= 2) return;

    // Probability gate: not every line needs a follow-up.
    if (Math.random() > 0.35) {
      lastAutoTriggerRef.current = triggerKey;
      return;
    }

    lastAutoTriggerRef.current = triggerKey;
    autoCooldownRef.current.push(now);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const prompt = `刚才群里【${last.speaker}】说：“${last.content}”。请让另一位AI接一句（可@别人），保持自然，不要连续刷屏。`;

    void fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: `u_${now}`,
            role: "user",
            parts: [{ type: "text", text: prompt }],
          },
        ],
        gameContext: recordChatContext,
      }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? extractUiSseText(r) : ""))
      .then((text) => {
        if (!text) return;
        const { speaker, content } = parseGroupSpeaker(text);
        setAutoChatFeed((prev) => [
          ...prev,
          { id: `auto_${now}`, speaker, content: content || text },
        ]);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupChatFeed.length, recordChatContext]);

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

  const pcTableThemeStyles = {
    classic: {
      // 经典桌布：默认不带“绿感”的底色
      tableOverlayClass: "lg:border-zinc-500/15 lg:bg-zinc-900/15",
      tableBaseClass: "bg-linear-to-b from-zinc-900/70 via-zinc-900/35 to-zinc-950/20",
      potBorderClass: "border-cyan-300/15",
      potCoinsClass: "text-cyan-200",
      potTextClass: "text-cyan-200",
    },
    neon: {
      // 霓虹蓝：偏科技感（少量紫粉点缀）
      tableOverlayClass: "lg:border-cyan-300/15 lg:bg-cyan-900/10",
      tableBaseClass: "bg-linear-to-b from-cyan-900/55 via-slate-900/25 to-zinc-950/20",
      potBorderClass: "border-cyan-300/20",
      potCoinsClass: "text-cyan-200",
      potTextClass: "text-cyan-200",
    },
    forest: {
      // 森林绿：给喜欢绿色桌布的人选项
      tableOverlayClass: "lg:border-emerald-300/15 lg:bg-emerald-900/10",
      tableBaseClass: "bg-linear-to-b from-emerald-900/45 via-teal-900/25 to-zinc-950/20",
      potBorderClass: "border-emerald-300/20",
      potCoinsClass: "text-emerald-200",
      potTextClass: "text-emerald-200",
    },
    amethyst: {
      // 紫晶：偏紫色桌布
      tableOverlayClass: "lg:border-fuchsia-300/20 lg:bg-fuchsia-900/15",
      tableBaseClass: "bg-linear-to-b from-fuchsia-900/45 via-violet-900/25 to-zinc-950/20",
      potBorderClass: "border-fuchsia-300/20",
      potCoinsClass: "text-fuchsia-200",
      potTextClass: "text-fuchsia-200",
    },
    midnight: {
      // 午夜：偏深蓝/黑
      tableOverlayClass: "lg:border-indigo-300/15 lg:bg-indigo-950/10",
      tableBaseClass: "bg-linear-to-b from-indigo-950/55 via-slate-950/25 to-zinc-950/20",
      potBorderClass: "border-indigo-300/20",
      potCoinsClass: "text-indigo-200",
      potTextClass: "text-indigo-200",
    },
  } as const;

  const syncState = (next: typeof state) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    const ids = state.players.filter((p) => !p.isHuman).map((p) => p.id);
    void loadAiMemories(ids).then((map) => {
      const next = {
        ...stateRef.current,
        players: stateRef.current.players.map((p) =>
          p.isHuman ? p : { ...p, memory: map[p.id] ?? p.memory }
        ),
      };
      syncState(next);
    });
    // initial hydration only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestAiAction = async (currentState: typeof state, ai: Player) => {
    const localFallback = aiDecision(currentState, ai);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const resp = await fetch("/api/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: currentState, ai }),
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
    const memoryLine = `${acted.stage} ${actor.name} ${decision.action}${decision.amount > 0 ? ` ${decision.amount}bb` : ""} ${decision.text ?? ""}`.trim();
    let persisted: string[] = [];
    try {
      persisted = await appendAiMemory(actor.id, memoryLine);
    } catch {
      persisted = [];
    }
    const next = {
      ...acted,
      players: acted.players.map((p) =>
        p.id === actor.id ? { ...p, memory: persisted.length ? persisted : [`${acted.stage} 读到对手节奏，选择 ${decision.action}`, ...p.memory].slice(0, 20) } : p
      ),
    };
    setThinkingActorId(null);
    return next;
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
      h: { symbol: "♥", color: "text-red-600", label: "红桃" },
      d: { symbol: "♦", color: "text-red-600", label: "方块" },
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
    const dim = compact ? "h-11 w-8" : "h-14 w-10";
    const imgSizes = compact ? "32px" : "40px";
    if (hidden) {
      return (
        <div
          className={cn(
            `flex ${dim} items-center justify-center rounded text-zinc-300`,
            compact ? "border border-zinc-600/70 bg-zinc-800/90 text-[10px]" : "bg-zinc-900 text-sm"
          )}
        >
          <span>{compact ? "—" : "🂠"}</span>
        </div>
      );
    }
    if (value === "--") {
      return (
        <div
          className={cn(
            `flex ${dim} items-center justify-center rounded ${compact ? "text-[10px]" : "text-xs"}`,
            compact
              ? "border border-zinc-600/60 bg-zinc-800/90 text-zinc-600"
              : "bg-white/90 text-zinc-400"
          )}
        >
          {compact ? "—" : "--"}
        </div>
      );
    }

    const card = parseCard(value);
    const cardImageSrc = getCardImageSrc(value);
    return (
      <div
        className={`relative ${dim}`}
        aria-label={`${card.label}${card.rank}`}
      >
        {cardImageSrc ? (
          <>
            <Image src={cardImageSrc} alt={`${card.label}${card.rank}`} fill sizes={imgSizes} className="object-cover" />
          </>
        ) : (
          <div className={`flex h-full flex-col items-center justify-center text-[10px] font-semibold leading-tight ${card.color}`}>
            <div>{card.label}</div>
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
      const matches = [...text.matchAll(/([^\s，。:+]+)\+(\d+)bb/g)];
      if (matches.length > 0) {
        const winners = matches.map((m) => m[1]);
        const actionKey = `${state.handId}-${text}`;
        if (lastProcessedActionRef.current === actionKey) return;
        lastProcessedActionRef.current = actionKey;
        setWinFx({ text, winners });
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

    return;
  }, [state.actions, state.handId, state.players]);

  useEffect(() => {
    const el = recordListRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }, [state.actions]);

  useEffect(() => {
    if (isResolving || state.isHandOver) return;
    if (heroNeedsFirstAction) return;
    const actor = state.players[state.toActIndex];
    if (!actor) return;
    if (actor.isHuman && actor.stack > 0) return;

    const timer = setTimeout(() => {
      void nextStreetRef.current();
    }, 500);
    return () => clearTimeout(timer);
  }, [state.toActIndex, state.isHandOver, isResolving, state.players, heroNeedsFirstAction]);

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

  const actionDisabled = isBusted || state.isHandOver || !isHumanTurn || isResolving;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl bg-[#04070b] p-2 pb-[calc(11.5rem+env(safe-area-inset-bottom))] text-zinc-100 sm:bg-zinc-50 sm:p-5 sm:pb-5 sm:text-zinc-900 lg:pb-5 lg:p-5">
      <div className="mb-2 space-y-1.5 rounded-xl border border-zinc-700/70 bg-zinc-950/65 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.32)] backdrop-blur sm:mb-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-400 sm:text-zinc-500 lg:hidden">娱乐桌 · 1/2bb · 6人</p>
            <h1 className="text-base font-bold tracking-tight text-zinc-100 sm:text-lg sm:text-zinc-900 lg:text-xl">鱼桌</h1>
            <p className="hidden text-xs text-zinc-500 lg:block">六人桌</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-zinc-400 lg:hidden"
              aria-label="设置（占位）"
              disabled
            >
              <Settings className="h-4 w-4" />
            </Button>
            <div className="hidden items-center gap-2 lg:flex">
              <select
                className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/35"
                value={pcTableTheme}
                onChange={(e) => setPcTableTheme(e.target.value as "classic" | "neon" | "forest" | "amethyst" | "midnight")}
                aria-label="主题桌布"
              >
                <option value="classic">经典</option>
                <option value="neon">霓虹蓝</option>
                <option value="forest">森林绿</option>
                <option value="amethyst">紫晶</option>
                <option value="midnight">午夜</option>
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1 border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 hover:bg-zinc-800 sm:border-zinc-300 sm:bg-white sm:text-zinc-900 sm:hover:bg-zinc-100 sm:px-3 sm:text-sm"
              onClick={() => {
                const subject = encodeURIComponent("鱼桌 - 用户反馈");
                window.location.href = `mailto:regretn@163.com?subject=${subject}`;
              }}
            >
              <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              联系
            </Button>
          </div>
        </div>
        <Badge
          variant={isBusted ? "outline" : "secondary"}
          className="w-fit max-w-full whitespace-normal border-cyan-400/35 bg-cyan-950/55 text-left text-[10px] leading-snug text-cyan-100 sm:border-zinc-200 sm:bg-zinc-100 sm:text-zinc-800 sm:text-xs"
        >
          {statusText}
        </Badge>
        <div className="flex gap-1 overflow-x-auto pb-0.5 pl-0.5 [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
          {state.players.map((p, seatIndex) => {
            const isToAct = seatIndex === state.toActIndex && !state.isHandOver;
            return (
              <div
                key={p.id}
                className={cn(
                  "flex min-w-[4.9rem] shrink-0 flex-col rounded-md px-1.5 py-1.5",
                  isToAct
                    ? "border-cyan-300/45 bg-cyan-950/65"
                    : "bg-zinc-900/70"
                )}
              >
                <span className="text-[9px] leading-tight text-zinc-300">{mobileAliasSeatTitle(seatIndex, p)}</span>
                <span className="text-[10px] font-medium text-zinc-100">{playerStripStatus(p, seatIndex)}</span>
                <span className="tabular-nums text-[11px] font-semibold text-cyan-200">{p.stack}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[1fr_320px] lg:gap-3">
        <div className="space-y-2 lg:space-y-3">
          <Card className="border-0 bg-zinc-950/65 text-white shadow-none sm:border sm:border-zinc-800/60 sm:shadow-sm lg:bg-zinc-950/55">
            <CardHeader className="hidden p-4 lg:block">
              <CardTitle className="text-base text-zinc-100">牌桌</CardTitle>
              <CardDescription className="text-zinc-500">德州牌局</CardDescription>
            </CardHeader>
            <CardContent className="relative p-2 pt-0 sm:p-4 sm:pt-0 lg:p-6 lg:pt-0">
              <div
                className={cn(
                  "rounded-xl border border-zinc-800/70 bg-zinc-900/35 p-1.5 sm:rounded-2xl sm:p-3",
                  pcTableThemeStyles[pcTableTheme].tableOverlayClass
                )}
              >
                <div className="hidden lg:block">
                  <div
                    className={cn(
                      "relative mx-auto h-[470px] w-full max-w-[900px] rounded-[220px]",
                      pcTableThemeStyles[pcTableTheme].tableBaseClass,
                    )}
                  >
                    {seats.map((p, idx) => (
                      <div key={p.id} className={`absolute w-52 ${seatRingClasses[idx % seatRingClasses.length]}`}>
                        {(() => {
                          const seatIndex = seatIndexById.get(p.id) ?? -1;
                          const isToAct = seatIndex === state.toActIndex && !state.isHandOver;
                          const isFolded = !p.inHand;
                          return (
                        <div
                          className={`relative box-border rounded-md border p-2 text-xs ${
                            isToAct
                              ? "border-cyan-300/45 bg-cyan-950/80"
                              : isFolded
                                ? "border-transparent bg-cyan-950/35 opacity-70"
                                : "border-transparent bg-cyan-950/50"
                          }`}
                          style={
                            winFx?.winners.includes(p.name)
                              ? {
                                  boxShadow:
                                    "0 0 0 2px rgba(250,204,21,0.65), 0 0 18px rgba(250,204,21,0.45)",
                                }
                              : undefined
                          }
                        >
                          <div className="mb-1 flex items-center justify-between">
                            <span className="flex items-center gap-1 font-medium">
                              {p.name}
                              {seatIndex === state.dealerIndex ? <Badge className="bg-amber-500 text-[10px] text-black">庄</Badge> : null}
                              {seatIndex === state.sbIndex ? <Badge className="bg-sky-200 text-[10px] text-sky-900">小盲</Badge> : null}
                              {seatIndex === state.bbIndex ? <Badge className="bg-violet-200 text-[10px] text-violet-900">大盲</Badge> : null}
                              {getPositionLabel(seatIndex) ? (
                                <Badge className="bg-cyan-200 text-[10px] text-cyan-900">{getPositionLabel(seatIndex)}</Badge>
                              ) : null}
                              {isToAct ? (
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]"
                                    aria-label="active-turn"
                                  />
                                  {!p.isHuman ? <Loader2 className="h-3 w-3 animate-spin text-sky-300" /> : null}
                                </span>
                              ) : null}
                              {isFolded ? <Badge className="bg-zinc-200 text-[10px] text-zinc-800">弃牌</Badge> : null}
                            </span>
                            <span
                              className={`font-semibold tabular-nums ${
                                winFx?.winners.includes(p.name) ? "text-red-300" : ""
                              }`}
                            >
                              {p.stack}bb
                            </span>
                          </div>
                          <div className="mb-1 flex items-center justify-between text-[11px] text-cyan-100/90">
                            <span
                              className={`font-medium ${
                                p.currentBet > 0
                                  ? p.currentBet === state.currentBet
                                    ? "text-amber-200"
                                    : "text-sky-300/80"
                                  : ""
                              }`}
                            >
                              本轮下注 {p.currentBet}bb
                            </span>
                            <span className="rounded bg-black/25 px-1 py-0.5 text-[10px] text-cyan-50">
                              {lastActionByActor.get(p.name) ?? "-"}
                            </span>
                          </div>
                          {p.id === "human" ? (
                            <div className="flex gap-1.5">
                              {cardView(humanCards[0])}
                              {cardView(humanCards[1])}
                            </div>
                          ) : revealAllHoleCards ? (
                            <div className="flex gap-1.5">
                              {cardView(state.holeCards[p.id]?.[0] ?? "--")}
                              {cardView(state.holeCards[p.id]?.[1] ?? "--")}
                            </div>
                          ) : null}
                          {thinkingActorId === p.id && !state.isHandOver ? (
                            <div className="pointer-events-none absolute -bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white shadow-md">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              思考中
                            </div>
                          ) : null}
                        </div>
                          );
                        })()}
                      </div>
                    ))}

                    <div
                      className={cn(
                        "absolute left-1/2 top-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border bg-zinc-950/55 p-4 backdrop-blur",
                        pcTableThemeStyles[pcTableTheme].potBorderClass
                      )}
                    >
                      <div className="mb-2 flex items-center justify-center gap-1.5 text-center text-sm text-white">
                        <Coins className={cn("h-4 w-4", pcTableThemeStyles[pcTableTheme].potCoinsClass)} aria-hidden />
                        <span>
                          底池{" "}
                          <span className={cn("tabular-nums", pcTableThemeStyles[pcTableTheme].potTextClass)}>{state.pot}</span>bb
                        </span>
                      </div>
                      <div className="flex justify-center gap-1.5">
                        {(state.board.length ? state.board : ["--", "--", "--", "--", "--"]).map((c, i) => (
                          <div key={`${c}-${i}`}>{cardView(c)}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative mx-auto mb-2 h-[min(66vh,27rem)] w-full max-w-[20rem] lg:hidden">
                  <div
                    className="absolute inset-[2%] rounded-[50%] border border-fuchsia-300/20 bg-linear-to-b from-teal-900/95 via-cyan-900/80 to-zinc-950 shadow-[inset_0_0_50px_rgba(0,0,0,0.34)]"
                    aria-hidden
                  />
                  <div className="pointer-events-none absolute left-1/2 top-1/2 z-5 w-[64%] max-w-48 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-fuchsia-300/20 bg-zinc-950/55 px-2.5 py-2 text-center backdrop-blur-xl shadow-[0_12px_44px_rgba(0,0,0,0.38)]">
                    <div className="mb-1 flex items-center justify-center gap-1 text-[11px] text-white">
                      <Coins className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden />
                      <span>
                        底池 <span className="tabular-nums font-semibold text-fuchsia-200">{state.pot}</span>
                      </span>
                    </div>
                    <div className="flex justify-center gap-0.5 scale-[0.96] opacity-95">
                      {(state.board.length ? state.board : ["--", "--", "--", "--", "--"]).map((c, i) => (
                        <div key={`${c}-${i}`}>{cardView(c, false, true)}</div>
                      ))}
                    </div>
                  </div>
                  <div className="absolute bottom-[15%] left-1/2 z-30 flex -translate-x-1/2 gap-1">
                    {cardView(humanCards[0], false, true)}
                    {cardView(humanCards[1], false, true)}
                  </div>
                  {(() => {
                    const ovalSlots = [
                      "top-1 left-1/2 -translate-x-1/2",
                      "top-[10%] right-1",
                      "bottom-[32%] right-0.5",
                      "bottom-[2%] left-1/2 -translate-x-1/2",
                      "bottom-[32%] left-0.5",
                      "top-[10%] left-1",
                    ];
                    return seats.map((p, idx) => {
                      const seatIndex = seatIndexById.get(p.id) ?? -1;
                      const isToAct = seatIndex === state.toActIndex && !state.isHandOver;
                      const isFolded = !p.inHand;
                      const seatTitle = mobileAliasSeatTitle(seatIndex, p);
                      const isDealer = seatIndex === state.dealerIndex;
                      return (
                        <div
                          key={p.id}
                          className={cn("absolute z-10 w-[5.05rem]", ovalSlots[idx])}
                          style={
                            winFx?.winners.includes(p.name)
                              ? {
                                  filter: "drop-shadow(0 0 8px rgba(250,204,21,0.35))",
                                }
                              : undefined
                          }
                        >
                          <div
                            className={cn(
                              "relative box-border overflow-hidden rounded-md border border-transparent text-[10px] leading-tight",
                              isToAct && "border-cyan-300/45",
                              !isToAct && isFolded && "opacity-65",
                              !isToAct && !isFolded && ""
                            )}
                          >
                            {isDealer ? (
                              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-400 text-[8px] font-bold text-cyan-950">
                                D
                              </span>
                            ) : null}
                            <div
                              className={cn(
                                "px-1 py-1",
                                isFolded ? "bg-zinc-800/45" : "bg-zinc-900/75"
                              )}
                            >
                              {p.id !== "human" ? (
                                <div className="mb-0.5 flex justify-center gap-px">
                                  {revealAllHoleCards ? (
                                    <>
                                      {cardView(state.holeCards[p.id]?.[0] ?? "--", false, true)}
                                      {cardView(state.holeCards[p.id]?.[1] ?? "--", false, true)}
                                    </>
                                  ) : (
                                    <>
                                      {cardView("As", true, true)}
                                      {cardView("Ks", true, true)}
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="h-6" />
                              )}
                              <div className="space-y-0.5 text-center">
                                <div className="truncate text-[12px] font-semibold leading-none text-cyan-100">{seatTitle}</div>
                                <div
                                  className={cn(
                                    "truncate rounded-sm px-1 py-0.5 text-[9px] leading-none",
                                    isFolded ? "bg-zinc-800/70 text-zinc-300" : "bg-black/25 text-cyan-100/90"
                                  )}
                                >
                                  {isFolded ? "弃牌" : getMobilePlayerSubtext(p)}
                                </div>
                              </div>
                              <div className="mt-px flex justify-center gap-px">
                                {isToAct ? (
                                  <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-sky-300" />
                                ) : null}
                                {thinkingActorId === p.id && !state.isHandOver ? (
                                  <Loader2 className="h-2 w-2 animate-spin text-cyan-200" />
                                ) : null}
                              </div>
                            </div>
                            <div
                              className={cn(
                                "py-1 text-center text-[12px] font-bold leading-none tabular-nums text-cyan-100",
                                winFx?.winners.includes(p.name) ? "text-red-300" : ""
                              )}
                            >
                              {isFolded ? "—" : `${p.stack}`}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                <div className="relative hidden grid-cols-3 gap-2 md:grid">
                  <Button
                    size="sm"
                    className="bg-sky-600 text-white hover:bg-sky-500"
                    onClick={() => handleHumanAction("fold", 0, "弃牌")}
                    disabled={actionDisabled}
                  >
                    弃牌
                  </Button>
                  <Button
                    size="sm"
                    className="bg-cyan-600 text-white hover:bg-cyan-500"
                    onClick={() => handleHumanAction(humanToCall > 0 ? "call" : "check", 0, humanToCall > 0 ? "跟注" : "过牌")}
                    disabled={actionDisabled}
                  >
                    {humanToCall > 0 ? `跟注 ${humanToCall}bb` : "过牌"}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-rose-500 text-white hover:bg-rose-400"
                    onClick={() => setShowRaiseOptions((s) => !s)}
                    disabled={actionDisabled || !canHumanRaise}
                  >
                    {state.raiseCountThisRound >= 3 ? "加注 封顶" : canHumanRaise ? `加注 ${selectedRaiseDelta}bb` : "加注 -"}
                  </Button>
                  {showRaiseOptions && isHumanTurn && !isResolving && canHumanRaise ? (
                    <div className="absolute bottom-full right-0 z-30 mb-2 w-44 rounded-lg border border-zinc-700 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur">
                      {raiseChoices.map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => {
                            setRaiseMode(opt.key);
                            setShowRaiseOptions(false);
                            void handleHumanAction("raise", opt.value, opt.key === "allin" ? "全下" : `加注 ${opt.key}`);
                          }}
                          className={`mb-1 w-full rounded px-2 py-1.5 text-left text-xs font-semibold last:mb-0 ${
                            raiseMode === opt.key
                              ? "bg-sky-500 text-white"
                              : opt.variant === "destructive"
                                ? "bg-red-600/90 text-white hover:bg-red-500"
                                : "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {heroHint ? <div className="mt-1 text-center text-[11px] text-zinc-500">{heroHint}</div> : null}
                <div className="mt-2 hidden md:flex">
                  <Button
                    className="w-full border-zinc-600 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                    variant="outline"
                    onClick={() => void newHand()}
                    disabled={isResolving}
                  >
                    <RefreshCcw className="mr-1 h-4 w-4" />
                    {state.isHandOver ? "开始新一局" : "新一局"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2 lg:sticky lg:top-3 lg:self-start lg:space-y-3">
          <Card id="game-log" className="border border-zinc-200 bg-white shadow-sm">
            <CardContent className="px-2 pb-3 pt-0 sm:px-2 sm:py-1">
              <div className="hidden md:block">
                <div className="h-[min(66vh,36rem)] min-h-0">
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
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-700/70 bg-zinc-950/92 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl md:hidden">
        <div className="mx-auto max-w-6xl space-y-2 px-2">
          <div className="relative grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(
                "rounded-xl border border-transparent py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98]",
                actionDisabled || human.stack <= 0 || human.stack <= humanToCall
                  ? "border-zinc-700 bg-zinc-800 text-zinc-500"
                  : "bg-red-700 hover:bg-red-600"
              )}
              disabled={actionDisabled || human.stack <= 0 || human.stack <= humanToCall}
              onClick={() => void handleHumanAction("raise", raiseDeltaByMode("allin"), "全下")}
            >
              全下
            </button>
            <button
              type="button"
              className={cn(
                "rounded-xl border border-transparent py-3 text-sm font-semibold transition active:scale-[0.98]",
                actionDisabled || !canHumanRaise
                  ? "border-zinc-700 bg-zinc-800 text-zinc-500"
                  : "bg-rose-500 text-white hover:bg-rose-400"
              )}
              disabled={actionDisabled || !canHumanRaise}
              onClick={() => setShowRaiseOptions((s) => !s)}
            >
              {state.raiseCountThisRound >= 3 ? "加注 封顶" : `加注 ${selectedRaiseDelta}bb`}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-xl border border-transparent py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98]",
                actionDisabled
                  ? "border-zinc-700 bg-zinc-800 text-zinc-500"
                  : "bg-cyan-600 hover:bg-cyan-500"
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
                "rounded-xl border border-transparent py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98]",
                actionDisabled ? "border-zinc-700 bg-zinc-800 text-zinc-500" : "bg-sky-600 hover:bg-sky-500"
              )}
              disabled={actionDisabled}
              onClick={() => void handleHumanAction("fold", 0, "弃牌")}
            >
              弃牌
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 border border-zinc-700/80 bg-zinc-900/65 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => document.getElementById("game-log")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
            >
              <MessageCircleHeart className="mr-1 h-4 w-4" />
              记录
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 border border-zinc-700/80 bg-zinc-900/65 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              disabled={isResolving}
              onClick={() => void newHand()}
            >
              <RefreshCcw className="mr-1 h-4 w-4" />
              新一局
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 border border-zinc-700/80 bg-zinc-900/65 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => {
                window.location.href = `mailto:regretn@163.com?subject=${encodeURIComponent("鱼桌 - 用户反馈")}`;
              }}
            >
              <Send className="mr-1 h-4 w-4" />
              联系
            </Button>
          </div>
        </div>
      </div>
      {showRaiseOptions ? (
        <div
          className="fixed inset-0 z-20 bg-transparent"
          onClick={() => setShowRaiseOptions(false)}
          aria-hidden="true"
        />
      ) : null}
      {showRaiseOptions ? (
        <div className="fixed bottom-36 left-0 right-0 z-50 mx-auto w-[90%] max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950/95 p-2 shadow-2xl md:hidden">
          {raiseChoices.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setRaiseMode(opt.key);
                setShowRaiseOptions(false);
                void handleHumanAction("raise", opt.value, opt.key === "allin" ? "全下" : `加注 ${opt.key}`);
              }}
              className={`mb-1 w-full rounded px-2 py-2 text-left text-sm font-semibold last:mb-0 ${
                raiseMode === opt.key
                  ? "bg-sky-500 text-white"
                  : opt.variant === "destructive"
                    ? "bg-red-600/90 text-white hover:bg-red-500"
                    : "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft, ArrowUp, Menu, Settings2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  IDB_CHAT_KEY_PREFIX,
  parseStoredRolesFromLocalStorage,
  parseSpeakerLine,
  roleCardImage,
  rolePayload,
  seedOpeningMessage,
  textFromUiMessage,
} from "@/lib/characters-shared";
import { idbGet, idbSet } from "@/lib/indexeddb";
import { supabaseBrowser } from "@/lib/supabase/client";

const LS_VOICE = "characters.roleplay.voiceEnabled.v1";
const LS_AUTO = "characters.roleplay.autoReadAi.v1";

export default function CharacterChatPage() {
  const router = useRouter();
  const params = useParams();
  const roleId = typeof params?.roleId === "string" ? decodeURIComponent(params.roleId) : "";

  const roles = useMemo(() => parseStoredRolesFromLocalStorage(), [roleId]);
  const role = useMemo(() => roles.find((r) => r.id === roleId), [roles, roleId]);

  const [messagesByRole, setMessagesByRole] = useState<Record<string, UIMessage[]>>({});
  /** 避免首屏用空 messages 覆盖 IndexedDB（须等异步读库结束后再允许写入） */
  const [idbReady, setIdbReady] = useState(false);
  const [input, setInput] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoReadAi, setAutoReadAi] = useState(true);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const voiceCtxRef = useRef<AudioContext | null>(null);
  const voiceUnlockedRef = useRef(false);
  const voiceSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const lastSpokenIdRef = useRef("");
  const chatBootstrappedRef = useRef(false);
  const userSentThisSessionRef = useRef(false);
  const [roleplayCredit, setRoleplayCredit] = useState<number | null>(null);
  const [roleplayCreditAuthed, setRoleplayCreditAuthed] = useState(false);

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

  useEffect(() => {
    try {
      setVoiceEnabled(window.localStorage.getItem(LS_VOICE) === "1");
      setAutoReadAi(window.localStorage.getItem(LS_AUTO) !== "0");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_VOICE, voiceEnabled ? "1" : "0");
    } catch {
      // ignore
    }
  }, [voiceEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_AUTO, autoReadAi ? "1" : "0");
    } catch {
      // ignore
    }
  }, [autoReadAi]);

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
    const sb = supabaseBrowser();
    let cancelled = false;
    const loadCredit = async () => {
      const { data } = await sb.auth.getSession();
      const t = data.session?.access_token;
      if (!t) {
        setRoleplayCreditAuthed(false);
        setRoleplayCredit(null);
        return;
      }
      setRoleplayCreditAuthed(true);
      try {
        const resp = await fetch("/api/roleplay-credit", { headers: { Authorization: `Bearer ${t}` } });
        const j = (await resp.json()) as { creditBalance?: number };
        if (cancelled) return;
        if (resp.ok && typeof j.creditBalance === "number") setRoleplayCredit(Math.max(0, Math.floor(j.creditBalance)));
        else setRoleplayCredit(null);
      } catch {
        if (!cancelled) setRoleplayCredit(null);
      }
    };
    void loadCredit();
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      void loadCredit();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onRefresh = () => {
      void supabaseBrowser()
        .auth.getSession()
        .then(({ data }) => {
          const t = data.session?.access_token;
          if (!t) return;
          return fetch("/api/roleplay-credit", { headers: { Authorization: `Bearer ${t}` } });
        })
        .then((resp) => (resp?.ok ? resp.json() : null))
        .then((j: { creditBalance?: unknown } | null) => {
          if (j && typeof j.creditBalance === "number") setRoleplayCredit(Math.max(0, Math.floor(j.creditBalance)));
        })
        .catch(() => {});
    };
    window.addEventListener("roleplay-credit-refresh", onRefresh);
    return () => window.removeEventListener("roleplay-credit-refresh", onRefresh);
  }, []);

  const chatBody = useMemo(() => {
    const payload = rolePayload(roles);
    const sel = role ? { name: role.name, gender: role.gender, style: role.style } : undefined;
    return { gameContext: "", roles: payload, selectedRole: sel, systemPrompt: role?.systemPrompt?.trim() ?? "" };
  }, [roles, role]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        body: chatBody,
        headers: async (): Promise<Record<string, string>> => {
          try {
            const sb = supabaseBrowser();
            const { data } = await sb.auth.getSession();
            const t = data.session?.access_token;
            return t ? { Authorization: `Bearer ${t}` } : {};
          } catch {
            return {};
          }
        },
      }),
    [chatBody]
  );

  const chat = useChat({
    id: roleId || "missing",
    transport,
    messages: messagesByRole[roleId] ?? [],
    onFinish: () => {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("roleplay-credit-refresh"));
    },
  });

  useEffect(() => {
    setIdbReady(false);
  }, [roleId]);

  useEffect(() => {
    if (!roleId) return;
    let cancelled = false;
    const key = `${IDB_CHAT_KEY_PREFIX}${roleId}`;
    void (async () => {
      try {
        if (messagesByRole[roleId]?.length) {
          return;
        }
        const stored = await idbGet<UIMessage[]>(key).catch(() => undefined);
        if (cancelled) return;
        if (stored && Array.isArray(stored) && stored.length > 0) {
          setMessagesByRole((prev) => (prev[roleId] ? prev : { ...prev, [roleId]: stored }));
          return;
        }
        const r = roles.find((x) => x.id === roleId);
        const seed = seedOpeningMessage(r);
        if (!seed) return;
        setMessagesByRole((prev) => (prev[roleId]?.length ? prev : { ...prev, [roleId]: [seed] }));
      } finally {
        if (!cancelled) setIdbReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, roles]);

  useEffect(() => {
    if (!roleId || !idbReady) return;
    const key = `${IDB_CHAT_KEY_PREFIX}${roleId}`;
    const msgs = chat.messages;
    setMessagesByRole((prev) => ({ ...prev, [roleId]: msgs }));
    // 不把空列表写入 IDB，避免 useChat 尚未与受控 messages 对齐时误删历史
    if (msgs.length === 0) return;
    void idbSet(key, msgs).catch(() => {});
  }, [chat.messages, roleId, idbReady]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 160) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [chat.messages.length, chat.status]);

  useEffect(() => {
    chatBootstrappedRef.current = false;
    lastSpokenIdRef.current = "";
    userSentThisSessionRef.current = false;
  }, [roleId]);

  useEffect(() => {
    if (chatBootstrappedRef.current) return;
    if (chat.status === "streaming" || chat.status === "submitted") return;
    const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
    if (!last?.id) return;
    chatBootstrappedRef.current = true;
    if (!userSentThisSessionRef.current) {
      lastSpokenIdRef.current = last.id;
    }
  }, [chat.messages, chat.status, roleId]);

  const playAssistantTts = useCallback(
    async (text: string, speakerName: string) => {
      if (!voiceEnabled) return;
      const t = text.trim();
      if (!t) return;
      const maxLen = 1200;
      const slice = t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
      ttsAbortRef.current?.abort();
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      try {
        await unlockAudio();
        const ctx = voiceCtxRef.current;
        if (!ctx || ctx.state !== "running" || !voiceUnlockedRef.current) return;
        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: slice, speakerName, format: "mp3" }),
          signal: controller.signal,
        });
        if (!resp.ok) return;
        const buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength < 200) return;
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
      } catch {
        // ignore
      }
    },
    [voiceEnabled, unlockAudio]
  );

  useEffect(() => {
    if (!role || !voiceEnabled || !autoReadAi) return;
    if (!chatBootstrappedRef.current) return;
    if (chat.status === "streaming" || chat.status === "submitted") return;
    const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
    if (!last?.id) return;
    if (last.id === lastSpokenIdRef.current) return;
    const raw = textFromUiMessage(last);
    const { content } = parseSpeakerLine(raw);
    const t = (content || raw).replace(/^【[^】]+】\s*/, "").trim();
    if (!t) {
      lastSpokenIdRef.current = last.id;
      return;
    }
    lastSpokenIdRef.current = last.id;
    void playAssistantTts(t, role.name);
  }, [chat.messages, chat.status, voiceEnabled, autoReadAi, role, playAssistantTts]);

  const externalMessages = useMemo(() => {
    return (chat.messages ?? []).map((m) => {
      if (m.role === "user") {
        return { id: m.id, speaker: "你", content: textFromUiMessage(m) };
      }
      const raw = textFromUiMessage(m);
      const { speaker, content } = parseSpeakerLine(raw);
      return { id: m.id, speaker, content };
    });
  }, [chat.messages]);

  useEffect(() => {
    if (voiceEnabled) return;
    ttsAbortRef.current?.abort();
    try {
      voiceSourceRef.current?.stop();
    } catch {
      // ignore
    }
  }, [voiceEnabled]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (chat.status === "submitted" || chat.status === "streaming") return;
    userSentThisSessionRef.current = true;
    void unlockAudio();
    setInput("");
    await chat.sendMessage({ text });
  };

  const coverUrl = role ? roleCardImage(role) : "";

  if (!roleId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#050508] text-white">
        <p className="text-sm text-white/60">无效链接</p>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#050508] px-6 text-center text-white">
        <p className="text-sm text-white/70">找不到该角色</p>
        <Link href="/characters" className="rounded-full bg-[#c8f542] px-5 py-2 text-sm font-semibold text-black">
          返回探索
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#050508] text-white">
      <div className="pointer-events-none fixed inset-0 z-0">
        <img src={coverUrl} alt="" className="h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#050508]/80 via-[#050508]/70 to-[#050508]/95" />
        <div className="absolute inset-0 backdrop-blur-[2px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => {
            if (showChatSettings) {
              setShowChatSettings(false);
              return;
            }
            router.push("/characters");
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md"
          aria-label={showChatSettings ? "关闭配置" : "返回角色列表"}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5">
          <div className="flex min-w-0 items-center justify-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/20">
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            </div>
            <span className="truncate text-sm font-semibold">{role.name}</span>
          </div>
          {roleplayCreditAuthed ? (
            <span className="text-[10px] tabular-nums text-white/50" title="角色扮演独立额度，与德州筹码无关">
              credit {roleplayCredit ?? "…"} · 每条 −10
            </span>
          ) : (
            <span className="text-[10px] text-white/35">未登录不扣 credit</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void unlockAudio();
            setShowChatSettings(true);
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/35 backdrop-blur-md"
          aria-label="聊天配置"
        >
          <Menu className="h-5 w-5 opacity-70" />
        </button>
      </header>

      <div className="relative z-10 flex flex-col items-center px-4 pb-3">
        <div className="relative mt-1 h-24 w-24 overflow-hidden rounded-full ring-4 ring-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{role.name}</h1>
        <p className="mt-0.5 text-xs text-white/50">By @鱼桌</p>
        <div className="mt-3 w-full max-w-md rounded-2xl border border-white/10 bg-[#0a1628]/75 px-4 py-3 text-center text-[13px] leading-relaxed text-white/75 backdrop-blur-xl">
          {role.style}
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {voiceEnabled ? (
          <button
            type="button"
            onClick={() => {
              void unlockAudio();
              setShowChatSettings(true);
            }}
            className="absolute right-3 top-1 z-[6] inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white shadow-lg backdrop-blur-md"
            aria-label="聊天配置"
          >
            <Settings2 className="h-[18px] w-[18px]" />
          </button>
        ) : null}
        <div
          ref={listRef}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-28 [scrollbar-width:thin]"
        >
        <div className="mx-auto flex max-w-lg flex-col gap-4 py-2">
          {externalMessages.map((msg) => {
            const speaker = msg.speaker || "AI";
            const content = msg.content || "";
            const isUser = speaker === "你";
            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end">
                  <p className="max-w-[90%] whitespace-pre-wrap rounded-2xl bg-white/12 px-3 py-2 text-[15px] leading-relaxed text-white/95 shadow-lg">
                    {content}
                  </p>
                </div>
              );
            }
            return (
              <div key={msg.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-0.5">
                  <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
                    <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <span className="text-xs font-semibold text-white/90">{speaker}</span>
                </div>
                <p className="whitespace-pre-wrap pl-9 text-[15px] leading-relaxed text-[#e8f5a3] drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
                  {content}
                </p>
              </div>
            );
          })}
          {chat.error ? <p className="text-center text-xs text-red-300">{chat.error.message}</p> : null}
        </div>
        </div>
      </div>

      {showChatSettings ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-labelledby="chat-settings-title">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="关闭"
            onClick={() => setShowChatSettings(false)}
          />
          <div className="relative max-h-[min(85dvh,520px)] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0a0f18] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
            <div className="flex items-center justify-between gap-3 pb-3">
              <h2 id="chat-settings-title" className="text-base font-semibold">
                聊天配置
              </h2>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80"
                onClick={() => setShowChatSettings(false)}
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1 border-t border-white/10 pt-2">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-3">
                <span className="text-sm text-white/90">语音朗读</span>
                <input
                  type="checkbox"
                  className="h-5 w-9 cursor-pointer accent-[#c8f542]"
                  checked={voiceEnabled}
                  onChange={(e) => {
                    void unlockAudio();
                    setVoiceEnabled(e.target.checked);
                  }}
                />
              </label>
              <label
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-3",
                  !voiceEnabled && "pointer-events-none opacity-45"
                )}
              >
                <span className="text-sm text-white/90">自动朗读 AI 回复</span>
                <input
                  type="checkbox"
                  className="h-5 w-9 cursor-pointer accent-[#c8f542]"
                  checked={autoReadAi}
                  disabled={!voiceEnabled}
                  onChange={(e) => setAutoReadAi(e.target.checked)}
                />
              </label>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-white/45">
              开启语音后，可在聊天区域右上角使用配置按钮快速调整。首次播放需在页面内点击一次以解锁浏览器音频。
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-black"
              style={{ backgroundColor: "#c8f542" }}
              onClick={() => setShowChatSettings(false)}
            >
              完成
            </button>
            <Link
              href="/characters"
              className="mt-3 block py-2 text-center text-xs text-white/40 underline-offset-2 hover:text-white/55"
              onClick={() => setShowChatSettings(false)}
            >
              离开当前聊天，前往角色列表
            </Link>
          </div>
        </div>
      ) : null}

      <div className="fixed bottom-0 left-0 right-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex max-w-lg items-end gap-2 rounded-full border border-white/12 bg-black/45 px-3 py-2 backdrop-blur-xl">
          <textarea
            className="max-h-32 min-h-[44px] flex-1 resize-none border-0 bg-transparent py-2.5 text-[16px] leading-snug text-white outline-none placeholder:text-white/40 focus-visible:ring-0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const ne = e.nativeEvent as Event;
              if ("isComposing" in ne && Boolean((ne as unknown as { isComposing?: boolean }).isComposing)) return;
              if (e.shiftKey) return;
              e.preventDefault();
              void send();
            }}
            disabled={chat.status === "submitted" || chat.status === "streaming"}
            placeholder={`Message ${role.name}`}
            enterKeyHint="send"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={chat.status === "submitted" || chat.status === "streaming" || !input.trim()}
            className={cn(
              "mb-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition",
              chat.status === "submitted" || chat.status === "streaming" || !input.trim()
                ? "bg-white/10 text-white/25"
                : "bg-[#c8f542] text-black hover:opacity-95"
            )}
            aria-label="发送"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

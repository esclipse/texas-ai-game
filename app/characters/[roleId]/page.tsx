"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft, ArrowUp, Menu } from "lucide-react";

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

export default function CharacterChatPage() {
  const params = useParams();
  const roleId = typeof params?.roleId === "string" ? decodeURIComponent(params.roleId) : "";

  const roles = useMemo(() => parseStoredRolesFromLocalStorage(), [roleId]);
  const role = useMemo(() => roles.find((r) => r.id === roleId), [roles, roleId]);

  const [messagesByRole, setMessagesByRole] = useState<Record<string, UIMessage[]>>({});
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

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
      }),
    [chatBody]
  );

  const chat = useChat({
    id: roleId || "missing",
    transport,
    messages: messagesByRole[roleId] ?? [],
  });

  useEffect(() => {
    if (!roleId) return;
    let cancelled = false;
    const key = `${IDB_CHAT_KEY_PREFIX}${roleId}`;
    void (async () => {
      if (messagesByRole[roleId]?.length) return;
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
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, roles]);

  useEffect(() => {
    if (!roleId) return;
    const key = `${IDB_CHAT_KEY_PREFIX}${roleId}`;
    const msgs = chat.messages;
    setMessagesByRole((prev) => ({ ...prev, [roleId]: msgs }));
    void idbSet(key, msgs).catch(() => {});
  }, [chat.messages, roleId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 160) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [chat.messages.length, chat.status]);

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

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (chat.status === "submitted" || chat.status === "streaming") return;
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
        <Link
          href="/characters"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md"
          aria-label="返回"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/20">
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
          <span className="truncate text-sm font-semibold">{role.name}</span>
        </div>
        <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/35 backdrop-blur-md" aria-label="菜单">
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

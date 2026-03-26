"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { updateUserMemoryFromText } from "@/lib/user-memory";

function parseGroupSpeaker(text: string) {
  const trimmed = text.trim();
  const m = trimmed.match(/^【([^】]{1,12})】\s*([\s\S]*)$/);
  if (!m) return { speaker: "AI", content: trimmed };
  return { speaker: m[1].trim() || "AI", content: (m[2] ?? "").trim() };
}

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 70% 45%)`;
}

function isTextPart(part: UIMessage["parts"][number]): part is { type: "text"; text: string } {
  return part.type === "text" && "text" in part && typeof part.text === "string";
}

export function AiRecordChat({
  gameContext,
  groupName,
  memberCount,
  externalMessages,
  className,
}: {
  gameContext: string;
  groupName: string;
  memberCount: number;
  externalMessages: Array<{ id: string; speaker: string; content: string }>;
  className?: string;
}) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          gameContext,
        },
      }),
    [gameContext],
  );

  const { messages, sendMessage, status, stop, error } = useChat<UIMessage>({
    id: "record-ai-chat",
    transport,
  });

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only auto-stick when user is already near bottom.
    if (distanceToBottom < 120) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, externalMessages.length, status]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (isBusy) return;
    updateUserMemoryFromText(text);
    setInput("");
    await sendMessage({ text });
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">
            {groupName} <span className="text-zinc-500">({memberCount})</span>
          </div>
        </div>
        {isBusy ? (
          <button
            type="button"
            className="h-8 shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            onClick={() => stop()}
          >
            停止
          </button>
        ) : null}
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-3"
      >
        <div className="flex flex-col gap-2">
          {externalMessages.length === 0 && messages.length === 0 ? (
            <div className="px-2 py-3 text-xs leading-relaxed text-zinc-500">
              像微信群一样发消息，所有 AI 都能看到。支持 `@Z哥`、`@大炮` 指定谁来回。
            </div>
          ) : null}
          {externalMessages.map((msg) => {
            const speaker = msg.speaker || "AI";
            const content = msg.content || "";
            const initial = speaker.slice(0, 1);
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <div
                  className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs font-bold text-white"
                  style={{ background: avatarColor(speaker) }}
                  aria-hidden
                >
                  {initial}
                </div>
                <div className="max-w-[78%]">
                  <div className="mb-1 px-1 text-xs leading-none text-zinc-500">{speaker}</div>
                  <div className="relative whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <span className="absolute left-[-6px] top-3 h-0 w-0 border-y-[6px] border-r-[6px] border-y-transparent border-r-white" />
                    {content}
                  </div>
                </div>
              </div>
            );
          })}
          {messages.map((m) => {
            const text = m.parts
              .filter(isTextPart)
              .map((p) => p.text)
              .join("");

            if (!text) return null;
            const isUser = m.role === "user";
            const { speaker, content } = isUser ? { speaker: "你", content: text.trim() } : parseGroupSpeaker(text);
            const initial = (speaker || "A").slice(0, 1);
            return (
              <div key={m.id} className={cn("flex items-start gap-2", isUser ? "justify-end" : "justify-start")}>
                {!isUser ? (
                  <div
                    className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs font-bold text-white"
                    style={{ background: avatarColor(speaker) }}
                    aria-hidden
                  >
                    {initial}
                  </div>
                ) : null}

                <div className={cn("max-w-[78%]", isUser ? "items-end" : "items-start")}>
                  {!isUser ? (
                    <div className="mb-1 px-1 text-xs leading-none text-zinc-500">{speaker}</div>
                  ) : null}

                  <div
                    className={cn(
                      "relative whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed shadow-[0_1px_0_rgba(0,0,0,0.04)]",
                      isUser ? "bg-cyan-600 text-white" : "bg-white text-zinc-900"
                    )}
                  >
                    {!isUser ? (
                      <span className="absolute left-[-6px] top-3 h-0 w-0 border-y-[6px] border-r-[6px] border-y-transparent border-r-white" />
                    ) : (
                      <span className="absolute right-[-6px] top-3 h-0 w-0 border-y-[6px] border-l-[6px] border-y-transparent border-l-cyan-600" />
                    )}
                    {content}
                  </div>
                </div>
              </div>
            );
          })}
          {error ? (
            <div className="px-2 text-xs text-red-600">
              {error.message || "聊天失败，请稍后重试。"}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <Textarea
          className="flex-1 focus-visible:ring-cyan-400/30"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (e.nativeEvent.isComposing) return;
            if (e.shiftKey) return; // newline
            e.preventDefault();
            void send();
          }}
          disabled={isBusy}
          placeholder="回车发送；Shift+Enter 换行；支持 @Z哥 / @大炮 指定某个 AI 回复…"
        />
      </div>
    </div>
  );
}


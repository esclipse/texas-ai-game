"use client";

import { useEffect, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 70% 45%)`;
}

export function AiRecordChat({
  gameContext,
  groupName,
  memberCount,
  externalMessages,
  onSend,
  className,
}: {
  gameContext: string;
  groupName: string;
  memberCount: number;
  externalMessages: Array<{ id: string; speaker: string; content: string }>;
  onSend: (text: string, gameContext: string) => Promise<void>;
  className?: string;
}) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only auto-stick when user is already near bottom.
    if (distanceToBottom < 120) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [externalMessages.length, isBusy]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (isBusy) return;
    setInput("");
    setIsBusy(true);
    setErrorText("");
    try {
      await onSend(text, gameContext);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "聊天失败，请稍后重试。");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">
            {groupName} <span className="text-zinc-500">({memberCount})</span>
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-3"
      >
        <div className="flex flex-col gap-2">
          {externalMessages.length === 0 ? (
            <div className="px-2 py-3 text-xs leading-relaxed text-zinc-500">
              直接对桌上 AI 说话就行。想指定某个 AI，可以用 `@Z哥`、`@大炮`。
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
          {errorText ? <div className="px-2 text-xs text-red-600">{errorText}</div> : null}
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
          placeholder="回车发送；Shift+Enter 换行…"
        />
      </div>
    </div>
  );
}


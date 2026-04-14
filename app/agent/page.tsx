"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { UserBubble, AssistantBubble } from "@/components/agent/message-bubble";
import { ToolCard } from "@/components/agent/tool-card";
import type { ChatMessage, AgentSseEvent } from "@/lib/agent/types";

// ── Session storage ──────────────────────────────────────────────────────────

type Session = { id: string; title: string; messages: ChatMessage[] };

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem("agent-sessions");
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem("agent-sessions", JSON.stringify(sessions));
}

function newSession(): Session {
  return { id: crypto.randomUUID(), title: "新对话", messages: [] };
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = loadSessions();
    if (stored.length > 0) {
      setSessions(stored);
      setActiveId(stored[0].id);
    } else {
      const s = newSession();
      setSessions([s]);
      setActiveId(s.id);
    }
  }, []);

  useEffect(() => {
    if (sessions.length > 0) saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, activeId]);

  const activeSession = sessions.find((s) => s.id === activeId);

  const updateMessages = useCallback(
    (id: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, messages: updater(s.messages) } : s))
      );
    },
    []
  );

  const createSession = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);

    const sessionId = activeId;

    const userMsg: ChatMessage = { role: "user", content: text };
    updateMessages(sessionId, (msgs) => {
      if (msgs.length === 0) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, title: text.slice(0, 24) } : s
          )
        );
      }
      return [...msgs, userMsg];
    });

    // Build API messages (user/assistant only)
    const apiMessages = [...(activeSession?.messages ?? []), userMsg]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: (m as { content: string }).content }));

    // Placeholder streaming assistant message
    updateMessages(sessionId, (msgs) => [
      ...msgs,
      { role: "assistant", content: "" } as ChatMessage,
    ]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const resp = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abort.signal,
      });

      if (!resp.ok || !resp.body) {
        updateMessages(sessionId, (msgs) =>
          msgs.map((m, i) =>
            i === msgs.length - 1 && m.role === "assistant"
              ? { ...m, content: `⚠️ Error: ${resp.status}` }
              : m
          )
        );
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice("data: ".length).trim();
          if (!raw) continue;

          let event: AgentSseEvent;
          try {
            event = JSON.parse(raw) as AgentSseEvent;
          } catch {
            continue;
          }

          if (event.type === "text-delta") {
            updateMessages(sessionId, (msgs) =>
              msgs.map((m, i) =>
                i === msgs.length - 1 && m.role === "assistant"
                  ? { ...m, content: (m as { content: string }).content + event.delta }
                  : m
              )
            );
          } else if (event.type === "tool-start") {
            updateMessages(sessionId, (msgs) => [
              ...msgs,
              {
                role: "tool",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                pending: true,
              } as ChatMessage,
            ]);
          } else if (event.type === "tool-result") {
            updateMessages(sessionId, (msgs) =>
              msgs.map((m) =>
                m.role === "tool" && m.toolCallId === event.toolCallId
                  ? { ...m, result: event.result, isError: event.isError, pending: false }
                  : m
              )
            );
          } else if (event.type === "error") {
            updateMessages(sessionId, (msgs) =>
              msgs.map((m, i) =>
                i === msgs.length - 1 && m.role === "assistant"
                  ? { ...m, content: `⚠️ ${event.message}` }
                  : m
              )
            );
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        updateMessages(sessionId, (msgs) =>
          msgs.map((m, i) =>
            i === msgs.length - 1 && m.role === "assistant"
              ? { ...m, content: "⚠️ 请求失败，请重试" }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-gray-700 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="font-semibold text-sm">Agent Chat</span>
          <button
            onClick={createSession}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            + New
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`w-full text-left px-4 py-2.5 text-sm truncate transition-colors ${
                s.id === activeId
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main chat area */}
      <main className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 overflow-y-auto py-4">
          {activeSession?.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
              <span className="text-5xl">🤖</span>
              <p className="text-sm">你好！我可以帮你搜索信息、生成图片/视频、执行代码。</p>
              <div className="flex gap-2 flex-wrap justify-center text-xs text-gray-600">
                <span className="px-3 py-1 rounded-full border border-gray-700">🔍 网页搜索</span>
                <span className="px-3 py-1 rounded-full border border-gray-700">🖼️ 图片生成</span>
                <span className="px-3 py-1 rounded-full border border-gray-700">🎬 视频生成</span>
                <span className="px-3 py-1 rounded-full border border-gray-700">💻 代码执行</span>
              </div>
            </div>
          )}

          {activeSession?.messages.map((msg, i) => {
            if (msg.role === "user") return <UserBubble key={i} msg={msg} />;
            if (msg.role === "assistant")
              return (
                <AssistantBubble
                  key={i}
                  msg={msg}
                  streaming={streaming && i === activeSession.messages.length - 1}
                />
              );
            if (msg.role === "tool") return <ToolCard key={msg.toolCallId} msg={msg} />;
            return null;
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-700 px-4 py-3 flex gap-3 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="发消息… (Enter 发送，Shift+Enter 换行)"
            rows={2}
            disabled={streaming}
            className="flex-1 resize-none rounded-xl bg-gray-800 border border-gray-600 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={() => void send()}
            disabled={streaming || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {streaming ? "…" : "发送"}
          </button>
        </div>
      </main>
    </div>
  );
}

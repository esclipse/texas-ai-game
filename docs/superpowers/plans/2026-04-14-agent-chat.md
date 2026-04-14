# Agent Chat Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `/agent` page with a YouMind-style chat UI where the LLM can call tools (web search, image gen, video gen, code execution) via OpenAI function calling, fully streamed via SSE.

**Architecture:** Single POST `/api/agent` route runs a server-side agent loop: call LLM → if tool_calls, execute tools in parallel, push SSE events, append results, repeat → stream final text. Frontend subscribes to the SSE stream and renders tool cards inline.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, `@ai-sdk/openai` + `openai` npm package for streaming tool calls, `lucide-react` for icons, `localStorage` for session history.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/agent/tools.ts` | Create | OpenAI function schemas for all 4 tools |
| `lib/agent/executor.ts` | Create | Executes a tool call by name, returns result |
| `lib/agent/types.ts` | Create | Shared SSE event types + message types |
| `app/api/agent/route.ts` | Create | Agent loop: LLM → tools → LLM, streams SSE |
| `app/agent/page.tsx` | Create | Full-page chat UI with sidebar + message stream |
| `components/agent/tool-card.tsx` | Create | Renders tool-start/tool-result inline card |
| `components/agent/message-bubble.tsx` | Create | Renders user/assistant text bubbles |

---

## Task 1: Shared Types

**Files:**
- Create: `lib/agent/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// lib/agent/types.ts

export type AgentSseEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-start"; toolName: string; toolCallId: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown; isError?: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = { role: "assistant"; content: string };
export type ToolMessage = {
  role: "tool";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  pending: boolean;
};

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage;
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/types.ts
git commit -m "feat(agent): add shared SSE event and message types"
```

---

## Task 2: Tool Schemas

**Files:**
- Create: `lib/agent/tools.ts`

- [ ] **Step 1: Create tool schemas**

```ts
// lib/agent/tools.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const agentTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for up-to-date information. Use for current events, facts, or anything requiring real-time data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image from a text description. Returns a URL.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed image description in English" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video",
      description: "Generate a short video from a text description. Returns a URL. Takes longer than image generation.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed video description in English" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_code",
      description: "Execute Python code and return stdout/stderr. Use for calculations, data processing, or code examples.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Python code to execute" },
          language: { type: "string", enum: ["python"], description: "Programming language (only python supported)" },
        },
        required: ["code", "language"],
      },
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/tools.ts
git commit -m "feat(agent): add OpenAI function schemas for 4 tools"
```

---

## Task 3: Tool Executor

**Files:**
- Create: `lib/agent/executor.ts`

- [ ] **Step 1: Create executor**

```ts
// lib/agent/executor.ts

type ToolResult = { result: unknown; isError?: boolean };

async function webSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? "");
  const apiKey = process.env.TAVILY_API_KEY ?? "";
  if (!apiKey) return { result: "TAVILY_API_KEY not configured", isError: true };

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return { result: `Tavily error: ${resp.status}`, isError: true };
  const data = (await resp.json()) as { results?: Array<{ title: string; url: string; content: string }> };
  const results = (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 300),
  }));
  return { result: results };
}

async function generateImage(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = String(args.prompt ?? "");
  const apiKey = process.env.IMAGE_API_KEY ?? process.env.MINIMAX_API_KEY ?? "";
  const baseUrl = process.env.IMAGE_BASE_URL ?? "https://api.minimax.io/v1";
  if (!apiKey) return { result: "IMAGE_API_KEY not configured", isError: true };

  const resp = await fetch(`${baseUrl}/image_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "image-01", prompt }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) return { result: `Image API error: ${resp.status}`, isError: true };
  const data = (await resp.json()) as { data?: { image_urls?: string[] } };
  const url = data.data?.image_urls?.[0];
  if (!url) return { result: "No image URL returned", isError: true };
  return { result: { url, type: "image" } };
}

async function generateVideo(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = String(args.prompt ?? "");
  const apiKey = process.env.MINIMAX_API_KEY ?? "";
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  if (!apiKey) return { result: "MINIMAX_API_KEY not configured", isError: true };

  // Step 1: submit task
  const submitResp = await fetch(`${baseUrl}/video_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "video-01", prompt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!submitResp.ok) return { result: `Video submit error: ${submitResp.status}`, isError: true };
  const submitData = (await submitResp.json()) as { task_id?: string };
  const taskId = submitData.task_id;
  if (!taskId) return { result: "No task_id returned", isError: true };

  // Step 2: poll for result (max 90s)
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollResp = await fetch(`${baseUrl}/query/video_generation?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!pollResp.ok) continue;
    const pollData = (await pollResp.json()) as {
      status?: string;
      file_id?: string;
      download_url?: string;
    };
    if (pollData.status === "Success") {
      const url = pollData.download_url;
      if (!url) return { result: "No download URL", isError: true };
      return { result: { url, type: "video" } };
    }
    if (pollData.status === "Fail") return { result: "Video generation failed", isError: true };
  }
  return { result: "Video generation timed out after 90s", isError: true };
}

async function runCode(args: Record<string, unknown>): Promise<ToolResult> {
  const code = String(args.code ?? "");
  // Use child_process in a simple sandbox. For production, swap with E2B.
  const { execSync } = await import("child_process");
  try {
    const stdout = execSync(`python3 -c ${JSON.stringify(code)}`, {
      timeout: 10_000,
      maxBuffer: 1024 * 64,
      env: { PATH: process.env.PATH ?? "" }, // no extra env vars in sandbox
    })
      .toString()
      .trim();
    return { result: { stdout, stderr: "" } };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    return {
      result: {
        stdout: err.stdout?.toString().trim() ?? "",
        stderr: err.stderr?.toString().trim() ?? err.message ?? "execution error",
      },
      isError: true,
    };
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case "web_search":    return webSearch(args);
    case "generate_image": return generateImage(args);
    case "generate_video": return generateVideo(args);
    case "run_code":      return runCode(args);
    default:              return { result: `Unknown tool: ${name}`, isError: true };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/executor.ts
git commit -m "feat(agent): add tool executor for web search, image/video gen, code exec"
```

---

## Task 4: Agent API Route

**Files:**
- Create: `app/api/agent/route.ts`

- [ ] **Step 1: Install openai package if not present**

```bash
pnpm add openai
```

- [ ] **Step 2: Create the route**

```ts
// app/api/agent/route.ts
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { NextResponse } from "next/server";
import { getLlmConfig } from "@/lib/app-config";
import { agentTools } from "@/lib/agent/tools";
import { executeTool } from "@/lib/agent/executor";
import type { AgentSseEvent } from "@/lib/agent/types";

export const maxDuration = 60;

function sse(event: AgentSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools.
When the user asks for something that requires real-time information, use web_search.
When asked to create visual content, use generate_image or generate_video.
When asked to run or demonstrate code, use run_code.
Respond in the same language the user writes in.`;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages?: unknown[] };
  const messages = Array.isArray(body.messages) ? (body.messages as ChatCompletionMessageParam[]) : [];

  const { providersForChat } = getLlmConfig();
  const provider = providersForChat[0];
  if (!provider?.apiKey || !provider.baseUrl || !provider.models?.chat) {
    return NextResponse.json({ error: "LLM provider not configured" }, { status: 500 });
  }

  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: AgentSseEvent) => controller.enqueue(enc.encode(sse(event)));

      const conversationMessages: ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ];

      const MAX_ITERATIONS = 5;
      let assistantText = "";

      try {
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const completion = await client.chat.completions.create({
            model: provider.models!.chat!,
            messages: conversationMessages,
            tools: agentTools,
            tool_choice: "auto",
            stream: true,
            temperature: 0.7,
            max_tokens: 1024,
          });

          let finishReason = "";
          const toolCallsAccum: Record<string, { name: string; args: string; id: string }> = {};
          assistantText = "";

          for await (const chunk of completion) {
            const choice = chunk.choices[0];
            if (!choice) continue;

            // Accumulate text delta
            const textDelta = choice.delta?.content;
            if (textDelta) {
              assistantText += textDelta;
              send({ type: "text-delta", delta: textDelta });
            }

            // Accumulate tool call chunks
            const toolCalls = choice.delta?.tool_calls;
            if (toolCalls) {
              for (const tc of toolCalls) {
                const idx = String(tc.index ?? 0);
                if (!toolCallsAccum[idx]) {
                  toolCallsAccum[idx] = { name: "", args: "", id: "" };
                }
                toolCallsAccum[idx].name += tc.function?.name ?? "";
                toolCallsAccum[idx].args += tc.function?.arguments ?? "";
                toolCallsAccum[idx].id = tc.id ?? toolCallsAccum[idx].id;
              }
            }

            finishReason = choice.finish_reason ?? finishReason;
          }

          const toolCallsList = Object.values(toolCallsAccum);

          if (finishReason === "tool_calls" && toolCallsList.length > 0) {
            // Add assistant message with tool_calls
            conversationMessages.push({
              role: "assistant",
              content: assistantText || null,
              tool_calls: toolCallsList.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
              })),
            });

            // Execute all tool calls in parallel
            const results = await Promise.all(
              toolCallsList.map(async (tc) => {
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(tc.args) as Record<string, unknown>; } catch { /* ignore */ }

                send({ type: "tool-start", toolName: tc.name, toolCallId: tc.id, args });
                const { result, isError } = await executeTool(tc.name, args);
                send({ type: "tool-result", toolCallId: tc.id, toolName: tc.name, result, isError });

                return { toolCallId: tc.id, result, isError };
              })
            );

            // Append tool results
            for (const r of results) {
              conversationMessages.push({
                role: "tool",
                tool_call_id: r.toolCallId,
                content: typeof r.result === "string" ? r.result : JSON.stringify(r.result),
              });
            }
            // continue loop
          } else {
            // Natural finish
            break;
          }
        }

        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Agent error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/agent/route.ts
git commit -m "feat(agent): add streaming agent API route with tool loop"
```

---

## Task 5: ToolCard Component

**Files:**
- Create: `components/agent/tool-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/agent/tool-card.tsx
"use client";

import type { ToolMessage } from "@/lib/agent/types";

const toolLabels: Record<string, string> = {
  web_search: "网页搜索",
  generate_image: "图片生成",
  generate_video: "视频生成",
  run_code: "代码执行",
};

const toolIcons: Record<string, string> = {
  web_search: "🔍",
  generate_image: "🖼️",
  generate_video: "🎬",
  run_code: "💻",
};

type SearchResult = { title: string; url: string; snippet?: string };
type ImageResult = { url: string; type: "image" };
type VideoResult = { url: string; type: "video" };
type CodeResult = { stdout: string; stderr: string };

function renderResult(toolName: string, result: unknown) {
  if (result === null || result === undefined) return null;

  if (toolName === "generate_image") {
    const r = result as ImageResult;
    if (r?.type === "image" && r.url) {
      return <img src={r.url} alt="generated" className="mt-2 max-w-xs rounded-lg" />;
    }
  }

  if (toolName === "generate_video") {
    const r = result as VideoResult;
    if (r?.type === "video" && r.url) {
      return (
        <video controls className="mt-2 max-w-sm rounded-lg" src={r.url}>
          Your browser does not support video.
        </video>
      );
    }
  }

  if (toolName === "web_search") {
    const results = result as SearchResult[];
    if (Array.isArray(results)) {
      return (
        <ul className="mt-2 space-y-1">
          {results.map((r, i) => (
            <li key={i} className="text-xs">
              <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline font-medium">
                {r.title}
              </a>
              {r.snippet && <p className="text-gray-400 mt-0.5">{r.snippet}</p>}
            </li>
          ))}
        </ul>
      );
    }
  }

  if (toolName === "run_code") {
    const r = result as CodeResult;
    return (
      <div className="mt-2 space-y-1 font-mono text-xs">
        {r?.stdout && (
          <pre className="bg-gray-900 rounded p-2 text-green-400 whitespace-pre-wrap">{r.stdout}</pre>
        )}
        {r?.stderr && (
          <pre className="bg-gray-900 rounded p-2 text-red-400 whitespace-pre-wrap">{r.stderr}</pre>
        )}
      </div>
    );
  }

  // Fallback: JSON
  return (
    <pre className="mt-2 text-xs bg-gray-900 rounded p-2 text-gray-300 whitespace-pre-wrap overflow-auto max-h-40">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

export function ToolCard({ msg }: { msg: ToolMessage }) {
  const icon = toolIcons[msg.toolName] ?? "🔧";
  const label = toolLabels[msg.toolName] ?? msg.toolName;

  return (
    <div className="my-2 mx-4 rounded-xl border border-gray-700 bg-gray-800/60 px-4 py-3 text-sm max-w-xl">
      <div className="flex items-center gap-2 font-medium text-gray-200">
        <span>{icon}</span>
        <span>{label}</span>
        {msg.pending && (
          <span className="ml-auto text-xs text-gray-400 animate-pulse">执行中…</span>
        )}
        {!msg.pending && !msg.isError && (
          <span className="ml-auto text-xs text-green-400">✓ 完成</span>
        )}
        {!msg.pending && msg.isError && (
          <span className="ml-auto text-xs text-red-400">✗ 失败</span>
        )}
      </div>

      {/* Show args summary */}
      <div className="mt-1 text-xs text-gray-400">
        {Object.entries(msg.args)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
          .join(" · ")}
      </div>

      {/* Show result */}
      {!msg.pending && msg.result !== undefined && renderResult(msg.toolName, msg.result)}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/agent/tool-card.tsx
git commit -m "feat(agent): add ToolCard component for inline tool result rendering"
```

---

## Task 6: MessageBubble Component

**Files:**
- Create: `components/agent/message-bubble.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/agent/message-bubble.tsx
"use client";

import type { UserMessage, AssistantMessage } from "@/lib/agent/types";

export function UserBubble({ msg }: { msg: UserMessage }) {
  return (
    <div className="flex justify-end px-4 my-2">
      <div className="max-w-xl rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap break-words">
        {msg.content}
      </div>
    </div>
  );
}

export function AssistantBubble({ msg, streaming }: { msg: AssistantMessage; streaming?: boolean }) {
  return (
    <div className="flex justify-start px-4 my-2">
      <div className="max-w-xl rounded-2xl rounded-tl-sm bg-gray-700 px-4 py-2.5 text-sm text-gray-100 whitespace-pre-wrap break-words">
        {msg.content}
        {streaming && (
          <span className="inline-block w-1.5 h-4 bg-gray-300 ml-0.5 align-middle animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/agent/message-bubble.tsx
git commit -m "feat(agent): add UserBubble and AssistantBubble components"
```

---

## Task 7: Agent Chat Page

**Files:**
- Create: `app/agent/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// app/agent/page.tsx
"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { UserBubble, AssistantBubble } from "@/components/agent/message-bubble";
import { ToolCard } from "@/components/agent/tool-card";
import type { ChatMessage, AgentSseEvent } from "@/lib/agent/types";

// ── Session storage (localStorage) ──────────────────────────────────────────

type Session = { id: string; title: string; messages: ChatMessage[] };

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem("agent-sessions");
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch { return []; }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem("agent-sessions", JSON.stringify(sessions));
}

function newSession(): Session {
  return { id: crypto.randomUUID(), title: "新对话", messages: [] };
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load sessions from localStorage on mount
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

  // Persist whenever sessions change
  useEffect(() => {
    if (sessions.length > 0) saveSessions(sessions);
  }, [sessions]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, activeId]);

  const activeSession = sessions.find((s) => s.id === activeId);

  const updateMessages = useCallback((id: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, messages: updater(s.messages) } : s))
    );
  }, []);

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

    // Add user message
    const userMsg: ChatMessage = { role: "user", content: text };
    updateMessages(sessionId, (msgs) => {
      const next = [...msgs, userMsg];
      // Auto-title session from first message
      if (msgs.length === 0) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: text.slice(0, 24) } : s))
        );
      }
      return next;
    });

    // Build API messages (exclude tool messages — send only user/assistant pairs)
    const apiMessages = [...(activeSession?.messages ?? []), userMsg]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: (m as { content: string }).content }));

    // Placeholder assistant message for streaming
    const assistantMsgId = crypto.randomUUID();
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
              ? { ...m, content: `Error: ${resp.status}` }
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
          try { event = JSON.parse(raw) as AgentSseEvent; } catch { continue; }

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

  // Unused: assistantMsgId is used as a key for the streaming bubble identity,
  // but we identify by array position above. Fine for MVP.
  void assistantMsgId;

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
        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4">
          {activeSession?.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
              <span className="text-4xl">🤖</span>
              <p className="text-sm">你好！我可以帮你搜索、生成图片/视频、执行代码。</p>
            </div>
          )}
          {activeSession?.messages.map((msg, i) => {
            if (msg.role === "user") return <UserBubble key={i} msg={msg} />;
            if (msg.role === "assistant")
              return (
                <AssistantBubble
                  key={i}
                  msg={msg}
                  streaming={streaming && i === (activeSession.messages.length - 1)}
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
```

- [ ] **Step 2: Commit**

```bash
git add app/agent/page.tsx
git commit -m "feat(agent): add full-page chat UI with sidebar, tool cards, streaming"
```

---

## Task 8: Wire Up & Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Ensure env vars are set (create `.env.local` if missing)**

Add these keys as needed (Tavily required for web_search; others optional):

```bash
TAVILY_API_KEY=tvly-xxxx
IMAGE_API_KEY=eyJxxx          # MiniMax or DALL-E key
MINIMAX_API_KEY=eyJxxx
```

- [ ] **Step 2: Start dev server**

```bash
pnpm dev
```

Expected: server starts on port 8080

- [ ] **Step 3: Open the agent page**

Navigate to `http://localhost:8080/agent`

Expected: sidebar with "新对话", empty state with robot emoji

- [ ] **Step 4: Send a basic message (no tools)**

Type: `你好，给我介绍一下你能做什么`
Expected: streaming text reply

- [ ] **Step 5: Test web search**

Type: `搜索一下今天有什么科技新闻`
Expected: tool card with 🔍 and spinner → then source list with URLs

- [ ] **Step 6: Test image generation**

Type: `生成一张赛博朋克风格的城市图片`
Expected: tool card with 🖼️ → then `<img>` renders

- [ ] **Step 7: Test code execution**

Type: `用python计算1到100的和`
Expected: tool card with 💻 → stdout shows `5050`

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat(agent): agent chat page complete - web search, image/video gen, code exec"
```

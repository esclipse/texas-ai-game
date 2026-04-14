# Agent Chat Page — Design Spec

**Date:** 2026-04-14

## Overview

A standalone `/agent` page that provides a YouMind-style chat experience where users can converse with an LLM that can call tools (web search, image gen, video gen, code execution) in a streaming loop. All orchestration happens server-side via a single SSE connection.

---

## Architecture

### New Files

```
app/agent/page.tsx               # Chat UI
app/api/agent/route.ts           # Server-side agent loop
lib/agent/tools.ts               # Tool schemas (OpenAI function definitions)
lib/agent/executor.ts            # Tool executor (calls external APIs)
```

### Agent Loop (`/api/agent`)

```
POST { messages: UIMessage[] }
  while true:
    call LLM with tools list (streaming)
    if finish_reason == "tool_calls":
      SSE: { type: "tool-start", toolName, args }
      execute all tool calls in parallel
      SSE: { type: "tool-result", toolName, result }
      append tool results to messages
      continue loop
    else:
      SSE: { type: "text-delta", delta }
      break
SSE: { type: "done" }
```

Max loop iterations: 5 (guard against infinite loops).

### SSE Event Schema

```ts
{ type: "text-delta";   delta: string }
{ type: "tool-start";   toolName: string; args: Record<string, unknown> }
{ type: "tool-result";  toolName: string; result: unknown; isError?: boolean }
{ type: "error";        message: string }
{ type: "done" }
```

---

## Tools

| Tool | Schema Name | Backend | Key Env Var |
|---|---|---|---|
| Web search | `web_search` | Tavily REST API | `TAVILY_API_KEY` |
| Image generation | `generate_image` | MiniMax T2I or DALL-E | `IMAGE_API_KEY` |
| Video generation | `generate_video` | MiniMax Video API | `MINIMAX_API_KEY` |
| Code execution | `run_code` | E2B sandbox or child_process | `E2B_API_KEY` (optional) |

Each tool is defined as an OpenAI-compatible function schema in `lib/agent/tools.ts` and dispatched in `lib/agent/executor.ts`.

---

## Frontend (`app/agent/page.tsx`)

### Layout

```
┌─────────────────────────────────────────────────┐
│  [Agent Chat]                              [New] │
├──────────┬──────────────────────────────────────┤
│ History  │  Message stream                       │
│ (local-  │  ┌─ User bubble ──────────────────┐  │
│ Storage) │  │  "帮我搜一下今天的新闻"           │  │
│          │  └────────────────────────────────┘  │
│          │  ┌─ Tool card: web_search ─────────┐  │
│          │  │  🔍 Searching...  → ✅ 3 results │  │
│          │  └────────────────────────────────┘  │
│          │  ┌─ Assistant bubble ─────────────┐  │
│          │  │  今天的主要新闻是...              │  │
│          │  └────────────────────────────────┘  │
│          │                                       │
│          │  [Textarea]              [Send ▶]     │
└──────────┴──────────────────────────────────────┘
```

### Message Rendering

- User messages: right-aligned bubble
- Assistant text: left-aligned bubble with streaming cursor
- Tool invocations: inline card showing `tool-start` → spinner → `tool-result` → rendered result
  - Video result: `<video>` player
  - Image result: `<img>` tag
  - Web search result: collapsible source list
  - Code result: code block with output

### State

```ts
type MessageItem =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }   // streams in
  | { role: "tool"; toolName: string; args: object; result?: unknown; isError?: boolean }
```

Conversation history stored in `localStorage` keyed by session ID. New session on page load or when user clicks "New".

---

## API Route Details

- `POST /api/agent` accepts `{ messages }`, uses existing `getLlmConfig()` provider fallback
- Uses `openai` SDK streaming with `stream: true` + `tool_choice: "auto"`
- `maxDuration = 60` (Vercel edge limit)
- No credit deduction in first iteration (can wire in later)
- System prompt: generic assistant, tool-capable, responds in user's language

---

## Error Handling

- Tool failure: SSE `tool-result` with `isError: true`, loop continues so LLM can react
- LLM failure: SSE `error` event, stream closes
- Loop limit exceeded: SSE `error: "Max iterations reached"`, returns partial assistant text

---

## Out of Scope (First Iteration)

- Auth / credit deduction
- Server-side history persistence (Supabase)
- Multi-modal input (file upload, image input)
- Custom skill plugins

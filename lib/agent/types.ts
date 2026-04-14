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

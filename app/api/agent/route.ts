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
  const messages = Array.isArray(body.messages)
    ? (body.messages as ChatCompletionMessageParam[])
    : [];

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
          let assistantText = "";

          for await (const chunk of completion) {
            const choice = chunk.choices[0];
            if (!choice) continue;

            const textDelta = choice.delta?.content;
            if (textDelta) {
              assistantText += textDelta;
              send({ type: "text-delta", delta: textDelta });
            }

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
            conversationMessages.push({
              role: "assistant",
              content: assistantText || null,
              tool_calls: toolCallsList.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
              })),
            });

            const results = await Promise.all(
              toolCallsList.map(async (tc) => {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.args) as Record<string, unknown>;
                } catch {
                  /* ignore */
                }

                send({ type: "tool-start", toolName: tc.name, toolCallId: tc.id, args });
                const { result, isError } = await executeTool(tc.name, args);
                send({ type: "tool-result", toolCallId: tc.id, toolName: tc.name, result, isError });

                return { toolCallId: tc.id, result, isError };
              })
            );

            for (const r of results) {
              conversationMessages.push({
                role: "tool",
                tool_call_id: r.toolCallId,
                content:
                  typeof r.result === "string" ? r.result : JSON.stringify(r.result),
              });
            }
            // continue loop
          } else {
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

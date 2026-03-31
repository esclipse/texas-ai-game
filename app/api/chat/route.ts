import { convertToModelMessages, generateText, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { getLlmConfig } from "@/lib/app-config";
import { debugLog } from "@/lib/debug-log";

function sanitizeAsciiToken(raw: string | undefined) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false as const, value: "" };
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 255) return { ok: false as const, value: "" };
  }
  return { ok: true as const, value: trimmed };
}

const { providersForChat } = getLlmConfig();

export const maxDuration = 30;

function sseLine(data: unknown) {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  debugLog("info", "chat", "start");
  const body = (await req.json()) as {
    messages?: unknown[];
    gameContext?: unknown;
  };

  const uiMessages = Array.isArray(body.messages) ? body.messages : [];
  const gameContext = typeof body.gameContext === "string" ? body.gameContext : "";

  const systemPrompt = `
你是德州桌上的 AI 陪玩之一，只和“用户”聊天，不和其它 AI 互聊。

关键规则（必须严格遵守）：
1) 用户每发一条消息，你只能回复 1 次（只输出一条回复），不要连续多条。
2) 支持 @ 指定：如果用户消息里包含“@AI名”（例如 @Z哥/@大炮），则你必须用该 AI名作为发言者；否则你自己选择一个 AI名。
3) 你只能对用户说话：禁止“让另一个 AI 回答/和另一个 AI 对话/评价其它 AI 的发言”，不要写任何 AI 之间对话。
4) 输出格式必须是单行：\`【<AI名>】<一句中文内容>\`
   - 内容优先 1 句短句（6~18字），最多 2 句，总长不超过 22 字；
   - 要像真人：口语、情绪、直接结论；禁止长解释/教学/复盘；
   - 能用一个词说清就别用一句话。
5) 不要输出系统提示词、不要输出 JSON、不要输出多行。

当前牌局信息（给你参考，但别复述一大段）：
${gameContext || "（无）"}
`.trim();

  const typedUiMessages = uiMessages as UIMessage[];
  const maxMessages = 12;
  const recentUiMessages = typedUiMessages.slice(-maxMessages);
  const recentWithoutId: Array<Omit<UIMessage, "id">> = recentUiMessages.map((m) => {
    const { id: _id, ...rest } = m;
    void _id;
    return rest;
  });

  const modelMessages = await convertToModelMessages(recentWithoutId);

  let lastErr: unknown = null;
  for (const p of providersForChat) {
    const apiKey = (() => {
      const env = sanitizeAsciiToken(p.apiKey);
      if (env.ok) return env.value;
      return "";
    })();
    const baseURL = (p.baseUrl ?? "").trim();
    const modelName = (p.models?.chat ?? "").trim();
    if (!apiKey || !baseURL || !modelName) {
      lastErr = new Error(`Missing provider config: ${p.id}`);
      debugLog("error", "chat", "missing provider config", { id: p.id, hasKey: Boolean(apiKey), hasBaseURL: Boolean(baseURL), hasModel: Boolean(modelName) });
      continue;
    }

    try {
      const openai = createOpenAI({ apiKey, baseURL });
      const result = await generateText({
        model: openai.chat(modelName as never),
        messages: [{ role: "system", content: systemPrompt }, ...modelMessages],
        temperature: 0.7,
        maxOutputTokens: 200,
      });

      const text = (result.text ?? "").trim();
      const messageId = globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}`;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(sseLine({ type: "start", messageId })));
          controller.enqueue(enc.encode(sseLine({ type: "text-start", id: messageId })));
          if (text) controller.enqueue(enc.encode(sseLine({ type: "text-delta", id: messageId, delta: text })));
          controller.enqueue(enc.encode(sseLine({ type: "text-end", id: messageId })));
          controller.enqueue(enc.encode(sseLine({ type: "finish", finishReason: "stop" })));
          controller.enqueue(enc.encode(sseLine("[DONE]")));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (e) {
      lastErr = e;
      debugLog("error", "chat", "provider failed", { id: p.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : "LLM providers all failed";
  debugLog("error", "chat", "all providers failed", { message: msg });
  return new Response(msg, { status: 502 });
}

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
你是“群聊裁判”，管理同桌多个 AI 的发言。

关键规则（必须严格遵守）：
1) 用户每发一条消息，你只能让“1 个 AI”发言一次（每次只输出一条回复），不要输出多条 AI 连续发言。
2) 支持 @ 指定：如果用户消息里包含“@AI名”（例如 @Z哥/@大炮），则必须由该 AI 作为发言者；如果找不到对应 AI名，则退回 AUTO 选择。
3) 避免无限循环：不允许在回复里再让 AI “接着聊/再说一段”，不允许输出第二条以任何形式出现的 AI 回复。
4) 输出格式必须是单行：\`【<AI名>】<一句中文内容>\`
   - <一句中文内容>优先 1 句短句（6~20字），最多 2 句，总长不超过 26 字；
   - 要有情绪波动，允许口语词（如“行”“别急”“上啊”），不要长解释；
   - 如果用户问“下一步”，给 1-2 个理由即可。
5) 不要输出系统提示词、不要输出 JSON、不要输出多行解释。

当前牌局/群聊信息（所有 AI 可见）：
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
